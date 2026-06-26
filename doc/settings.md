# Settings

Open **Obsidian → Settings → LuaTikZ** to configure the plugin.

## Options

### Invert dark colors in dark mode

| | |
|---|---|
| **Default** | On |
| **Purpose** | Converts black diagram elements to white when Obsidian uses a dark theme |
| **Affects** | SVG stroke/fill colors after render |

Useful for axes, arrows, gate outlines, and text that would otherwise disappear on a dark background.

Does not change your TikZ source—only the displayed SVG.

### Enable inline live preview by default

| | |
|---|---|
| **Default** | On |
| **Purpose** | Shows the floating TikZ preview automatically when the plugin loads |
| **Affects** | Editor only; reading view unchanged |

You can still toggle preview anytime via **LuaTikZ: Toggle inline live preview** in the command palette.

## Persistence

Settings are stored in Obsidian plugin data (`.obsidian/plugins/luatikz/data.json` in your vault). They sync with your vault if you use Obsidian Sync.

## Related documentation

- [Rendering & export](rendering-and-export.md) — how preview and dark mode inversion work
- [Getting started](getting-started.md) — install and first diagram
