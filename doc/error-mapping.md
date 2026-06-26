# Error mapping

When LuaLaTeX fails, the plugin parses the log and maps errors back to **your TikZ source**, not the internal wrapped document.

## What you see

Instead of a generic "Syntax error", you get messages like:

```
Error near line 3 in your TikZ block: \node at (0,0) {\badcmd}
```

With **inline live preview** (editor context), you may also see the note line:

```
Error near line 42 in note (TikZ block line 3): \node at (0,0) {\badcmd}
```

## How it works

1. LuaLaTeX writes `l.123` line numbers into `diagram.log`
2. The plugin counts lines in the auto-generated preamble (documentclass, packages, helpers, `\begin{document}`)
3. User line = log line − preamble offset
4. The matching source line from your tidied TikZ block is shown in the message

Implementation: `latexErrorMapping.ts`

## Error UI

Failed renders show:

- **Title** — mapped error with line hint
- **Copy error** — full log + stderr to clipboard
- **Show full error** — expandable raw log tail

Same controls appear in inline preview error panels.

## Line number notes

- Line numbers refer to **non-empty lines** in the block (same as what gets compiled after `tidyTikzSource`)
- Blank lines in your editor are skipped in the count
- If the log has no `l.NNN` entry, you still see the extracted LaTeX message without a line number

## Common errors

| LaTeX message | Typical cause |
|---------------|---------------|
| Undefined control sequence | Typo in `\command` or missing library |
| Missing `$ inserted` | Math mode not closed |
| Runaway argument | Unmatched `{` or `}` |
| Missing `\end{tikzpicture}` | Environment not closed |

Fix the indicated line in your `tikz` block and re-render (switch view or wait for live preview debounce).

## Missing tools

Non-compile failures have dedicated messages:

- **LuaLaTeX was not found** — install MacTeX / TeX Live
- **SVG conversion is not available** — `brew install poppler`
- **No PDF was produced** — log tail is scanned for line mapping when available
