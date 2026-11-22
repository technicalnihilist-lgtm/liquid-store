/** Apache-2.0. Attribute parsing and engine selection for <liquid-glass>. No DOM access. */

const oneOf = (allowed, fallback) => value => {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return allowed.includes(v) ? v : fallback;
};

export const parseVariant = oneOf(['regular', 'clear'], 'regular');
export const parseShape = oneOf(['capsule', 'rect'], 'capsule');
export const parseScheme = oneOf(['auto', 'light', 'dark'], 'auto');
export const parseEngine = oneOf(['html', 'canvas'], 'html');
export const parseLensing = oneOf(['auto', 'off'], 'auto');

/** Corner radius of `shape="rect"`, CSS px. Missing or invalid values give the default. */
export const DEFAULT_RECT_RADIUS = 16;
export function parseRadius(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_RECT_RADIUS;
  const n = typeof value === 'number' ? value : Number(String(value).trim().replace(/px$/i, ''));
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RECT_RADIUS;
}

/** Boolean attributes follow HTML: present (any value, including "") is true; absent is false. */
export const parseBoolean = value => value !== null && value !== undefined && value !== false;

/** Every attribute at once, from a `getAttribute`-like function. */
export function parseAttributes(get) {
  return {
    variant: parseVariant(get('variant')),
    shape: parseShape(get('shape')),
    radius: parseRadius(get('radius')),
    tint: (get('tint') ?? '').trim() || null,
    scheme: parseScheme(get('scheme')),
    engine: parseEngine(get('engine')),
    interactive: parseBoolean(get('interactive')),
    lensing: parseLensing(get('lensing')),
  };
}

/** The corner radius actually drawn, CSS px: a capsule is half its short side; a rect's radius is
 * limited to its inradius, as the shader's sdRoundRect limits it. */
export function cornerRadius({shape, radius}, width, height) {
  const inradius = Math.max(0, Math.min(width, height) / 2);
  return shape === 'capsule' ? inradius : Math.min(Math.max(0, radius), inradius);
}

/** Whether the scheme is dark, given the attribute and the system preference. */
export const isDark = (scheme, prefersDark) => scheme === 'dark' || (scheme === 'auto' && !!prefersDark);

/**
 * Can this browser lens the live page? Chromium applies an SVG filter referenced by url() in
 * backdrop-filter; Firefox parses the same value (CSS.supports reports true) but does not render
 * it, and Safari does not support url() there. Feature detection alone therefore cannot answer, so
 * both must hold: the CSS parser accepts it AND the engine identifies itself as Chromium through
 * User-Agent Client Hints, which only Chromium-based browsers implement. A browser that hides its
 * brands gets the frosted path, which is the safe failure.
 */
export function detectLensing(env = globalThis) {
  try {
    const css = env.CSS;
    if (!css || typeof css.supports !== 'function') return false;
    const parses = css.supports('backdrop-filter', 'url(#a)') || css.supports('-webkit-backdrop-filter', 'url(#a)');
    const brands = env.navigator?.userAgentData?.brands;
    const chromium = Array.isArray(brands) && brands.some(b => /chromium/i.test(String(b?.brand ?? '')));
    return parses && chromium;
  } catch { return false; }
}

/** Whether any backdrop-filter is available (the frosted path needs it; without it the glass is a
 * tinted surface, which keeps slotted content legible). */
export function detectBackdropFilter(env = globalThis) {
  try {
    const css = env.CSS;
    return !!css?.supports && (css.supports('backdrop-filter', 'blur(1px)') || css.supports('-webkit-backdrop-filter', 'blur(1px)'));
  } catch { return false; }
}

/**
 * Which engine draws, and how. `optics` is what the reader sees:
 *  - 'shader': the canvas engine, production shaders over the given source;
 *  - 'lens':   the HTML engine with SVG refraction (Chromium);
 *  - 'frost':  the HTML engine with blur and tint only;
 *  - 'flat':   no backdrop-filter at all, tint only.
 * `reason` explains a fallback from the requested engine, or is null.
 */
export function selectEngine({engine, variant, hasSource = false, canvasFailed = false,
  lensing = 'auto', lensingSupported = false, backdropSupported = true}) {
  const html = reason => ({
    engine: 'html', reason,
    optics: !backdropSupported ? 'flat' : (lensing !== 'off' && lensingSupported) ? 'lens' : 'frost',
  });
  if (engine !== 'canvas') return html(null);
  if (variant !== 'regular') return html('canvas-variant');
  if (canvasFailed) return html('canvas-unavailable');
  if (!hasSource) return html('canvas-no-source');
  return {engine: 'canvas', optics: 'shader', reason: null};
}
