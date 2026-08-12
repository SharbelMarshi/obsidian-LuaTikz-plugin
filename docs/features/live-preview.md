# Live preview and coordinate picking

Command palette → **Toggle inline live preview**. A floating preview updates while the cursor is inside a `tikz` block. The preview now works on mobile and tablets too (rendered through TikZJax); coordinate picking and hover-to-locate remain desktop features, and on any platform the preview's **Edit** button opens the visual editor described below.

Click the preview to insert TikZ coordinates at the cursor. **Shift+click** constrains the pick to a horizontal or vertical line from the last numeric coordinate already in your source — useful when tracing rectangle edges.

To close an orthogonal shape (rectangle, L-shape, …) without nudging the last corner by hand, type **`ccycle`** instead of `cycle`. LuaTikZ snaps the last point to the 90° closing corner and rewrites it to `cycle`:

```tikz
\draw (0.54,-3.09)--(7.00,-3.09)--(7.00,-0.96)--(2.04,-0.96)--ccycle ;
```

becomes `(0.54,-0.96)--cycle` on the last segment.

Move the pointer over a shape in the preview and the statement that drew it is highlighted in the editor. The mapping is derived from the explicit coordinates in your source (`--` chains, `rectangle`/`grid`, `circle`/`ellipse`, node anchors, `++` relative steps, picture-level `scale`); statements built from anything it cannot read — named nodes, polar coordinates, `foreach` bodies — are simply never highlighted rather than guessed at.

While you edit, the preview keeps the last good diagram visible so a half-finished `\draw` line does not blank the surface.
