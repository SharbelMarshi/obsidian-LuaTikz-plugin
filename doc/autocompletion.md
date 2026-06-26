# Autocompletion

LuaTikZ adds CodeMirror 6 autocompletion inside fenced code blocks. Suggestions appear as you type `\` or when you trigger completion manually.

## Where it works

Autocompletion is active only when your cursor is inside an **open** fenced block with one of these language tags:

- `tikz`
- `latex`
- `lualatex`
- `tex`

The block must not be closed yet (no closing ` ``` ` on a line below the opening fence).

## What gets suggested

| Trigger | Suggestions |
|---------|-------------|
| `\` + letters | TikZ commands, math symbols, simple shape helpers |
| Inside `[...]` or after `,` | TikZ style options (`thick`, `->`, `fill=blue!20`, …) |
| Inside `\usetikzlibrary{...}` | TikZ library names |

Suggestions are filtered as you type (prefix match, case-insensitive).

## Snippet completions

Several completions insert **multi-line snippets** with the cursor placed at the right spot:

### Block environments

Selecting `\begin{tikzpicture}` inserts:

```latex
\begin{tikzpicture}
|
\end{tikzpicture}
```

The cursor (`|`) is on the empty line **inside** the environment, not after `\end{tikzpicture}`.

Same behavior for:

- `\begin{axis}` / `\end{axis}`
- `\scope` / `\endscope`
- `\foreach \x in {1,...,5} { ... }`

### Brace commands

Selecting `\he{}`, `\frac{}{}`, `\sqrt{}`, etc. places the cursor **inside the braces**.

For `\frac{}{}`:

1. Cursor starts in the numerator
2. **Tab** moves to the denominator

## Manual completion

If suggestions do not appear automatically, try:

- **Ctrl+Space** (or your Obsidian/CodeMirror completion shortcut)
- Continuing to type after `\` — completion activates on typing by default

## Simple shape helpers in autocomplete

Every macro from [Simple shape helpers](simple-shape-helpers.md) is listed with a short description and a starter example (e.g. `\ANDgate(0,0,and1)`).

## Limitations

- Completions do not run outside code blocks
- Argument lists in helpers cannot contain commas — complex `\Text` labels may need raw `\node`
- Very long completion lists are capped at 40 visible options (`maxRenderedOptions`)

## Implementation

Autocompletion is defined in `latexAutocomplete.ts` and registered via:

```typescript
this.registerEditorExtension(latexAutocompleteExtension());
```

Snippets use CodeMirror's `snippetCompletion` API for correct cursor placement after insertion.
