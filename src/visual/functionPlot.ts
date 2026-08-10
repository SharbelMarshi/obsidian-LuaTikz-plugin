import type { TikzCoordinate } from '../utils/coordinatePick';

/**
 * Expression engine for the function plotter and for rendering native TikZ
 * `plot (\x, {…})` statements on the canvas.
 *
 * A tiny recursive-descent parser builds an AST from ordinary math notation —
 * no `eval`, no `Function`, user input never reaches a JS parser. The AST
 * evaluates under two semantics:
 *
 * - **math mode** (plotter dialog input): variable `x`, trig in radians;
 * - **tikz mode** (parsing `\x` expressions from source): variable `\x`,
 *   trig in degrees, `deg()`/`rad()` conversions — pgfmath's behavior.
 *
 * A math-mode AST also prints itself as TikZ source (`sin(x)` →
 * `sin(deg(\x))`), which is what the plot tool writes into the fence.
 */

type AstNode =
	| { kind: 'num'; value: number }
	| { kind: 'var' }
	| { kind: 'const'; name: 'pi' | 'e' }
	| { kind: 'call'; name: string; arg: AstNode }
	| { kind: 'neg'; operand: AstNode }
	| { kind: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: AstNode; right: AstNode };

const DEG = Math.PI / 180;

/** name → [math-mode impl, tikz-mode impl]. */
const FUNCTIONS: Record<string, [(v: number) => number, (v: number) => number]> = {
	sin: [Math.sin, v => Math.sin(v * DEG)],
	cos: [Math.cos, v => Math.cos(v * DEG)],
	tan: [Math.tan, v => Math.tan(v * DEG)],
	asin: [Math.asin, v => Math.asin(v) / DEG],
	acos: [Math.acos, v => Math.acos(v) / DEG],
	atan: [Math.atan, v => Math.atan(v) / DEG],
	sinh: [Math.sinh, Math.sinh],
	cosh: [Math.cosh, Math.cosh],
	tanh: [Math.tanh, Math.tanh],
	sqrt: [Math.sqrt, Math.sqrt],
	abs: [Math.abs, Math.abs],
	exp: [Math.exp, Math.exp],
	ln: [Math.log, Math.log],
	log: [Math.log, Math.log],
	log10: [Math.log10, Math.log10],
	floor: [Math.floor, Math.floor],
	ceil: [Math.ceil, Math.ceil],
	round: [Math.round, Math.round],
	deg: [v => v / DEG, v => v / DEG],
	rad: [v => v * DEG, v => v * DEG],
};

const CONSTANTS: Record<'pi' | 'e', number> = {
	pi: Math.PI,
	e: Math.E,
};

type Token =
	| { kind: 'number'; value: number }
	| { kind: 'name'; name: string }
	| { kind: 'op'; op: string };

function tokenize(text: string): Token[] | null {
	const tokens: Token[] = [];
	let index = 0;
	while (index < text.length) {
		const char = text[index];
		if (char === ' ' || char === '\t') {
			index++;
			continue;
		}
		if (/[0-9.]/.test(char)) {
			const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(text.slice(index));
			if (!match) {
				return null;
			}
			tokens.push({ kind: 'number', value: Number.parseFloat(match[0]) });
			index += match[0].length;
			continue;
		}
		if (/[a-zA-Z\\]/.test(char)) {
			const match = /^\\?[a-zA-Z][a-zA-Z0-9]*/.exec(text.slice(index));
			if (!match) {
				return null;
			}
			tokens.push({ kind: 'name', name: match[0].toLowerCase() });
			index += match[0].length;
			continue;
		}
		if ('+-*/^()'.includes(char)) {
			tokens.push({ kind: 'op', op: char });
			index++;
			continue;
		}
		return null;
	}
	return tokens;
}

export interface CompileOptions {
	/** Parse a TikZ-side expression: variable `\x`, trig in degrees. */
	tikz?: boolean;
}

/**
 * Translate LaTeX-flavored math input into the plain notation the tokenizer
 * reads: `0.02 \cos(200t)` → `0.02 cos(200t)`, `\frac{x}{2}` → `((x)/(2))`,
 * `e^{-x}` → `e^(-x)`. Unknown commands (`\alpha`) keep their backslash and
 * fail the parse, so nothing silently evaluates to the wrong thing.
 */
function normalizeLatexMathInput(text: string): string {
	let out = text
		.replace(/\\left\b|\\right\b/g, '')
		.replace(/\\cdot\b|\\times\b/g, '*')
		.replace(/\\[,;:! ]/g, ' ');
	// \frac{A}{B} → ((A)/(B)), innermost first so nested fractions resolve.
	const frac = /\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/;
	for (let guard = 0; guard < 16 && frac.test(out); guard++) {
		out = out.replace(frac, '(($1)/($2))');
	}
	// \sqrt[N]{A} → ((A)^(1/(N))); plain \sqrt keeps its name.
	out = out.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, '(($2)^(1/($1)))');
	// Strip the backslash from commands the engine knows (\cos, \pi, …).
	out = out.replace(/\\([a-zA-Z]+)/g, (full, name: string) => {
		const lower = name.toLowerCase();
		return lower in FUNCTIONS || lower === 'pi' || lower === 'e' ? lower : full;
	});
	// Remaining brace groups act as parentheses (\sqrt{x}, x^{2}).
	return out.replace(/\{/g, '(').replace(/\}/g, ')');
}

/** Distinct name tokens that are not functions or constants. */
function unknownNames(tokens: Token[], exclude: string): string[] {
	const names = new Set<string>();
	for (const token of tokens) {
		if (token.kind === 'name' && token.name !== exclude
			&& !(token.name in FUNCTIONS)
			&& token.name !== 'pi' && token.name !== 'e') {
			names.add(token.name);
		}
	}
	return [...names];
}

/**
 * Human explanation for input {@link compileFunction} rejects, or null when
 * there is nothing specific to say: several free variables (`cos(200t-x)`),
 * or a name the engine does not know.
 */
export function describeFunctionProblem(text: string): string | null {
	const tokens = tokenize(normalizeLatexMathInput(text.trim()));
	if (!tokens) {
		return null;
	}
	const unknowns = unknownNames(tokens, '');
	const variables = unknowns.filter(name => /^[a-z]$/.test(name));
	const bogus = unknowns.filter(name => !/^[a-z]$/.test(name));
	if (bogus.length) {
		return `"${bogus[0]}" is not a function this plotter knows.`;
	}
	if (variables.length > 1) {
		return `The expression uses ${variables.length} variables (${variables.join(', ')}) — a plot needs exactly one; replace the others with numbers.`;
	}
	return null;
}

export interface CompiledFunction {
	evaluate: (x: number) => number;
	/** TikZ math source with `\x` and degree-based trig. Radians-mode ASTs
	 * only — tikz-mode input is already TikZ source. */
	toTikz: () => string;
}

function parseAst(tokens: Token[], variable: string): AstNode | null {
	let position = 0;

	const peek = (): Token | null => tokens[position] ?? null;
	const isOp = (op: string): boolean => {
		const token = peek();
		return !!token && token.kind === 'op' && token.op === op;
	};
	const startsOperand = (): boolean => {
		const token = peek();
		return !!token && (token.kind === 'number' || token.kind === 'name'
			|| (token.kind === 'op' && token.op === '('));
	};

	function parseAtom(): AstNode | null {
		const token = peek();
		if (!token) {
			return null;
		}
		if (token.kind === 'number') {
			position++;
			return { kind: 'num', value: token.value };
		}
		if (token.kind === 'name') {
			position++;
			if (token.name === variable) {
				return { kind: 'var' };
			}
			if (token.name === 'pi' || token.name === 'e') {
				return { kind: 'const', name: token.name };
			}
			if (token.name in FUNCTIONS && isOp('(')) {
				position++;
				const arg = parseExpression();
				if (!arg || !isOp(')')) {
					return null;
				}
				position++;
				return { kind: 'call', name: token.name, arg };
			}
			return null;
		}
		if (token.kind === 'op' && token.op === '(') {
			position++;
			const inner = parseExpression();
			if (!inner || !isOp(')')) {
				return null;
			}
			position++;
			return inner;
		}
		return null;
	}

	function parsePower(): AstNode | null {
		const base = parseAtom();
		if (!base) {
			return null;
		}
		if (isOp('^')) {
			position++;
			const exponent = parseUnary();
			return exponent ? { kind: 'bin', op: '^', left: base, right: exponent } : null;
		}
		return base;
	}

	function parseUnary(): AstNode | null {
		if (isOp('-')) {
			position++;
			const operand = parseUnary();
			return operand ? { kind: 'neg', operand } : null;
		}
		if (isOp('+')) {
			position++;
			return parseUnary();
		}
		return parsePower();
	}

	function parseTerm(): AstNode | null {
		let left = parseUnary();
		if (!left) {
			return null;
		}
		for (;;) {
			if (isOp('*') || isOp('/')) {
				const op = (peek() as { op: '*' | '/' }).op;
				position++;
				const right = parseUnary();
				if (!right) {
					return null;
				}
				left = { kind: 'bin', op, left, right };
				continue;
			}
			// Implicit multiplication: `2x`, `2sin(x)`, `x(x+1)`.
			if (startsOperand()) {
				const right = parseUnary();
				if (!right) {
					return null;
				}
				left = { kind: 'bin', op: '*', left, right };
				continue;
			}
			return left;
		}
	}

	function parseExpression(): AstNode | null {
		let left = parseTerm();
		if (!left) {
			return null;
		}
		while (isOp('+') || isOp('-')) {
			const op = (peek() as { op: '+' | '-' }).op;
			position++;
			const right = parseTerm();
			if (!right) {
				return null;
			}
			left = { kind: 'bin', op, left, right };
		}
		return left;
	}

	const ast = parseExpression();
	return ast && position === tokens.length ? ast : null;
}

function evaluateAst(node: AstNode, x: number, tikz: boolean): number {
	switch (node.kind) {
		case 'num':
			return node.value;
		case 'var':
			return x;
		case 'const':
			return CONSTANTS[node.name];
		case 'call':
			return FUNCTIONS[node.name][tikz ? 1 : 0](evaluateAst(node.arg, x, tikz));
		case 'neg':
			return -evaluateAst(node.operand, x, tikz);
		case 'bin': {
			const left = evaluateAst(node.left, x, tikz);
			const right = evaluateAst(node.right, x, tikz);
			switch (node.op) {
				case '+': return left + right;
				case '-': return left - right;
				case '*': return left * right;
				case '/': return left / right;
				case '^': return Math.pow(left, right);
			}
		}
	}
}

const PRECEDENCE: Record<'+' | '-' | '*' | '/' | '^', number> = {
	'+': 1, '-': 1, '*': 2, '/': 2, '^': 3,
};

/** Radians-mode functions rewritten for pgfmath's degree world. */
const TRIG = new Set(['sin', 'cos', 'tan']);
const INVERSE_TRIG = new Set(['asin', 'acos', 'atan']);

function printTikz(node: AstNode, parentPrecedence: number): string {
	switch (node.kind) {
		case 'num':
			return String(node.value);
		case 'var':
			return '\\x';
		case 'const':
			return node.name;
		case 'call': {
			const arg = printTikz(node.arg, 0);
			const name = node.name === 'log' ? 'ln' : node.name;
			if (TRIG.has(name)) {
				return `${name}(deg(${arg}))`;
			}
			if (INVERSE_TRIG.has(name)) {
				// pgfmath's inverse trig returns degrees; ours returns radians.
				return `rad(${name}(${arg}))`;
			}
			return `${name}(${arg})`;
		}
		case 'neg': {
			const inner = `-${printTikz(node.operand, 2)}`;
			return parentPrecedence > 1 ? `(${inner})` : inner;
		}
		case 'bin': {
			const precedence = PRECEDENCE[node.op];
			const left = printTikz(node.left, precedence);
			// Right-associativity: subtraction/division right operands bind tighter.
			const right = printTikz(
				node.right,
				node.op === '-' || node.op === '/' ? precedence + 1 : precedence,
			);
			const text = `${left}${node.op}${right}`;
			return precedence < parentPrecedence ? `(${text})` : text;
		}
	}
}

/**
 * Compile `text` into an evaluatable (and, in math mode, TikZ-printable)
 * function of one variable, or null when it isn't a valid expression.
 *
 * Math mode accepts LaTeX-flavored notation (`0.02\cos(200t)`,
 * `\frac{x}{2}`), and the variable does not have to be `x`: when the
 * expression's only free single-letter name is `t` (or any other letter),
 * that letter is the plot variable and still prints as `\x` in TikZ output.
 */
export function compileFunction(text: string, options: CompileOptions = {}): CompiledFunction | null {
	const tikz = !!options.tikz;
	const tokens = tokenize(tikz ? text.trim() : normalizeLatexMathInput(text.trim()));
	if (!tokens || !tokens.length) {
		return null;
	}
	let variable = tikz ? '\\x' : 'x';
	if (!tikz) {
		const unknowns = unknownNames(tokens, 'x');
		const hasX = tokens.some(token => token.kind === 'name' && token.name === 'x');
		if (!hasX && unknowns.length === 1 && /^[a-z]$/.test(unknowns[0])) {
			variable = unknowns[0];
		}
	}
	const ast = parseAst(tokens, variable);
	if (!ast) {
		return null;
	}
	return {
		evaluate: x => evaluateAst(ast, x, tikz),
		toTikz: () => printTikz(ast, 0),
	};
}

/** Values beyond this are treated as a pole/discontinuity and split the plot. */
const PLOT_CLIP = 1000;

/**
 * Sample f over [from, to] into contiguous finite runs. Poles, NaN regions
 * (e.g. sqrt of negatives, tan asymptotes) split the curve; each returned run
 * has at least two points and is plottable as one path.
 */
export function sampleFunctionRuns(
	fn: CompiledFunction,
	from: number,
	to: number,
	samples = 64,
): TikzCoordinate[][] {
	const lo = Math.min(from, to);
	const hi = Math.max(from, to);
	if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) {
		return [];
	}
	const runs: TikzCoordinate[][] = [];
	let current: TikzCoordinate[] = [];
	for (let index = 0; index <= samples; index++) {
		const x = lo + ((hi - lo) * index) / samples;
		let y: number;
		try {
			y = fn.evaluate(x);
		} catch {
			y = Number.NaN;
		}
		if (Number.isFinite(y) && Math.abs(y) <= PLOT_CLIP) {
			current.push({ x, y });
		} else if (current.length) {
			if (current.length >= 2) {
				runs.push(current);
			}
			current = [];
		}
	}
	if (current.length >= 2) {
		runs.push(current);
	}
	return runs;
}
