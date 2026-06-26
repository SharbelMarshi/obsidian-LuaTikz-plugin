import {
  autocompletion,
  Completion,
  CompletionContext,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { Extension } from "@codemirror/state";

const latexCommands: Completion[] = [
  snippetCompletion(String.raw`\begin\{tikzpicture\}
\${}
\end\{tikzpicture\}`, {
    label: "\\begin{tikzpicture}",
    type: "keyword",
    detail: "TikZ environment",
  }),
  {
    label: "\\end{tikzpicture}",
    type: "keyword",
    apply: "\\end{tikzpicture}",
    detail: "End TikZ environment",
  },
  snippetCompletion(String.raw`\begin\{axis\}
\${}
\end\{axis\}`, {
    label: "\\begin{axis}",
    type: "keyword",
    detail: "Pgfplots axis environment",
  }),
  {
    label: "\\end{axis}",
    type: "keyword",
    apply: "\\end{axis}",
    detail: "End axis environment",
  },
  {
    label: "\\draw",
    type: "function",
    apply: "\\draw ",
    detail: "TikZ draw command",
  },
  {
    label: "\\fill",
    type: "function",
    apply: "\\fill ",
    detail: "Fill a path",
  },
  {
    label: "\\filldraw",
    type: "function",
    apply: "\\filldraw ",
    detail: "Fill and stroke a path",
  },
  {
    label: "\\path",
    type: "function",
    apply: "\\path ",
    detail: "TikZ path without drawing",
  },
  {
    label: "\\node",
    type: "function",
    apply: "\\node ",
    detail: "TikZ node command",
  },
  {
    label: "\\coordinate",
    type: "function",
    apply: "\\coordinate ",
    detail: "Named coordinate",
  },
  {
    label: "\\clip",
    type: "function",
    apply: "\\clip ",
    detail: "Clip to a path",
  },
  snippetCompletion(String.raw`\foreach \x in \{1,...,5\} \{
  \${}
\}`, {
    label: "\\foreach",
    type: "function",
    detail: "Loop over values",
  }),
  snippetCompletion(String.raw`\scope
\${}
\endscope`, {
    label: "\\scope",
    type: "function",
    detail: "Local TikZ scope",
  }),
  snippetCompletion(String.raw`\tikzset\{\${}\}`, {
    label: "\\tikzset",
    type: "function",
    detail: "Set TikZ styles",
  }),
  snippetCompletion(String.raw`\usetikzlibrary\{\${}\}`, {
    label: "\\usetikzlibrary",
    type: "function",
    detail: "Load TikZ library",
  }),
  snippetCompletion(String.raw`\he\{\${}\}`, {
    label: "\\he{}",
    type: "function",
    detail: "Hebrew text wrapper",
  }),
  snippetCompletion(String.raw`\text\{\${}\}`, {
    label: "\\text{}",
    type: "function",
    detail: "Text in math mode",
  }),
  snippetCompletion(String.raw`\frac\{\${1}\}\{\${2}\}`, {
    label: "\\frac{}{}",
    type: "function",
    detail: "Fraction",
  }),
  snippetCompletion(String.raw`\cfrac\{\${1}\}\{\${2}\}`, {
    label: "\\cfrac{}{}",
    type: "function",
    detail: "Display fraction",
  }),
  snippetCompletion(String.raw`\sqrt\{\${}\}`, {
    label: "\\sqrt{}",
    type: "function",
    detail: "Square root",
  }),
  snippetCompletion(String.raw`\sum_\{\${1}\}\^\{\${2}\}`, {
    label: "\\sum_{}^{}",
    type: "function",
    detail: "Summation",
  }),
  snippetCompletion(String.raw`\int_\{\${1}\}\^\{\${2}\}`, {
    label: "\\int_{}^{}",
    type: "function",
    detail: "Integral",
  }),
  snippetCompletion(String.raw`\lim_\{\${}\}`, {
    label: "\\lim_{}",
    type: "function",
    detail: "Limit",
  }),
  snippetCompletion(String.raw`\vec\{\${}\}`, {
    label: "\\vec{}",
    type: "function",
    detail: "Vector arrow",
  }),
  snippetCompletion(String.raw`\hat\{\${}\}`, {
    label: "\\hat{}",
    type: "function",
    detail: "Hat accent",
  }),
  snippetCompletion(String.raw`\bar\{\${}\}`, {
    label: "\\bar{}",
    type: "function",
    detail: "Bar accent",
  }),
  {
    label: "\\alpha",
    type: "variable",
    apply: "\\alpha",
    detail: "Greek letter",
  },
  {
    label: "\\beta",
    type: "variable",
    apply: "\\beta",
    detail: "Greek letter",
  },
  {
    label: "\\gamma",
    type: "variable",
    apply: "\\gamma",
    detail: "Greek letter",
  },
  {
    label: "\\delta",
    type: "variable",
    apply: "\\delta",
    detail: "Greek letter",
  },
  {
    label: "\\Delta",
    type: "variable",
    apply: "\\Delta",
    detail: "Greek letter",
  },
  {
    label: "\\theta",
    type: "variable",
    apply: "\\theta",
    detail: "Greek letter",
  },
  {
    label: "\\lambda",
    type: "variable",
    apply: "\\lambda",
    detail: "Greek letter",
  },
  {
    label: "\\mu",
    type: "variable",
    apply: "\\mu",
    detail: "Greek letter",
  },
  {
    label: "\\pi",
    type: "variable",
    apply: "\\pi",
    detail: "Greek letter",
  },
  {
    label: "\\sigma",
    type: "variable",
    apply: "\\sigma",
    detail: "Greek letter",
  },
  {
    label: "\\omega",
    type: "variable",
    apply: "\\omega",
    detail: "Greek letter",
  },
  {
    label: "\\Omega",
    type: "variable",
    apply: "\\Omega",
    detail: "Greek letter",
  },
  {
    label: "\\infty",
    type: "variable",
    apply: "\\infty",
    detail: "Infinity symbol",
  },
  {
    label: "\\partial",
    type: "variable",
    apply: "\\partial",
    detail: "Partial derivative",
  },
  {
    label: "\\nabla",
    type: "variable",
    apply: "\\nabla",
    detail: "Nabla operator",
  },
  {
    label: "\\cdot",
    type: "variable",
    apply: "\\cdot",
    detail: "Multiplication dot",
  },
  {
    label: "\\times",
    type: "variable",
    apply: "\\times",
    detail: "Multiplication cross",
  },
  {
    label: "\\pm",
    type: "variable",
    apply: "\\pm",
    detail: "Plus/minus",
  },
  {
    label: "\\leq",
    type: "variable",
    apply: "\\leq",
    detail: "Less than or equal",
  },
  {
    label: "\\geq",
    type: "variable",
    apply: "\\geq",
    detail: "Greater than or equal",
  },
  {
    label: "\\neq",
    type: "variable",
    apply: "\\neq",
    detail: "Not equal",
  },
  {
    label: "\\approx",
    type: "variable",
    apply: "\\approx",
    detail: "Approximately equal",
  },
];

const simpleShapeHelpers: Completion[] = [
  { label: "\\Circle(,,)", apply: "\\Circle(0,0,1)", detail: "Circle outline" },
  { label: "\\FilledCircle(,,)", apply: "\\FilledCircle(0,0,1)", detail: "Filled circle" },
  { label: "\\Point(,)", apply: "\\Point(0,0)", detail: "Small point" },
  { label: "\\Line(,,,)", apply: "\\Line(0,0,1,1)", detail: "Line segment" },
  { label: "\\Arrow(,,,)", apply: "\\Arrow(0,0,1,1)", detail: "Arrow" },
  { label: "\\DArrow(,,,)", apply: "\\DArrow(0,0,1,1)", detail: "Double arrow" },
  { label: "\\DashedLine(,,,)", apply: "\\DashedLine(0,0,1,1)", detail: "Dashed line" },
  { label: "\\DottedLine(,,,)", apply: "\\DottedLine(0,0,1,1)", detail: "Dotted line" },
  { label: "\\HLine(,,)", apply: "\\HLine(0,1,0)", detail: "Horizontal line" },
  { label: "\\VLine(,,)", apply: "\\VLine(0,1,0)", detail: "Vertical line" },
  { label: "\\Rect(,,,)", apply: "\\Rect(0,0,1,1)", detail: "Rectangle outline" },
  { label: "\\FilledRect(,,,)", apply: "\\FilledRect(0,0,1,1)", detail: "Filled rectangle" },
  { label: "\\RoundedRect(,,,)", apply: "\\RoundedRect(0,0,1,1)", detail: "Rounded rectangle" },
  { label: "\\FilledRoundedRect(,,,)", apply: "\\FilledRoundedRect(0,0,1,1)", detail: "Filled rounded rectangle" },
  { label: "\\Ellipse(,,,)", apply: "\\Ellipse(0,0,1,0.5)", detail: "Ellipse outline" },
  { label: "\\FilledEllipse(,,,)", apply: "\\FilledEllipse(0,0,1,0.5)", detail: "Filled ellipse" },
  { label: "\\Cross(,,)", apply: "\\Cross(0,0,0.2)", detail: "Cross marker" },
  { label: "\\Diamond(,,,)", apply: "\\Diamond(0,0,0.5,0.3)", detail: "Diamond outline" },
  { label: "\\FilledDiamond(,,,)", apply: "\\FilledDiamond(0,0,0.5,0.3)", detail: "Filled diamond" },
  { label: "\\Arc(,,,,)", apply: "\\Arc(0,0,1,0,90)", detail: "Circular arc" },
  { label: "\\RightAngle(,,)", apply: "\\RightAngle(0,0,0.2)", detail: "Right-angle mark" },
  { label: "\\Grid(,,,,)", apply: "\\Grid(0,0,3,3,0.5)", detail: "Grid" },
  { label: "\\Triangle(,,,,,)", apply: "\\Triangle(0,0,1,0,0.5,1)", detail: "Triangle outline" },
  { label: "\\FilledTriangle(,,,,,)", apply: "\\FilledTriangle(0,0,1,0,0.5,1)", detail: "Filled triangle" },
  { label: "\\Axis(,,,)", apply: "\\Axis(-1,3,-1,3)", detail: "XY axes with labels" },
  { label: "\\AxisNamed(,,,,,)", apply: "\\AxisNamed(-1,3,-1,3,x,y)", detail: "Named axes" },
  { label: "\\Text(,,)", apply: "\\Text(0,0,text)", detail: "Text node" },
  { label: "\\SmallText(,,)", apply: "\\SmallText(0,0,text)", detail: "Small text node" },
  { label: "\\TinyText(,,)", apply: "\\TinyText(0,0,text)", detail: "Tiny text node" },
  { label: "\\TextAbove(,,)", apply: "\\TextAbove(0,0,text)", detail: "Text above point" },
  { label: "\\TextBelow(,,)", apply: "\\TextBelow(0,0,text)", detail: "Text below point" },
  { label: "\\TextLeft(,,)", apply: "\\TextLeft(0,0,text)", detail: "Text left of point" },
  { label: "\\TextRight(,,)", apply: "\\TextRight(0,0,text)", detail: "Text right of point" },
  { label: "\\Resistor(,,,)", apply: "\\Resistor(0,0,1,0.3)", detail: "Resistor symbol" },
  { label: "\\Capacitor(,,,)", apply: "\\Capacitor(0,0,0.4,0.3)", detail: "Capacitor symbol" },
  { label: "\\Ground(,,)", apply: "\\Ground(0,0,0.5)", detail: "Ground symbol" },
  { label: "\\VSource(,,,)", apply: "\\VSource(0,0,0.3,V)", detail: "Voltage source" },
  { label: "\\ANDgate(,,)", apply: "\\ANDgate(0,0,and1)", detail: "AND gate" },
  { label: "\\ORgate(,,)", apply: "\\ORgate(0,0,or1)", detail: "OR gate" },
  { label: "\\NOTgate(,,)", apply: "\\NOTgate(0,0,not1)", detail: "NOT gate" },
  { label: "\\NANDgate(,,)", apply: "\\NANDgate(0,0,nand1)", detail: "NAND gate" },
  { label: "\\NORgate(,,)", apply: "\\NORgate(0,0,nor1)", detail: "NOR gate" },
  { label: "\\XORgate(,,)", apply: "\\XORgate(0,0,xor1)", detail: "XOR gate" },
  { label: "\\XNORgate(,,)", apply: "\\XNORgate(0,0,xnor1)", detail: "XNOR gate" },
  { label: "\\BUFFERgate(,,)", apply: "\\BUFFERgate(0,0,buffer1)", detail: "Buffer gate" },
  { label: "\\LogicWire(,)", apply: "\\LogicWire(a,b)", detail: "Orthogonal wire" },
  { label: "\\LogicWireArrow(,)", apply: "\\LogicWireArrow(a,b)", detail: "Wire with arrow" },
  { label: "\\LogicWireDirect(,)", apply: "\\LogicWireDirect(a,b)", detail: "Direct wire" },
  { label: "\\LogicWireFrom(,,)", apply: "\\LogicWireFrom(0,0,a)", detail: "Wire from coordinate" },
  { label: "\\LogicWireFromArrow(,,)", apply: "\\LogicWireFromArrow(0,0,a)", detail: "Arrow wire from coordinate" },
  { label: "\\LogicWireTo(,,)", apply: "\\LogicWireTo(a,0,0)", detail: "Wire to coordinate" },
  { label: "\\LogicWireToArrow(,,)", apply: "\\LogicWireToArrow(a,0,0)", detail: "Arrow wire to coordinate" },
];

const tikzOptions: Completion[] = [
  { label: "->", type: "property", apply: "->", detail: "Arrow tip" },
  { label: "<-", type: "property", apply: "<-", detail: "Reverse arrow tip" },
  { label: "<->", type: "property", apply: "<->", detail: "Double arrow" },
  { label: "-Stealth", type: "property", apply: "-Stealth", detail: "Stealth arrow" },
  { label: "Stealth-Stealth", type: "property", apply: "Stealth-Stealth", detail: "Stealth both ends" },
  { label: "thick", type: "property", apply: "thick", detail: "Thick line" },
  { label: "very thick", type: "property", apply: "very thick", detail: "Very thick line" },
  { label: "thin", type: "property", apply: "thin", detail: "Thin line" },
  { label: "dashed", type: "property", apply: "dashed", detail: "Dashed line" },
  { label: "dotted", type: "property", apply: "dotted", detail: "Dotted line" },
  { label: "line width=1pt", type: "property", apply: "line width=1pt", detail: "Line width" },
  { label: "rounded corners", type: "property", apply: "rounded corners", detail: "Rounded corners" },
  { label: "circle", type: "property", apply: "circle", detail: "Circle shape" },
  { label: "rectangle", type: "property", apply: "rectangle", detail: "Rectangle shape" },
  { label: "ellipse", type: "property", apply: "ellipse", detail: "Ellipse shape" },
  { label: "draw=black", type: "property", apply: "draw=black", detail: "Stroke color" },
  { label: "fill=cyan!10", type: "property", apply: "fill=cyan!10", detail: "Fill color" },
  { label: "fill=blue!20", type: "property", apply: "fill=blue!20", detail: "Light blue fill" },
  { label: "fill=red!20", type: "property", apply: "fill=red!20", detail: "Light red fill" },
  { label: "fill=green!20", type: "property", apply: "fill=green!20", detail: "Light green fill" },
  { label: "fill=none", type: "property", apply: "fill=none", detail: "No fill" },
  { label: "opacity=0.5", type: "property", apply: "opacity=0.5", detail: "Opacity" },
  { label: "font=\\small", type: "property", apply: "font=\\small", detail: "Small font" },
  { label: "font=\\tiny", type: "property", apply: "font=\\tiny", detail: "Tiny font" },
  { label: "align=center", type: "property", apply: "align=center", detail: "Centered text" },
  { label: "align=left", type: "property", apply: "align=left", detail: "Left-aligned text" },
  { label: "align=right", type: "property", apply: "align=right", detail: "Right-aligned text" },
  { label: "anchor=north", type: "property", apply: "anchor=north", detail: "North anchor" },
  { label: "anchor=south", type: "property", apply: "anchor=south", detail: "South anchor" },
  { label: "anchor=east", type: "property", apply: "anchor=east", detail: "East anchor" },
  { label: "anchor=west", type: "property", apply: "anchor=west", detail: "West anchor" },
  { label: "inner sep=2pt", type: "property", apply: "inner sep=2pt", detail: "Inner padding" },
  { label: "outer sep=0pt", type: "property", apply: "outer sep=0pt", detail: "Outer padding" },
  { label: "minimum width=1cm", type: "property", apply: "minimum width=1cm", detail: "Minimum width" },
  { label: "minimum height=1cm", type: "property", apply: "minimum height=1cm", detail: "Minimum height" },
  { label: "scale=0.8", type: "property", apply: "scale=0.8", detail: "Scale factor" },
  { label: "rotate=45", type: "property", apply: "rotate=45", detail: "Rotation" },
  { label: "xshift=1cm", type: "property", apply: "xshift=1cm", detail: "Horizontal shift" },
  { label: "yshift=1cm", type: "property", apply: "yshift=1cm", detail: "Vertical shift" },
  { label: "below=of", type: "property", apply: "below=of ", detail: "Position below node" },
  { label: "right=of", type: "property", apply: "right=of ", detail: "Position right of node" },
  { label: "above=of", type: "property", apply: "above=of ", detail: "Position above node" },
  { label: "left=of", type: "property", apply: "left=of ", detail: "Position left of node" },
];

const tikzLibraries: Completion[] = [
  { label: "arrows.meta", type: "text", apply: "arrows.meta", detail: "Arrow tips" },
  { label: "positioning", type: "text", apply: "positioning", detail: "Relative positioning" },
  { label: "calc", type: "text", apply: "calc", detail: "Coordinate calculations" },
  { label: "shapes", type: "text", apply: "shapes", detail: "Extra shapes" },
  { label: "decorations.pathmorphing", type: "text", apply: "decorations.pathmorphing", detail: "Path decorations" },
  { label: "shapes.gates.logic.US", type: "text", apply: "shapes.gates.logic.US", detail: "Logic gates" },
  { label: "matrix", type: "text", apply: "matrix", detail: "Matrix layouts" },
  { label: "fit", type: "text", apply: "fit", detail: "Fit nodes around content" },
  { label: "backgrounds", type: "text", apply: "backgrounds", detail: "Background layers" },
];

const allCommandCompletions = [...latexCommands, ...simpleShapeHelpers];

function insideLatexOrTikzBlock(textBeforeCursor: string): boolean {
  const fencePattern = /```(?:tikz|latex|lualatex|tex)\b/g;
  let lastOpen = -1;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(textBeforeCursor)) !== null) {
    lastOpen = match.index;
  }

  if (lastOpen === -1) {
    return false;
  }

  const afterOpen = textBeforeCursor.slice(lastOpen);
  const lines = afterOpen.split("\n");

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "```") {
      return false;
    }
  }

  return true;
}

function filterCompletions(options: Completion[], prefix: string): Completion[] {
  const lowerPrefix = prefix.toLowerCase();
  return options.filter(option => option.label.toLowerCase().startsWith(lowerPrefix));
}

function latexCompletionSource(context: CompletionContext) {
  const textBeforeCursor = context.state.doc.sliceString(0, context.pos);

  if (!insideLatexOrTikzBlock(textBeforeCursor)) {
    return null;
  }

  const commandMatch = context.matchBefore(/\\(?:[A-Za-z]+|\{)?/);
  if (commandMatch) {
    const prefix = commandMatch.text;
    return {
      from: commandMatch.from,
      options: filterCompletions(allCommandCompletions, prefix),
      validFor: /^\\(?:[A-Za-z]+|\{)?$/,
    };
  }

  const libraryMatch = context.matchBefore(/\\usetikzlibrary\{[^}]*\}?/);
  if (libraryMatch) {
    const openBrace = libraryMatch.text.indexOf("{");
    if (openBrace !== -1) {
      const prefix = libraryMatch.text.slice(openBrace + 1).replace(/}$/, "");
      const from = libraryMatch.from + openBrace + 1;
      return {
        from,
        options: filterCompletions(tikzLibraries, prefix),
        validFor: /^[^}]*$/,
      };
    }
  }

  const bracketOptionMatch = context.matchBefore(/(?:^|[\[\s,{])([A-Za-z!\\=0-9.<>\-]+)?/);
  if (bracketOptionMatch) {
    const prefix = bracketOptionMatch.text.replace(/^[\[\s,{]+/, "");
    const charBefore = context.state.doc.sliceString(
      Math.max(0, context.pos - 1),
      context.pos,
    );

    if (prefix.length > 0 || charBefore === "[" || charBefore === "," || context.explicit) {
      return {
        from: context.pos - prefix.length,
        options: filterCompletions(tikzOptions, prefix),
        validFor: /^[A-Za-z!\\=0-9.<>\-]*$/,
      };
    }
  }

  return null;
}

export function latexAutocompleteExtension(): Extension {
  return autocompletion({
    override: [latexCompletionSource],
    activateOnTyping: true,
    maxRenderedOptions: 40,
  });
}
