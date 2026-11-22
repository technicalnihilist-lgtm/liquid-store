# LiquidGlass, vendored

The glass in `assets/index.html` is not a hand-written blur. It is the
`<liquid-glass>` web component from **[LiquidGlass 1.0.0](https://github.com/shayann07/liquidglass)**
(Apache-2.0), bundled to a single file and inlined into the page.

| File | What it is |
| :-- | :-- |
| `liquidglass.min.js` | the bundle the app ships — `ports/npm` of 1.0.0, `esbuild --bundle --format=iife --global-name=LiquidGlass --minify --target=chrome100` |
| `src/` | the same modules unbundled, as published (`index.mjs`, `element.mjs`, `engine.mjs`, `material.mjs`, `optics.mjs`, `canvaskit.mjs`, `canvas-engine.mjs`, `vendor/skia/`) |
| `LICENSE`, `NOTICE` | Apache-2.0, from the upstream repository |
| `UPSTREAM-README.md` | the upstream README, for the full attribute and engine reference |

## What the app uses

`engine="html"` only. The HTML engine refracts the live page through an SVG
displacement filter generated from the shader's own geometry — in Chromium,
which is every Android WebView this app runs in — and frosts everywhere else.
It costs ~78 kB of JavaScript and no WebAssembly.

`engine="canvas"` is deliberately not used: it draws the production shaders
exactly, but it adds CanvasKit (`canvaskit.wasm`, 7.3 MB) to an APK that is a
quarter of a megabyte, to draw the glass the HTML engine already draws.

Ten surfaces are glass, all of them floating chrome: the navbar, the tab bar and
the lens that travels along it, the search button, the menu, the toast, the
loader card, the two buttons in the detail page bar, and the search field. Each
one is a *backplate* — the glass is an absolutely positioned child that fills
the control's own box from behind — so no control moved, no hit target changed
and no focus order changed.

The rest of the UI (cards, rows, chips, the small pills inside them) keeps the
cheaper translucency from the `.g` class: those sit under the 3D depth
transform, and a `backdrop-filter` inside a transformed layer is exactly what
makes WebView tile and flash.

## Rebuilding the bundle

```bash
npm i esbuild@0.25.0
npx esbuild src/index.mjs --bundle --format=iife --global-name=LiquidGlass \
  --minify --target=chrome100 --outfile=liquidglass.min.js
```

Then inline `liquidglass.min.js` into `assets/index.html` (the app is one
self-contained page; there is no second request to make, and none to fail
offline).

## Licence

Apache-2.0. The upstream `LICENSE` and `NOTICE` are reproduced here in full, as
the licence requires. Modifications: none to the modules — the app only bundles
them, and drives them through attributes and a scheme-sync script.
