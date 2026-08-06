# LuaTikZ

Fast LuaLaTeX TikZ rendering with full library support, live preview, RTL support, and simple diagram helpers.

Render `tikz` and `luatikz` fenced code blocks in Obsidian. Desktop can use local LuaLaTeX or TikZJax; mobile uses TikZJax.

Enable **LuaTikZ** under Settings → Community plugins. The release ships as `main.js`, `manifest.json`, and `styles.css`. TikZJax is bundled into `main.js` (~7 MB).

![Floating live preview](<floating preview feature.png>)

## What's new in 1.8.2

### Fixed

- **LuaLaTeX failed to render on Linux and Windows.** The preamble hardcoded macOS-only fonts (`David CLM`, `Geeza Pro`, `Times New Roman`) and loaded them unconditionally, so *every* diagram failed on a machine missing any of them — even one with no RTL content. Fonts now resolve through fallback chains that skip what isn't installed. [Details](#fonts-and-rtl)
- **A diagram containing Hebrew or Arabic flipped the plugin's own UI.** The Export button, error card and its buttons were laid out right-to-left because the *source* contained RTL characters. Plugin controls now keep their direction; the diagram's own text direction is LaTeX's business.
- **`\usetikzlibrary{...}` spread over several lines was ignored.** It was left in the document body, where the command is illegal, so the whole diagram failed. Multi-line `\usepackage` and `\usetikzlibrary` are now hoisted correctly.
- **`\usetikzlibrary{pgfplots}` aborted the compile.** Package names are dropped (the preamble already loads them) and PGFPlots-only libraries move to `\usepgfplotslibrary`. [Details](#renderers)
- **The *Starter block on new fence* setting never inserted its `tikzpicture` skeleton.**

### Added

- **Hover-to-locate** — moving the pointer over a shape in the floating preview highlights the statement that drew it. [Details](#live-preview-and-coordinate-picking-desktop)
- **PNG export** — the toolbar button is now **Export** with a format menu for SVG or PNG. [Details](#export)
- **Explained errors** — opaque LaTeX failures such as `Dimension too large` now come with a plain-language explanation of the cause and the fixes that work. [Details](#errors-and-editing)
- **Font settings** — override the main, Hebrew and Arabic fonts. [Details](#fonts-and-rtl)
- **Custom preamble** — replace the generated LuaLaTeX preamble entirely, with buttons to load the current one or reset. [Details](#custom-preamble)
- **Hebrew/Arabic load only when used** — and per script, so a Hebrew diagram no longer pulls in the Arabic gloss that minimal TeX installs lack. [Details](#fonts-and-rtl)

### Security

- Bundled `svgo` bumped to 3.3.4 ([GHSA-2p49-hgcm-8545](https://github.com/advisories/GHSA-2p49-hgcm-8545)).

## Requirements

### Mobile (iOS / Android)

LuaTikZ runs on Obsidian mobile. Diagrams render in reading view through the bundled TikZJax runtime — no local TeX install and no shell access required.

On mobile you get the same fenced-block editing helpers (autocomplete, structural lint, templates, error highlighting). **Inline live preview and coordinate picking are desktop-only** (they need the floating SVG preview). The renderer setting is fixed to TikZJax; LuaLaTeX is not available on mobile.

### Local LuaLaTeX (desktop)

- LuaLaTeX (MacTeX or TeX Live)
- `pdftocairo` for PDF → SVG (`brew install poppler` on macOS)
- Turn on **Allow local LuaLaTeX execution** in plugin settings

### TikZJax

No local TeX install. The TikZJax runtime and TeX WASM files are bundled into `main.js` (~7 MB). Obsidian Sync Standard may not sync plugin files over 5 MB.

## Usage

````markdown
```tikz
\begin{tikzpicture}
\draw (0,0) circle (1cm);
\node at (0,0) {Hello};
\end{tikzpicture}
```
````

The `luatikz` fence alias works the same way.

### Diagram alignment

Add a directive line inside the block, or set `align=` on `\begin{tikzpicture}`:

```tikz
% align=left
\begin{tikzpicture}
...
\end{tikzpicture}
```

Values: `left`, `center` (default), `right`. These control how the rendered SVG sits in reading view, not text direction.

### Background grid

Add a grid directive at the top of the block (stripped before render):

```tikz
% grid=1
\begin{tikzpicture}
...
\end{tikzpicture}
```

The number is the step in cm.

### RTL labels

Use `\he{...}` and `\ar{...}` for RTL text in labels. LuaLaTeX shapes the text properly; TikZJax substitutes a basic fallback.

```tikz
\begin{tikzpicture}
\Text(0,0,LTR text)
\Text(0,-1,\he{טקסט})
\Text(0,-2,\ar{نص})
\end{tikzpicture}
```

### Built-in helpers

Short macros for quick diagrams: `\Circle`, `\Arrow`, `\Rect`, `\TextRTL`, `\ResistorRow`, logic gates (`\ANDgate`, `\NOTgate`, …), wires, and basic circuit symbols. Autocomplete inside `tikz` blocks suggests TikZ commands, snippets, node anchors, and relative coordinates.

### Live preview and coordinate picking (desktop)

Command palette → **Toggle inline live preview**. A floating preview updates while the cursor is inside a `tikz` block.

Click the preview to insert TikZ coordinates at the cursor. **Shift+click** constrains the pick to a horizontal or vertical line from the last numeric coordinate already in your source — useful when tracing rectangle edges.

To close an orthogonal shape (rectangle, L-shape, …) without nudging the last corner by hand, type **`ccycle`** instead of `cycle`. LuaTikZ snaps the last point to the 90° closing corner and rewrites it to `cycle`:

```tikz
\draw (0.54,-3.09)--(7.00,-3.09)--(7.00,-0.96)--(2.04,-0.96)--ccycle ;
```

becomes `(0.54,-0.96)--cycle` on the last segment.

Move the pointer over a shape in the preview and the statement that drew it is highlighted in the editor. The mapping is derived from the explicit coordinates in your source (`--` chains, `rectangle`/`grid`, `circle`/`ellipse`, node anchors, `++` relative steps, picture-level `scale`); statements built from anything it cannot read — named nodes, polar coordinates, `foreach` bodies — are simply never highlighted rather than guessed at.

While you edit, the preview keeps the last good diagram visible so a half-finished `\draw` line does not blank the surface.

### Editor

Inside `tikz` / `luatikz` blocks (and standalone `\begin{tikzpicture}` environments):

- Line numbers on every line, including blanks
- Active-line and matching `\begin`/`\end` pair highlights
- Structural lint: unmatched environments/braces, missing libraries, rewritten `\usetikzlibrary` names, empty option keys
- New fences can auto-insert a blank `tikzpicture` skeleton
- Semicolon reminder on unfinished `\draw` lines (hint or auto-append)
- Auto-close `{`, `[`, `(`, `$`

**Command palette**

| Command | What it does |
|---------|----------------|
| Open helper reference | Searchable cheat sheet; click to insert |
| Insert TikZ template… | Blank picture, flowchart, axis, logic circuit |
| Format TikZ block | Tidy indentation inside the fence |
| Wrap selection in `\node{}` / `$...$` | |
| Insert plot from function… | PGFPlots wizard |
| What can I use here? | Pick a snippet category |

### Export

Hover a rendered block and click **Export** to save the diagram as SVG. The arrow next to it opens a menu to choose **SVG** or **PNG**; PNG is rasterized from the vector output at 2× so it stays crisp.

## Errors and editing

When a diagram fails:

- A short error card appears in reading view (e.g. `Missing semicolon (;) (line 3)`).
- **Go to line** jumps to the block-relative line in the source editor.
- The error line is highlighted in the editor; a **Fix** popup appears when LuaTikZ can suggest a repair (missing `;`, braces, typos, empty `align=`, etc.).
- Errors whose LaTeX message says nothing about the cause carry a short explanation instead. `Dimension too large` on a curved `to`, for example, explains that pgf overflows TeX's arithmetic once the endpoints are more than ~1024pt (~36cm) apart, and that `x=0.5cm` or explicit control points fix it while `scale=` does not.
- **Show log** expands the full compiler output.

Line numbers in error messages are relative to your TikZ block, not the generated LaTeX wrapper.

Pre-render checks catch empty option values (`align=`, `opacity=`, `minimum width=`, …) before calling LaTeX.

## Settings

| Setting | Purpose |
|---------|---------|
| Renderer | LuaLaTeX or TikZJax (desktop); mobile always uses TikZJax |
| Allow local LuaLaTeX execution | Opt-in shell rendering |
| Main / Hebrew / Arabic font | Override the font fallback chains; blank uses the defaults |
| Extra preamble | Custom LaTeX/TikZ appended to the preamble (split for LuaLaTeX vs TikZJax) |
| Custom preamble | Replace the generated LuaLaTeX preamble entirely |
| Enable cache | Reuse recent render results on disk |
| Dark mode style | Auto-invert, brightness boost, or none |
| Starter block on new fence | Insert blank `tikzpicture` when opening a new block |
| Structural lint | Warnings for env/brace/library issues in the editor |
| Semicolon reminder | Off, hint, or auto-append on Enter |
| Auto-close brackets | Close `{`, `[`, `(`, `$` while typing |
| Show install notice | One-time environment check on first load |

## Renderers

**LuaLaTeX** runs your full TeX toolchain: extra packages, pgfplots, circuitikz, math mode, and RTL via polyglossia. The default preamble loads common TikZ libraries.

### Fonts and RTL

Fonts resolve through fallback chains guarded by `\IfFontExistsTF`, so a name that is not installed is skipped rather than aborting the compile:

| | Chain |
|---|---|
| Main | TeX Gyre Termes (metrically Times, ships with TeX Live/MiKTeX) |
| Hebrew | Noto Serif Hebrew → David CLM → Frank Ruehl CLM |
| Arabic | Noto Sans Arabic → Geeza Pro → Amiri |

Set your own name in **Settings → Fonts** to put it at the front of a chain. If a whole chain misses, nothing is declared for that script and the diagram still renders.

`polyglossia` and the Hebrew/Arabic font families load **only when the diagram uses them** — `\he{}`, `\ar{}`, `\texthebrew{}`, `\textarabic{}`, or Hebrew/Arabic characters — and per script, so a Hebrew diagram never pulls in the Arabic gloss. `\he` and `\ar` are always defined, falling back to plain text when the script is not loaded.

### Custom preamble

**Settings → Preamble → Custom preamble** replaces the generated preamble outright. **Load current preamble** materializes the managed one for editing; **Reset to default** returns to managed.

In custom mode fonts, polyglossia and `\he`/`\ar` are yours to define. The plugin still appends the coordinate-pick calibration block and `\begin{document}`, injects `\documentclass` and `\usepackage{tikz}` if your text omits them, and neutralizes a stray `\begin{document}`. Note that a custom preamble does not receive preamble improvements from later releases — leave it empty unless you need the control.

`\usepackage` and `\usetikzlibrary` lines you write inside a block are hoisted into that preamble. Since TikZ aborts the whole compile on a name it does not recognise, two cases are rewritten first: package names (`\usetikzlibrary{pgfplots}`, `{circuitikz}`, …) are dropped because the preamble already loads them, and PGFPlots-only libraries (`groupplots`, `polar`, `statistics`, …) are moved to `\usepgfplotslibrary`. The editor flags both so the rewrite is never a surprise.

**TikZJax** renders in-process with no shell. Good for standard TikZ and simple plots. Advanced pgfplots (e.g. interpolated 3D surfaces) and real RTL shaping need LuaLaTeX.

## Security and permissions

This plugin needs elevated capabilities for its core feature (compiling TikZ with a local TeX installation). What it does with them:

- **Shell execution** (`child_process`, desktop only): runs exactly two programs — the LuaLaTeX binary you configure in settings and `pdftocairo` — always via `spawn` with `shell: false`, so arguments are never interpreted by a shell. Local execution is opt-in via the *Allow local LuaLaTeX execution* setting and never happens on mobile.
- **Direct filesystem access** (`fs`, desktop only): used as a fallback to read compile artifacts (PDF/SVG/log files) that LuaLaTeX writes into the plugin's own temp folder inside your vault (`.obsidian/plugins/<id>/.luatikz-temp`), because the vault adapter may not have indexed them yet. The plugin does not read or write files elsewhere on your system. If you use Obsidian Sync, consider excluding `.luatikz-temp` and `.luatikz-cache` (Settings → Sync → Excluded files) — they are per-machine scratch/cache data and safe to regenerate.
- **Clipboard access**: write-only, and only when you click a snippet in the helper cheatsheet to copy it. The plugin never reads your clipboard.
- **Dynamic code execution**: the plugin's own source contains no `eval`/`new Function`. The flagged occurrences live inside the bundled [jsdom](https://github.com/jsdom/jsdom) dependency of [node-tikzjax](https://github.com/prinsss/node-tikzjax), which powers the shell-free TikZJax renderer (required for mobile). They are part of jsdom's standard DOM implementation, not code paths this plugin invokes on your notes.

## Samples

Diagrams rendered with LuaTikZ, exported as SVG. Files in [`samples/`](samples/).

### Anatomy and science

| | |
|---|---|
| ![Heart anatomy](samples/heartanatomy.svg) | ![Eye anatomy](samples/eyeanatomy.svg) |
| ![Neural anatomy](samples/neuralanatomy.svg) | ![Airflow path](samples/airflowpath.svg) |

### Circuits and logic

| | |
|---|---|
| ![Circuit diagram 1](samples/circuit1.svg) | ![Circuit diagram 2](samples/circuit2.svg) |
| ![Circuit diagram 3](samples/circuit3.svg) | ![MOSFET P-channel](samples/mosn-pchannel.svg) |
| ![Logic gates 1](samples/logicgates1.svg) | ![Logic gates 2](samples/logicgates2.svg) |

### Math and decision diagrams

| | |
|---|---|
| ![PDE diagram](samples/PDE.svg) | ![Decision matrix](samples/decisionmatrix.svg) |

### Maps and layouts

| | |
|---|---|
| ![Train routes](samples/trainroutes.svg) | ![Isometric city](samples/isometriccity.svg) |

## License

MIT — see [LICENSE](LICENSE).
