// Injected by esbuild (see esbuild.config.mjs): bundled dependencies such as
// dvi2html and svgo reference the bare `Buffer`/`process` globals, which
// exist on desktop Electron but not in the mobile webview. esbuild rewrites
// those free identifiers to these polyfill-backed exports.
export { Buffer } from 'buffer';
export { default as process } from 'process';
