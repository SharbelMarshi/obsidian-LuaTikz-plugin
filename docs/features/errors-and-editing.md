# Errors and editing

When a diagram fails:

- A short error card appears in reading view (e.g. `Missing semicolon (;) (line 3)`).
- **Go to line** jumps to the block-relative line in the source editor.
- The error line is highlighted in the editor; a **Fix** popup appears when LuaTikZ can suggest a repair (missing `;`, braces, typos, empty `align=`, etc.).
- Errors whose LaTeX message says nothing about the cause carry a short explanation instead. `Dimension too large` on a curved `to`, for example, explains that pgf overflows TeX's arithmetic once the endpoints are more than ~1024pt (~36cm) apart, and that `x=0.5cm` or explicit control points fix it while `scale=` does not.
- **Show log** expands the full compiler output.

Line numbers in error messages are relative to your TikZ block, not the generated LaTeX wrapper.

Pre-render checks catch empty option values (`align=`, `opacity=`, `minimum width=`, …) before calling LaTeX.
