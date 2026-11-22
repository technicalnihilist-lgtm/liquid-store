/** Apache-2.0. The canvas engine: the production shaders through the ports/skia CanvasKit painter.
 *
 * Loaded by <liquid-glass> only when an element asks for engine="canvas", so pages that use the
 * HTML engine never fetch CanvasKit or the shader bundle. One WebGL context is shared by every
 * element on the page (browsers cap live contexts at about 16): each element's glass is drawn on
 * the shared surface, then copied into the element's own 2D canvas.
 */
import {createGlassPainter} from './vendor/skia/painter.mjs';
export {configureCanvasKit, loadCanvasKit} from './canvaskit.mjs';

/** The backdrop pad around an element, CSS px: blur and sampling stay inside the supplied image. */
export const SOURCE_PAD = 32;

/**
 * Where the source lands in the padded backdrop, CSS px relative to the backdrop's top left.
 * A source that is laid out on the page (an <img>, <canvas> or <video> in the document) is placed
 * where it is on screen relative to the glass, so the glass shows what is under it. Anything else
 * (an ImageBitmap, an offscreen canvas, a detached element) covers the glass's own box.
 */
export function sourcePlacement({hostRect, sourceRect, sourceWidth, sourceHeight, pad = SOURCE_PAD}) {
  if (sourceRect && sourceRect.width > 0 && sourceRect.height > 0)
    return {x: sourceRect.left - hostRect.left + pad, y: sourceRect.top - hostRect.top + pad,
      width: sourceRect.width, height: sourceRect.height};
  const scale = Math.max(hostRect.width / sourceWidth, hostRect.height / sourceHeight);
  const width = sourceWidth * scale, height = sourceHeight * scale;
  return {x: pad + (hostRect.width - width) / 2, y: pad + (hostRect.height - height) / 2, width, height};
}

const intrinsicSize = source =>
  source instanceof (globalThis.HTMLVideoElement ?? class {}) ? [source.videoWidth, source.videoHeight] :
  source instanceof (globalThis.HTMLImageElement ?? class {}) ? [source.naturalWidth, source.naturalHeight] :
  [source.width, source.height];

/** Whether the source has pixels to draw yet (an image that loaded, a video with a frame). */
export function sourceReady(source) {
  if (!source) return false;
  if (globalThis.HTMLImageElement && source instanceof HTMLImageElement) return source.complete && source.naturalWidth > 0;
  if (globalThis.HTMLVideoElement && source instanceof HTMLVideoElement) return source.readyState >= 2;
  const [w, h] = intrinsicSize(source);
  return w > 0 && h > 0;
}

let shared = null;

function sharedContext(kit) {
  if (shared?.kit !== kit) shared = {kit, canvas: document.createElement('canvas'), lost: false, listeners: new Set()};
  const s = shared;
  if (!s.wired) {
    s.wired = true;
    s.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      s.lost = true;
      try { s.painter?.dispose(); } catch {}
      try { s.surface?.delete(); } catch {}
      s.painter = s.surface = s.context = null;
      s.width = s.height = 0;
    });
    s.canvas.addEventListener('webglcontextrestored', () => {
      s.lost = false;
      for (const listener of s.listeners) listener();
    });
  }
  if (s.lost) return s;
  if (!s.context && !s.raster) {
    s.handle ??= kit.GetWebGLContext(s.canvas, {preserveDrawingBuffer: 1});
    s.context = s.handle ? kit.MakeWebGLContext(s.handle) : null;
    if (!s.context) s.raster = true; // no WebGL: CanvasKit's CPU raster surface, slower but exact
  }
  s.painter ??= createGlassPainter(kit);
  return s;
}

function surfaceFor(s, width, height) {
  const kit = s.kit;
  if (s.surface && s.width >= width && s.height >= height) return s.surface;
  s.surface?.delete();
  s.width = Math.max(width, s.width ?? 0); s.height = Math.max(height, s.height ?? 0);
  if (s.raster) {
    s.surface = kit.MakeSurface(s.width, s.height);
  } else {
    s.canvas.width = s.width; s.canvas.height = s.height;
    s.surface = kit.MakeOnScreenGLSurface(s.context, s.width, s.height, kit.ColorSpace.SRGB);
  }
  if (!s.surface) throw new Error('Could not create the CanvasKit surface');
  return s.surface;
}

/**
 * One element's renderer. `draw` paints the source into a padded backdrop, runs the production
 * in-app material over it (GlassStyle.inApp through painter.drawSurface) and copies the result
 * into `target`, a 2D canvas the element owns. Returns false while the shared context is lost.
 */
export function createCanvasRenderer(kit, target, onRestore) {
  const s = sharedContext(kit);
  if (onRestore) s.listeners.add(onRestore);
  const backdrop = document.createElement('canvas');
  let disposed = false;
  return {
    get backend() { return s.raster ? 'raster' : 'webgl'; },
    draw({source, hostRect, sourceRect, width, height, radius, dpr, dark, tint = null,
      reducedTransparency = 0, increasedContrast = 0, ground = '#000'}) {
      if (disposed) throw new Error('Renderer disposed');
      const ctx = sharedContext(kit);
      if (ctx.lost) return false;
      const pad = SOURCE_PAD;
      const bw = Math.max(1, Math.round((width + 2 * pad) * dpr)), bh = Math.max(1, Math.round((height + 2 * pad) * dpr));
      backdrop.width = bw; backdrop.height = bh;
      const b = backdrop.getContext('2d');
      // The production painter needs an opaque source; the ground shows where the source ends.
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.fillStyle = ground; b.fillRect(0, 0, bw, bh);
      const [sw, sh] = intrinsicSize(source);
      const at = sourcePlacement({hostRect, sourceRect, sourceWidth: sw, sourceHeight: sh, pad});
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.drawImage(source, at.x, at.y, at.width, at.height);
      const image = kit.MakeImageFromCanvasImageSource(backdrop);
      if (!image) throw new Error('CanvasKit could not read the source');
      const w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr));
      try {
        const surface = surfaceFor(ctx, w, h);
        const canvas = surface.getCanvas();
        canvas.clear(kit.TRANSPARENT);
        ctx.painter.setSource(image);
        canvas.save();
        try {
          canvas.translate(-pad * dpr, -pad * dpr);
          ctx.painter.drawSurface(canvas, {x: pad * dpr, y: pad * dpr, width: width * dpr, height: height * dpr,
            radius: radius * dpr}, {dark, density: dpr, tintAmount: 50, tint, reducedTransparency, increasedContrast});
        } finally { canvas.restore(); }
        surface.flush();
        if (target.width !== w) target.width = w;
        if (target.height !== h) target.height = h;
        const out = target.getContext('2d');
        out.clearRect(0, 0, w, h);
        if (ctx.raster) {
          const pixels = canvas.readPixels(0, 0, {width: w, height: h, colorType: kit.ColorType.RGBA_8888,
            alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB});
          out.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, w * h * 4), w, h), 0, 0);
        } else {
          out.drawImage(ctx.canvas, 0, 0, w, h, 0, 0, w, h);
        }
      } finally {
        image.delete();
      }
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (onRestore) s.listeners.delete(onRestore);
      backdrop.width = backdrop.height = 0;
    },
  };
}
