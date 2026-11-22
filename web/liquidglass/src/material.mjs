/** Apache-2.0. The material numbers of <liquid-glass>, with where each one comes from.
 *
 * Every number below is either INHERITED from the Kotlin library (and then the Kotlin source says
 * whether it was measured on iOS captures or authored there) or AUTHORED here for CSS. Nothing is
 * re-fitted. test/provenance.test.mjs parses the Kotlin sources and fails if an inherited value
 * drifts from them.
 *
 * Units: the library's constants are dp, which is the iPhone's pt the measurements were made in.
 * This package takes 1 CSS px = 1 dp (authored convention; iOS Safari also maps 1 CSS px to 1 pt).
 */

const KT = 'liquidglass/src/commonMain/kotlin/com/wexpa/liquidglass/';
export const KOTLIN_SOURCES = Object.freeze({
  material: KT + 'GlassMaterial.kt',
  style: KT + 'GlassStyle.kt',
  glass: KT + 'Glass.kt',
  shader: KT + 'GlassShaderSource.kt',
  sourceMap: KT + 'GlassSourceMapSource.kt',
  restMap: KT + 'GlassRestMap.kt',
  normal: KT + 'GlassNormalSource.kt',
  oklab: KT + 'GlassOklabSource.kt',
  host: KT + 'LiquidGlass.kt',
});

/** The default Tint Amount (GlassMaterial.DEFAULT_TINT_AMOUNT). Glass.Regular uses it. */
export const DEFAULT_TINT_AMOUNT = 50;

/** Measured (tint, opacity) pairs: GlassMaterial.LIGHT_OPACITY / DARK_OPACITY. */
export const LIGHT_OPACITY = Object.freeze([0, 0.435, 31, 0.514, 50, 0.565, 62, 0.600, 100, 0.733]);
export const DARK_OPACITY = Object.freeze([0, 0.416, 29, 0.439, 50, 0.451, 62, 0.510, 86, 0.655, 100, 0.737]);

/** GlassMaterial.interpolate: linear in a flat (tint, value, ...) table, clamped at its ends. */
export function interpolate(table, tintAmount) {
  const t = Math.min(100, Math.max(0, tintAmount));
  let i = 0;
  while (i < table.length - 4 && table[i + 2] <= t) i += 2;
  const [t0, a0, t1, a1] = [table[i], table[i + 1], table[i + 2], table[i + 3]];
  const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  return a0 + (a1 - a0) * f;
}

/** GlassMaterial.opacity(dark, tintAmount). */
export const opacity = (dark, tintAmount = DEFAULT_TINT_AMOUNT) =>
  interpolate(dark ? DARK_OPACITY : LIGHT_OPACITY, tintAmount);
/** GlassMaterial.fineKernel: sigma of the fine kernel, dp. */
export const fineKernel = (tintAmount = DEFAULT_TINT_AMOUNT) => {
  const u = Math.min(1, Math.max(0, tintAmount / 100));
  return 0.5 + 1.5 * u * u;
};
/** GlassMaterial.fineShare: share of the fine kernel in the backdrop term. */
export const fineShare = (tintAmount = DEFAULT_TINT_AMOUNT) =>
  Math.min(1, Math.max(0, 0.95 * Math.pow(1 - Math.min(1, Math.max(0, tintAmount / 100)), 1.5)));

/** Compose stores an sRGB Color in 8 bits per channel; the shader sees the quantized value. */
export const quantize = x => Math.round(Math.min(1, Math.max(0, x)) * 255) / 255;

/** GlassLight.Default: the light, above and slightly left, y negative upward. */
export const LIGHT = Object.freeze({x: -0.35, y: -0.94});

/** GlassMaterial.BEVEL_RATIO: the measured band is 0.6 of the corner radius. */
export const BEVEL_RATIO = 0.6;

/**
 * Glass.Regular = GlassStyle.inApp(dark) at the default Tint Amount (measured in Kotlin).
 * Profile 'measured': the shader's inward rest map at the corner arcs, two-kernel backdrop.
 */
export function regularStyle(dark) {
  const a = quantize(opacity(dark, DEFAULT_TINT_AMOUNT));
  const grey = dark ? 0 : 241 / 255;
  return Object.freeze({
    variant: 'regular', profile: 'measured', dark,
    tint: Object.freeze([grey, grey, grey, a]),
    lift: dark ? 35 / 255 : 0,
    fineSigma: fineKernel(), wideSigma: 10, fineShare: fineShare(),
    // GlassStyle.inApp edge line (rim fit, 2026-09-12)
    bevel: 1.33, bevelPeak: 0.25, specular: 0.25, specularPower: 6, counterLight: 1, edgeLight: 0,
    fresnel: 0, innerShadow: 0, ior: 1.5, bevelPower: 2, glow: 0.05,
    // The measured profile derives its band from the shape (0.6 R); depth is unused by its map.
    refractionBand: null, refractionDepth: 14, legibility: 0.6,
    light: LIGHT,
  });
}

/**
 * Glass.Clear = GlassStyle.Clear (authored in Kotlin: the 0.1 "legacy" model, Apple's zero adaptivity).
 * Same in both appearances, as in Kotlin.
 */
export function clearStyle() {
  return Object.freeze({
    variant: 'clear', profile: 'legacy', dark: false,
    tint: Object.freeze([1, 1, 1, quantize(0.04)]), lift: 0,
    // blurRadius 4 dp is a scatter disc; its sigma is about 0.6 of the radius (GlassStyle.inApp note).
    fineSigma: 4 * 0.6, wideSigma: 0, fineShare: 1,
    bevel: 4, bevelPeak: 0, specular: 0.70, specularPower: 6, counterLight: 0.35, edgeLight: 1,
    fresnel: 0.14, innerShadow: 0.05, ior: 1.5, bevelPower: 2, glow: 0,
    refractionBand: 28, refractionDepth: 16, legibility: 0,
    mirror: 0.22, dispersion: 0.030, dimmingLayer: 0.35, highlightChroma: 0.7,
    light: LIGHT,
  });
}

export const resolveStyle = (variant, dark) => variant === 'clear' ? clearStyle() : regularStyle(dark);

/** Compose's elementSizeFactor: 0 for chrome up to 56 dp, 1 from 320 dp. */
export const sizeFactor = (width, height) =>
  Math.min(1, Math.max(0, (Math.min(width, height) - 56) / (320 - 56)));

/**
 * The tint layer CSS paints over the (filtered) backdrop, as {rgb: [r,g,b] 0..1, alpha, exact}.
 *
 * The shader computes `mix(bg, tint, s) + lift` with s = tint alpha (times the legacy size term)
 * clamped to 0.95. One normal-blend layer of colour c at alpha s gives `(1 - s) bg + s c`, which is
 * the same thing when c = tint + lift / s. That is exact algebra, not an approximation, as long as c
 * stays within 0..1; `exact` is false when a channel had to be clamped (a bright tint with the lift).
 * `tint` is [r, g, b, a] sRGB 0..1 (Glass.tint replaces the style's tint, its alpha the opacity).
 * Not reproduced: the shader's legibility term (contrast * legibility * 0.25), which reads the backdrop.
 */
export function tintLayer(style, {tint = null, width = 0, height = 0, reducedTransparency = 0} = {}) {
  const color = tint ? tint.map(quantize) : style.tint;
  const sizeTerm = style.profile === 'legacy' ? 0.9 + (1.25 - 0.9) * sizeFactor(width, height) : 1;
  const frost = Math.min(1, Math.max(0, reducedTransparency)) * 0.35;
  const s = Math.min(0.95, Math.max(0, color[3] * sizeTerm + frost));
  if (s <= 0) return {rgb: [0, 0, 0], alpha: 0, exact: style.lift === 0};
  let exact = true;
  const rgb = color.slice(0, 3).map(c => {
    const v = c + style.lift / s;
    if (v > 1 + 1e-9) exact = false;
    return Math.min(1, v);
  });
  return {rgb, alpha: s, exact};
}

/** Parse the colour strings browsers serialize (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba()).
 * Returns [r, g, b, a] in 0..1, or null. Other syntaxes are resolved by the element in a canvas. */
export function parseColor(text) {
  if (typeof text !== 'string') return null;
  const s = text.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map(c => c + c).join('');
    const n = [0, 2, 4, 6].map(i => i < h.length ? parseInt(h.slice(i, i + 2), 16) / 255 : 1);
    return n;
  }
  m = /^rgba?\(\s*([^)]*)\)$/.exec(s);
  if (!m) return null;
  const parts = m[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const channel = p => p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p) / 255;
  const alpha = p => p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p);
  const out = [channel(parts[0]), channel(parts[1]), channel(parts[2]), parts[3] === undefined ? 1 : alpha(parts[3])];
  if (!out.every(Number.isFinite)) return null;
  return out.map(v => Math.min(1, Math.max(0, v)));
}

/**
 * Where every number used by the HTML engine comes from. `kind` is 'inherited' (copied from the
 * Kotlin library; `kotlin` says whether it is measured or authored there) or 'authored' (chosen
 * here for CSS). The README's provenance table is this list.
 */
export const PROVENANCE = Object.freeze([
  {name: 'Regular light tint', value: '241/255 grey at 0.565 (quantized 144/255)', kind: 'inherited', kotlin: 'measured', source: 'GlassMaterial.lightTint, LIGHT_OPACITY'},
  {name: 'Regular dark tint and lift', value: 'black at 0.451 (115/255) + 35/255', kind: 'inherited', kotlin: 'measured', source: 'GlassMaterial.DARK_OPACITY, DARK_LIFT'},
  {name: 'Fine kernel sigma', value: '0.875 dp at Tint 50', kind: 'inherited', kotlin: 'measured', source: 'GlassMaterial.fineKernel'},
  {name: 'Wide kernel sigma', value: '10 dp', kind: 'inherited', kotlin: 'measured', source: 'GlassMaterial.wideKernel'},
  {name: 'Fine share', value: '0.95 (1 - t/100)^1.5 = 0.336 at Tint 50', kind: 'inherited', kotlin: 'measured', source: 'GlassMaterial.fineShare'},
  {name: 'Refraction band', value: '0.6 of the corner radius', kind: 'inherited', kotlin: 'measured', source: 'GlassMaterial.BEVEL_RATIO, GlassStyle.bandPx'},
  {name: 'Resting corner source map', value: 'restSourceLegacy table; straight runs u + 0.06 (1-u)^2', kind: 'inherited', kotlin: 'measured', source: 'GlassRestMap.kt, GlassSourceMapSource.kt foldSource'},
  {name: 'Regular rim', value: 'bevel 1.33 dp, peak 0.25, specular 0.25, power 6, counter-light 1, glow 0.05', kind: 'inherited', kotlin: 'measured', source: 'GlassStyle.inApp, GlassShaderSource lighting'},
  {name: 'Light direction', value: '(-0.35, -0.94)', kind: 'inherited', kotlin: 'authored', source: 'GlassLight.Default'},
  {name: 'Clear tint', value: 'white at 0.04 x (0.9..1.25 by size)', kind: 'inherited', kotlin: 'authored', source: 'GlassStyle.Clear, shader strength term'},
  {name: 'Clear refraction', value: 'Snell bevel, band 28 dp, depth 16 dp x (0.85..1.25 by size), IOR 1.5', kind: 'inherited', kotlin: 'authored', source: 'GlassStyle.Clear, snellShift, bevelSlope'},
  {name: 'Clear scatter', value: 'radius 4 dp, sigma 0.6 x radius = 2.4 dp, crisp rim (1-e)^2', kind: 'inherited', kotlin: 'authored', source: 'GlassStyle.Clear.blurRadius, GlassStyle.inApp note'},
  {name: 'Clear rim', value: 'bevel 4 dp, specular 0.70, power 6, counter-light 0.35, edge light 1, fresnel 0.14', kind: 'inherited', kotlin: 'authored', source: 'GlassStyle.Clear'},
  {name: 'Size factor', value: '(min edge - 56) / 264 dp', kind: 'inherited', kotlin: 'authored', source: 'elementSizeFactor'},
  {name: 'Press glow', value: '+0.06 at the pointer, Gaussian sigma = short edge', kind: 'inherited', kotlin: 'authored (tuned against a device)', source: 'GlassShaderSource touch illumination'},
  {name: 'Press feedback', value: 'Calm controller: scale 1.03, 2 px per edge, springs', kind: 'inherited', kotlin: 'authored', source: 'ports/web interaction.mjs (Compose Calm)'},
  {name: '1 CSS px = 1 dp', value: '', kind: 'authored', kotlin: null, source: 'this package'},
  {name: 'Backdrop pad', value: '32 px around the element, clipped back to its shape', kind: 'authored', kotlin: null, source: 'this package'},
  {name: 'Frost fallback blur', value: 'the same two kernels as two stacked backdrop-filter layers; no refraction', kind: 'authored', kotlin: null, source: 'this package'},
  {name: 'Fallback saturation', value: 'saturate(1) by default (the measured model has no saturation term)', kind: 'authored', kotlin: null, source: 'this package (--liquid-glass-saturation)'},
  {name: 'Increase Contrast solid', value: 'mix toward 0.97 (light) or 0.02 (dark) at 0.88, chosen by scheme', kind: 'authored', kotlin: null, source: 'this package; Kotlin chooses by backdrop luma'},
]);
