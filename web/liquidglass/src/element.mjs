/** Apache-2.0. <liquid-glass>: a standard custom element. Its children stay ordinary HTML above
 * the glass; the glass itself is drawn in its shadow root and never takes clicks or focus.
 *
 * engine="html" (default) refracts the live page behind it with CSS backdrop-filter: an SVG
 * displacement filter in Chromium, a frosted blur elsewhere. engine="canvas" draws the production
 * shaders through CanvasKit over a `source` the page provides. See README.md for the trade-offs.
 */
import {parseAttributes, cornerRadius, isDark, detectLensing, detectBackdropFilter, selectEngine,
  parseVariant, parseShape, parseScheme, parseEngine, parseLensing, parseRadius} from './engine.mjs';
import {resolveStyle, tintLayer, parseColor} from './material.mjs';
import {displacementMap, rimMap} from './optics.mjs';
import {createCalmInteraction} from './vendor/skia/interaction.mjs';

/** Filter pad, CSS px (authored): the SVG filter region and its displacement map reach this far
 * beyond the element, so blur and outward refraction (Clear) can read the page around it. The glass
 * layer's own border-radius clips the result: Chromium clips backdrop-filter output to the element's
 * rounded border box, but not to an ancestor's or a clip-path's rounding (checked 18 October 2026). */
const PAD = 32;
const OBSERVED = ['variant', 'shape', 'radius', 'tint', 'scheme', 'engine', 'interactive', 'lensing'];
const Base = globalThis.HTMLElement ?? class {};
const now = () => performance.now() / 1000;
let serial = 0;

const STYLE = `
:host{display:inline-block;position:relative;box-sizing:border-box;vertical-align:middle;
  -webkit-tap-highlight-color:transparent}
:host([hidden]){display:none}
.material{position:absolute;inset:0;pointer-events:none;transform-origin:50% 50%;border-radius:inherit}
.glass{position:absolute;inset:0;border-radius:inherit}
.wide{display:none}
.tint{position:absolute;inset:0;border-radius:inherit}
.shader,.rim{position:absolute;inset:0;width:100%;height:100%;display:block}
.shader{display:none;border-radius:inherit}
.highlight{position:absolute;inset:0;border-radius:inherit;opacity:0;transition:opacity .12s ease-out}
.content{position:relative}
svg{position:absolute;width:0;height:0;overflow:hidden}
.probe{display:none}
@media (prefers-reduced-motion: reduce){.highlight{transition:none}}
`;

const supportsLensing = () => (LiquidGlassElement._lensing ??= detectLensing());
const supportsBackdrop = () => (LiquidGlassElement._backdrop ??= detectBackdropFilter());

function dataUrl(map) {
  const canvas = document.createElement('canvas');
  canvas.width = map.width; canvas.height = map.height;
  canvas.getContext('2d').putImageData(new ImageData(map.data, map.width, map.height), 0, 0);
  return canvas.toDataURL('image/png');
}

/** The SVG filter primitives of the lens path, in the padded box's user space (CSS px). */
function filterMarkup(style, {width, height, href, scale}) {
  const box = `x="${-PAD}" y="${-PAD}" width="${width}" height="${height}"`;
  const map = `<feImage ${box} preserveAspectRatio="none" href="${href}" result="map"/>`;
  const displace = (input, result) =>
    `<feDisplacementMap in="${input}" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="${result}"/>`;
  if (style.profile === 'measured') {
    // Two kernels mixed by the fine share, then sampled where the rest map says.
    const s = style.fineShare;
    return `<feGaussianBlur in="SourceGraphic" stdDeviation="${style.fineSigma}" result="fine"/>` +
      `<feGaussianBlur in="SourceGraphic" stdDeviation="${style.wideSigma}" result="wide"/>` +
      `<feComposite in="fine" in2="wide" operator="arithmetic" k1="0" k2="${s}" k3="${1 - s}" k4="0" result="tone"/>` +
      map + displace('tone', 'out');
  }
  // Legacy (Clear): a crisp copy at the rim, the scattered copy inside, mixed by (1 - e)^2 (map B).
  return `<feGaussianBlur in="SourceGraphic" stdDeviation="${style.fineSigma}" result="soft"/>` + map +
    displace('soft', 'dsoft') + displace('SourceGraphic', 'dsharp') +
    `<feColorMatrix in="map" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0" result="crisp"/>` +
    `<feComposite in="dsharp" in2="crisp" operator="in" result="rim"/>` +
    `<feComposite in="dsoft" in2="crisp" operator="out" result="inside"/>` +
    `<feComposite in="rim" in2="inside" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="out"/>`;
}

/** The press glow: the shader's +0.06 Gaussian (sigma = short edge) as radial-gradient stops. */
function glowGradient(sigma) {
  const stops = [0, 0.5, 1, 1.5, 2, 3].map(k => `rgb(255 255 255 / ${(0.06 * Math.exp(-k * k)).toFixed(5)}) ${(k * sigma).toFixed(1)}px`);
  return `radial-gradient(circle at var(--lg-gx, 50%) var(--lg-gy, 50%), ${stops.join(', ')})`;
}

export class LiquidGlassElement extends Base {
  static get observedAttributes() { return OBSERVED; }
  /** Whether this browser lenses the live page (Chromium); otherwise the HTML engine frosts. */
  static get lensingSupported() { return supportsLensing(); }

  #root; #parts; #size = {width: 0, height: 0}; #frame = 0; #observer = null; #queries = null;
  #cache = {}; #source = null; #canvas = null; #canvasFailed = false; #canvasLoading = null;
  #motion = null; #motionFrame = 0; #gesture = null; #state = {engine: 'html', optics: 'frost', reason: null};
  #listeners = []; #videoFrame = 0; #filterId = `liquid-glass-${++serial}`;

  constructor() {
    super();
    this.#root = this.attachShadow({mode: 'open'});
    this.#root.innerHTML = `<style>${STYLE}</style>` +
      `<svg aria-hidden="true" focusable="false"><filter id="${this.#filterId}" filterUnits="userSpaceOnUse" ` +
      `primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB"></filter></svg>` +
      `<div class="material" part="material" aria-hidden="true">` +
      `<div class="glass base" part="glass"></div><div class="glass wide"></div>` +
      `<div class="tint" part="tint"></div><canvas class="shader" part="canvas"></canvas>` +
      `<canvas class="rim" part="rim"></canvas><div class="highlight" part="highlight"></div></div>` +
      `<div class="content" part="content"><slot></slot></div><span class="probe"></span>`;
    const q = s => this.#root.querySelector(s);
    this.#parts = {filter: q('filter'), material: q('.material'), base: q('.base'), wide: q('.wide'),
      tint: q('.tint'), shader: q('.shader'), rim: q('.rim'), highlight: q('.highlight'), probe: q('.probe')};
  }

  // Reflected attributes. Setting a property writes the attribute; reading parses it.
  get variant() { return parseVariant(this.getAttribute('variant')); }
  set variant(v) { this.setAttribute('variant', v); }
  get shape() { return parseShape(this.getAttribute('shape')); }
  set shape(v) { this.setAttribute('shape', v); }
  get radius() { return parseRadius(this.getAttribute('radius')); }
  set radius(v) { this.setAttribute('radius', String(v)); }
  get tint() { return this.getAttribute('tint'); }
  set tint(v) { if (v == null || v === '') this.removeAttribute('tint'); else this.setAttribute('tint', v); }
  get scheme() { return parseScheme(this.getAttribute('scheme')); }
  set scheme(v) { this.setAttribute('scheme', v); }
  get engine() { return parseEngine(this.getAttribute('engine')); }
  set engine(v) { this.setAttribute('engine', v); }
  get interactive() { return this.hasAttribute('interactive'); }
  set interactive(v) { this.toggleAttribute('interactive', !!v); }
  get lensing() { return parseLensing(this.getAttribute('lensing')); }
  set lensing(v) { this.setAttribute('lensing', v); }

  /** What the canvas engine refracts: an image, canvas, video or ImageBitmap (same-origin or CORS). */
  get source() { return this.#source; }
  set source(value) {
    this.#source = value ?? null;
    this.#canvasFailed = false;
    this.#watchSource();
    this.#schedule();
  }

  /** What is drawing now: {engine: 'html'|'canvas', optics: 'lens'|'frost'|'flat'|'shader', reason}. */
  get renderState() { return {...this.#state}; }

  /** Draw again: call after the pixels of a canvas `source` change. The HTML engine needs no call. */
  refresh() { this.#schedule(); }

  connectedCallback() {
    this.#observer = new ResizeObserver(entries => {
      const box = entries[entries.length - 1].borderBoxSize?.[0];
      const rect = box ? {width: box.inlineSize, height: box.blockSize} : this.getBoundingClientRect();
      this.#size = {width: rect.width, height: rect.height};
      this.#motion?.resize({width: rect.width || 1, height: rect.height || 1,
        radius: cornerRadius(parseAttributes(n => this.getAttribute(n)), rect.width, rect.height)}, now());
      this.#schedule();
    });
    this.#observer.observe(this);
    const media = q => globalThis.matchMedia?.(q) ?? null;
    this.#queries = {dark: media('(prefers-color-scheme: dark)'), reduced: media('(prefers-reduced-motion: reduce)'),
      contrast: media('(prefers-contrast: more)'), transparency: media('(prefers-reduced-transparency: reduce)')};
    for (const query of Object.values(this.#queries)) this.#listen(query, 'change', () => {
      this.#syncReducedMotion();
      this.#schedule();
    });
    this.#listen(globalThis, 'resize', () => this.#schedule(), {passive: true});
    this.#listen(this, 'pointerdown', e => this.#down(e), {passive: true});
    this.#listen(this, 'keydown', e => this.#key(e, true));
    this.#listen(this, 'keyup', e => this.#key(e, false));
    this.#watchSource();
    this.#schedule();
  }

  disconnectedCallback() {
    this.#observer?.disconnect(); this.#observer = null;
    for (const [target, type, fn, options] of this.#listeners) target?.removeEventListener?.(type, fn, options);
    this.#listeners = [];
    this.#endGesture();
    cancelAnimationFrame(this.#frame); this.#frame = 0;
    cancelAnimationFrame(this.#motionFrame); this.#motionFrame = 0;
    this.#unwatchSource();
    this.#canvas?.renderer?.dispose(); this.#canvas = null;
    this.#motion = null;
  }

  attributeChangedCallback(name) {
    if (name === 'engine') this.#canvasFailed = false;
    if (name === 'interactive' && !this.hasAttribute('interactive')) { this.#endGesture(); this.#applyMotion(null); }
    this.#schedule();
  }

  #listen(target, type, fn, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn, options);
    this.#listeners.push([target, type, fn, options]);
  }

  #schedule() {
    if (this.#frame || !this.isConnected) return;
    this.#frame = requestAnimationFrame(() => { this.#frame = 0; this.#render(); });
  }

  #setState(state) {
    this.#state = state;
    // Reflect for styling and tests; never set in the constructor.
    if (this.dataset.engine !== state.engine) this.dataset.engine = state.engine;
    if (this.dataset.optics !== state.optics) this.dataset.optics = state.optics;
  }

  /** Any CSS colour (including var() and modern spaces) as sRGB [r, g, b, a], or null if invalid. */
  #color(text) {
    const probe = this.#parts.probe;
    probe.style.color = '';
    probe.style.color = text;
    if (!probe.style.color) return null;
    const computed = getComputedStyle(probe).color;
    const parsed = parseColor(computed);
    if (parsed) return parsed;
    const c = (LiquidGlassElement._colorCanvas ??= document.createElement('canvas'));
    c.width = c.height = 1;
    const g = c.getContext('2d', {willReadFrequently: true});
    g.clearRect(0, 0, 1, 1); g.fillStyle = computed; g.fillRect(0, 0, 1, 1);
    const [r, gr, b, a] = g.getImageData(0, 0, 1, 1).data;
    return a ? [r / 255, gr / 255, b / 255, a / 255] : [0, 0, 0, 0];
  }

  #render() {
    if (!this.isConnected) return;
    const attrs = parseAttributes(n => this.getAttribute(n));
    let {width, height} = this.#size;
    if (!(width > 0 && height > 0)) {
      const rect = this.getBoundingClientRect();
      ({width, height} = rect);
      if (!(width > 0 && height > 0)) return;
      this.#size = {width, height};
    }
    const dpr = Math.min(4, Math.max(1, globalThis.devicePixelRatio || 1));
    const dark = isDark(attrs.scheme, this.#queries?.dark?.matches);
    const style = resolveStyle(attrs.variant, dark);
    const radius = cornerRadius(attrs, width, height);
    const tint = attrs.tint ? this.#color(attrs.tint) : null;
    const contrast = this.#queries?.contrast?.matches ? 1 : 0;
    const transparency = this.#queries?.transparency?.matches ? 1 : 0;

    // The host's own style attribute belongs to the page (and its framework): set nothing there.
    this.#parts.material.style.borderRadius = `${radius}px`;
    this.#updateMotion(attrs, width, height, radius);

    const ready = attrs.engine === 'canvas' && this.#canvas?.renderer && this.#source && this.#sourceReady();
    let selected = selectEngine({engine: attrs.engine, variant: attrs.variant, hasSource: !!this.#source,
      canvasFailed: this.#canvasFailed, lensing: attrs.lensing, lensingSupported: supportsLensing(),
      backdropSupported: supportsBackdrop()});
    if (selected.engine === 'canvas' && !ready) {
      this.#loadCanvas();
      selected = {...selectEngine({engine: 'html', variant: attrs.variant, lensing: attrs.lensing,
        lensingSupported: supportsLensing(), backdropSupported: supportsBackdrop()}),
        reason: this.#canvas?.renderer ? 'canvas-source-pending' : 'canvas-loading'};
    }

    if (selected.engine === 'canvas') {
      try {
        const source = this.#source;
        const inDocument = source instanceof Element && source.isConnected;
        const drawn = this.#canvas.renderer.draw({source, hostRect: this.getBoundingClientRect(),
          sourceRect: inDocument ? source.getBoundingClientRect() : null, width, height, radius, dpr, dark,
          tint, reducedTransparency: transparency, increasedContrast: contrast,
          ground: getComputedStyle(this).getPropertyValue('--liquid-glass-ground').trim() || '#000'});
        if (drawn) {
          this.#showCanvas(true);
          this.#highlightSize(width, height);
          this.#setState(selected);
          return;
        }
      } catch (error) {
        console.warn('<liquid-glass> canvas engine failed; using the HTML engine.', error);
        this.#canvasFailed = true;
        selected = {...selectEngine({engine: 'html', variant: attrs.variant, lensing: attrs.lensing,
          lensingSupported: supportsLensing(), backdropSupported: supportsBackdrop()}), reason: 'canvas-unavailable'};
      }
    }
    this.#showCanvas(false);
    this.#renderHtml(selected, style, {width, height, radius, dpr, tint, contrast, transparency, dark});
    this.#highlightSize(width, height);
    this.#setState(selected);
  }

  #showCanvas(on) {
    const p = this.#parts;
    p.shader.style.display = on ? 'block' : 'none';
    for (const el of [p.base, p.wide, p.tint, p.rim]) el.style.visibility = on ? 'hidden' : '';
  }

  #highlightSize(width, height) {
    const sigma = Math.min(width, height);
    if (this.#cache.glow !== sigma) {
      this.#cache.glow = sigma;
      this.#parts.highlight.style.background = glowGradient(sigma);
    }
  }

  #renderHtml(selected, style, {width, height, radius, dpr, tint, contrast, transparency, dark}) {
    const p = this.#parts;
    // Tint and lift, as one exact normal-blend layer (material.mjs tintLayer).
    const layer = tintLayer(style, {tint, width, height, reducedTransparency: transparency});
    let alpha = layer.alpha;
    if (selected.optics === 'flat') alpha = Math.max(alpha, 0.9); // authored: no backdrop blur at all
    const rgb = layer.rgb.map(v => (v * 255).toFixed(2)).join(' ');
    p.tint.style.backgroundColor = `rgb(${rgb} / ${alpha.toFixed(4)})`;
    // Increase Contrast: the shader mixes toward a near-solid at 0.88 (solid chosen here by scheme).
    p.tint.style.backgroundImage = contrast
      ? `linear-gradient(rgb(${dark ? '5 5 5' : '247 247 247'} / 0.88), rgb(${dark ? '5 5 5' : '247 247 247'} / 0.88))` : '';

    const saturation = 'saturate(var(--liquid-glass-saturation, 1))';
    if (selected.optics === 'lens') {
      const key = `${style.variant}|${style.dark}|${width}|${height}|${radius}|${dpr}`;
      if (this.#cache.filter !== key) {
        this.#cache.filter = key;
        // Map resolution: one sample per CSS px, fewer for very large glass (it is smooth inside).
        const area = (width + 2 * PAD) * (height + 2 * PAD);
        const scale = Math.min(1, Math.sqrt(250000 / area));
        const map = displacementMap(style, {width, height, radius, density: dpr, pad: PAD, scale});
        p.filter.setAttribute('x', String(-PAD)); p.filter.setAttribute('y', String(-PAD));
        p.filter.setAttribute('width', String(width + 2 * PAD));
        p.filter.setAttribute('height', String(height + 2 * PAD));
        p.filter.innerHTML = filterMarkup(style, {width: width + 2 * PAD, height: height + 2 * PAD,
          href: dataUrl(map), scale: map.scale});
      }
      const value = `url(#${this.#filterId}) ${saturation}`;
      p.base.style.backdropFilter = value; p.base.style.webkitBackdropFilter = value;
      p.wide.style.display = 'none';
    } else if (selected.optics === 'frost') {
      const fine = `blur(${style.fineSigma}px) ${saturation}`;
      p.base.style.backdropFilter = fine; p.base.style.webkitBackdropFilter = fine;
      if (style.wideSigma > 0) {
        // fineShare x fine + (1 - fineShare) x wide: the wide layer sees the fine layer's output,
        // and blur(wide) of blur(fine) is blur(sqrt(wide^2 + fine^2)) = 10.04 px for Regular.
        const wide = `blur(${style.wideSigma}px)`;
        p.wide.style.display = 'block';
        p.wide.style.backdropFilter = wide; p.wide.style.webkitBackdropFilter = wide;
        p.wide.style.opacity = String(1 - style.fineShare);
      } else p.wide.style.display = 'none';
    } else {
      p.base.style.backdropFilter = ''; p.base.style.webkitBackdropFilter = '';
      p.wide.style.display = 'none';
    }

    const rimKey = `${style.variant}|${style.dark}|${width}|${height}|${radius}|${dpr}`;
    if (this.#cache.rim !== rimKey) {
      this.#cache.rim = rimKey;
      const rim = rimMap(style, {width, height, radius, density: dpr});
      p.rim.width = rim.width; p.rim.height = rim.height;
      p.rim.getContext('2d').putImageData(new ImageData(rim.data, rim.width, rim.height), 0, 0);
    }
  }

  // Canvas engine ------------------------------------------------------------------------------

  #sourceReady() {
    return this.#canvas?.ready?.(this.#source) ?? false;
  }

  #loadCanvas() {
    if (this.#canvasLoading || this.#canvas?.renderer || this.#canvasFailed) return;
    this.#canvasLoading = (async () => {
      try {
        const engine = await import('./canvas-engine.mjs');
        const kit = await engine.loadCanvasKit();
        if (!this.isConnected) return;
        this.#canvas = {renderer: engine.createCanvasRenderer(kit, this.#parts.shader, () => this.#schedule()),
          ready: engine.sourceReady};
      } catch (error) {
        console.warn('<liquid-glass> engine="canvas" is unavailable; using the HTML engine.', error);
        this.#canvasFailed = true;
      } finally {
        this.#canvasLoading = null;
        this.#schedule();
      }
    })();
  }

  #watchSource() {
    this.#unwatchSource();
    const source = this.#source;
    if (!source || !this.isConnected) return;
    const redraw = () => this.#schedule();
    if (source instanceof (globalThis.HTMLImageElement ?? class {})) this.#listenSource(source, 'load', redraw);
    if (source instanceof (globalThis.HTMLVideoElement ?? class {})) {
      const tick = () => {
        this.#schedule();
        this.#videoFrame = source.requestVideoFrameCallback ? source.requestVideoFrameCallback(tick)
          : requestAnimationFrame(tick);
      };
      this.#listenSource(source, 'loadeddata', redraw);
      this.#videoFrame = source.requestVideoFrameCallback ? source.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    }
    // A laid-out source moves relative to the glass when the page scrolls.
    if (source instanceof (globalThis.Element ?? class {})) this.#listenSource(globalThis, 'scroll', redraw, {passive: true, capture: true});
  }

  #sourceListeners = [];
  #listenSource(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    this.#sourceListeners.push([target, type, fn, options]);
  }

  #unwatchSource() {
    for (const [target, type, fn, options] of this.#sourceListeners) target.removeEventListener(type, fn, options);
    this.#sourceListeners = [];
    if (this.#videoFrame) {
      const video = this.#source;
      if (video?.cancelVideoFrameCallback) video.cancelVideoFrameCallback(this.#videoFrame);
      else cancelAnimationFrame(this.#videoFrame);
      this.#videoFrame = 0;
    }
  }

  // Interaction ---------------------------------------------------------------------------------

  #updateMotion(attrs, width, height, radius) {
    if (!attrs.interactive) { this.#motion = null; return; }
    if (!this.#motion) {
      this.#reducedMotion = !!this.#queries?.reduced?.matches;
      this.#motion = createCalmInteraction({width, height, radius, reducedMotion: this.#reducedMotion});
      this.#motionSize = `${width}|${height}|${radius}`;
    } else if (this.#motionSize !== `${width}|${height}|${radius}`) {
      this.#motionSize = `${width}|${height}|${radius}`;
      this.#motion.resize({width, height, radius}, now());
    }
  }
  #motionSize = '';

  #down(event) {
    if (!this.interactive || this.#gesture || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (!this.#motion) this.#render();
    if (!this.#motion) return;
    this.#syncReducedMotion();
    const gesture = {id: event.pointerId, x: event.clientX, y: event.clientY};
    this.#gesture = gesture;
    const move = e => {
      if (e.pointerId !== gesture.id) return;
      this.#glowAt(e.clientX, e.clientY);
      this.#motion?.press(now(), e.clientX - gesture.x, e.clientY - gesture.y);
      this.#animate();
    };
    const end = e => { if (e.pointerId === gesture.id) this.#endGesture(); };
    gesture.off = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
    };
    addEventListener('pointermove', move, {passive: true});
    addEventListener('pointerup', end, {passive: true});
    addEventListener('pointercancel', end, {passive: true});
    this.#glowAt(event.clientX, event.clientY);
    this.#motion.press(now());
    this.#parts.highlight.style.opacity = '1';
    this.#animate();
  }

  #key(event, down) {
    if (!this.interactive || (event.key !== ' ' && event.key !== 'Enter')) return;
    if (down) {
      if (event.repeat || this.#gesture) return;
      if (!this.#motion) this.#render();
      if (!this.#motion) return;
      this.#syncReducedMotion();
      this.#gesture = {id: 'key', off() {}};
      this.#parts.highlight.style.setProperty('--lg-gx', '50%');
      this.#parts.highlight.style.setProperty('--lg-gy', '50%');
      this.#motion.press(now());
      this.#parts.highlight.style.opacity = '1';
      this.#animate();
    } else if (this.#gesture?.id === 'key') this.#endGesture();
  }

  // The media query's change event can arrive after the next input, so a press reads it directly.
  // Only a real change resets the motion, so a colour-scheme change or a re-press keeps its release.
  #syncReducedMotion() {
    const reduced = !!this.#queries?.reduced?.matches;
    if (!this.#motion || reduced === this.#reducedMotion) return;
    this.#reducedMotion = reduced;
    this.#motion.setReducedMotion(reduced, now());
  }
  #reducedMotion = false;

  #endGesture() {
    if (!this.#gesture) return;
    this.#gesture.off();
    this.#gesture = null;
    this.#parts.highlight.style.opacity = '0';
    this.#motion?.release(now());
    this.#animate();
  }

  #glowAt(clientX, clientY) {
    const rect = this.getBoundingClientRect();
    this.#parts.highlight.style.setProperty('--lg-gx', `${clientX - rect.left}px`);
    this.#parts.highlight.style.setProperty('--lg-gy', `${clientY - rect.top}px`);
  }

  #animate() {
    if (this.#motionFrame) return;
    const step = () => {
      this.#motionFrame = 0;
      if (!this.#motion) { this.#applyMotion(null); return; }
      const state = this.#motion.sample(now());
      this.#applyMotion(state);
      if (state.active || state.held) this.#motionFrame = requestAnimationFrame(step);
    };
    this.#motionFrame = requestAnimationFrame(step);
  }

  #applyMotion(state) {
    const m = this.#parts.material;
    if (!state || (!state.active && !state.held)) { m.style.transform = ''; return; }
    // Row-major [a, b, c, d] (x' = a x + b y) about the centre, then the material-only offset.
    const [a, b, c, d] = state.matrix, [ox, oy] = state.offset;
    const identity = a === 1 && b === 0 && c === 0 && d === 1 && ox === 0 && oy === 0;
    m.style.transform = identity ? '' : `translate(${ox}px, ${oy}px) matrix(${a}, ${c}, ${b}, ${d}, 0, 0)`;
  }
}

/** Register the element (default name `liquid-glass`). Safe to call more than once, and a no-op
 * outside a browser. Returns the registered constructor. */
export function define(name = 'liquid-glass') {
  const registry = globalThis.customElements;
  if (!registry) return LiquidGlassElement;
  const existing = registry.get(name);
  if (existing) return existing;
  registry.define(name, name === 'liquid-glass' ? LiquidGlassElement : class extends LiquidGlassElement {});
  return registry.get(name);
}

export {configureCanvasKit} from './canvaskit.mjs';
