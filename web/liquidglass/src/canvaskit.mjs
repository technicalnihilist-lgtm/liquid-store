/** Apache-2.0. Where <liquid-glass> gets CanvasKit for engine="canvas". Tiny on purpose: importing
 * it does not load CanvasKit or the shader bundle; loadCanvasKit() does, on first use. */

let config = {};
let kitPromise = null;

/**
 * How CanvasKit is obtained. Call before the first canvas-engine element renders.
 *  - {canvasKit}: an initialized CanvasKit object you already have.
 *  - {init, locateFile}: CanvasKitInit (e.g. `import CanvasKitInit from 'canvaskit-wasm'` in a
 *    bundler) and where its canvaskit.wasm is served.
 *  - {locateFile} alone: use a global CanvasKitInit from <script src=".../canvaskit.js">.
 *  - {load}: any function returning a Promise of CanvasKit.
 * Without configuration the engine uses a global CanvasKitInit, then tries `import('canvaskit-wasm')`
 * (Node or an import map); bundlers should pass `init` explicitly.
 */
export function configureCanvasKit(options = {}) {
  config = {...options};
  kitPromise = null;
}

export function loadCanvasKit() {
  kitPromise ??= (async () => {
    if (config.canvasKit) return config.canvasKit;
    if (typeof config.load === 'function') return config.load();
    let init = config.init ?? globalThis.CanvasKitInit;
    if (typeof init !== 'function') {
      // Hidden from bundlers on purpose: canvaskit-wasm is an optional peer dependency.
      const specifier = 'canvaskit-wasm';
      try { init = (await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier)).default; }
      catch (error) {
        throw new Error('CanvasKit is not available. Install the optional peer dependency canvaskit-wasm ' +
          'and call configureCanvasKit({init, locateFile}), or load canvaskit.js with a <script> tag.', {cause: error});
      }
    }
    return init(config.locateFile ? {locateFile: config.locateFile} : undefined);
  })();
  return kitPromise;
}
