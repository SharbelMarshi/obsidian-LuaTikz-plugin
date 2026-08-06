# Third-party notices

## tikz-editor

Portions of the visual TikZ editor are adapted from the
[tikz-editor](https://github.com/DominikPeters/tikz-editor) project.

- `src/visual/freehand.ts` — freehand capture, simplification, and
  Catmull-Rom → Bézier fitting, adapted from
  `packages/app/src/ui/canvas-panel/freehand-tool.ts`.
- `src/visual/sourcePatches.ts` — span-based lossless source patching,
  adapted from `packages/core/src/edit/source-patches.ts`.
- `src/visual/editorViewport.ts` — pinch-zoom viewport math following
  `packages/app/src/ui/canvas-panel/useCanvasViewportEffects.ts`.

```
MIT License

Copyright (c) 2026 Dominik Peters

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
