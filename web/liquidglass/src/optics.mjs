/** Apache-2.0. The production shader's geometry, ported to JavaScript for the HTML engine.
 *
 * CSS cannot run the shader, so the HTML engine bakes the parts that depend only on the shape into
 * two images: a displacement map for an SVG feDisplacementMap (where the backdrop is sampled from)
 * and a rim map (the edge light, added on top). The functions below are line-by-line ports of
 * GlassShaderSource.kt, GlassSourceMapSource.kt, GlassRestMap.kt and GlassNormalSource.kt for one
 * analytic rounded rectangle (circular corners, no fusion, no pose body, glass at rest).
 * test/optics.test.mjs evaluates the SkSL text of the scalar functions next to these ports.
 *
 * Units follow the shader: lengths are DEVICE pixels, dp constants are multiplied by `density`.
 * No DOM access: everything here runs in Node.
 */
import {sizeFactor, BEVEL_RATIO} from './material.mjs';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const mix = (a, b, t) => a + (b - a) * t;
/** SkSL smoothstep, including reversed edges (smoothstep(1, 0.75, e) falls). */
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** sdRoundRect with one radius and cornerPower 2 (GlassShaderSource). */
export function sdRoundRect(px, py, hx, hy, radius) {
  const r = Math.min(radius, Math.min(hx, hy));
  const qx = Math.abs(px) - hx + r, qy = Math.abs(py) - hy + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

/** gradRoundRect at power 2 (GlassNormalSource): the closed-form outward normal. */
export function gradRoundRect(px, py, hx, hy, radius, widen) {
  const r = Math.min(radius, Math.min(hx, hy));
  const gradRadius = Math.min(r * widen, Math.min(hx, hy));
  const qx = Math.abs(px) - hx + gradRadius, qy = Math.abs(py) - hy + gradRadius;
  const sx = px < 0 ? -1 : 1, sy = py < 0 ? -1 : 1;
  if (qx > 0 && qy > 0) {
    const L = Math.hypot(qx, qy);
    if (L <= 1e-5) return [sx * 0.70710678, sy * 0.70710678];
    return [sx * qx / L, sy * qy / L];
  }
  const ax = qy <= qx ? 1 : 0; // step(q.y, q.x)
  return [sx * ax, sy * (1 - ax)];
}

/** cornerWeight (GlassSourceMapSource): 1 where the nearest outline is a corner arc. */
export function cornerWeight(px, py, hx, hy, radius) {
  const r = Math.min(radius, Math.min(hx, hy));
  const qx = Math.abs(px) - hx + r, qy = Math.abs(py) - hy + r;
  const soft = Math.max(r * 0.2, 1);
  return smoothstep(-soft, 0, Math.min(qx, qy));
}

/** restSourceLegacy (GlassRestMap.kt): the shipping resting-corner map, u = d / W in, s / W out. */
export function restSourceLegacy(u) {
  if (u >= 0.76) return u;
  if (u >= 0.62) return 0.64 + 0.857 * (u - 0.62);
  if (u >= 0.38) return 0.55 + 0.375 * (u - 0.38);
  if (u >= 0.14) return 0.55;
  return 0.55 + 0.93 * (0.14 - u);
}

/** foldSource at formation 0, edgeFold 0 (glass at rest): corner arcs use the rest map, runs a
 * shallow inward offset. The formed fold needs a tracked drag and is not part of the element. */
export function restSource(u, corner) {
  const v = 1 - u;
  const straight = u + 0.06 * v * v;
  return mix(straight, restSourceLegacy(u), clamp(corner, 0, 1));
}

/** bevelSlope (GlassShaderSource): slope of the superellipse bevel at e = depth / band. */
export function bevelSlope(e, p) {
  const u = 1 - clamp(e, 0.002, 0.998);
  const up = Math.pow(u, p);
  return Math.pow(u, p - 1) / Math.pow(Math.max(1 - up, 1e-4), 1 - 1 / p);
}

/** snellShift (GlassShaderSource): exact Snell deviation for a surface of that slope. */
export function snellShift(slope, ior) {
  const inv = 1 / Math.sqrt(1 + slope * slope);
  const si = slope * inv, ci = inv;
  const st = si / Math.max(ior, 1.0001);
  const ct = Math.sqrt(Math.max(1 - st * st, 0));
  return (si * ct - ci * st) / Math.max(ci * ct + si * st, 1e-4);
}

/**
 * The shape for a style at a size: CSS px in, device px out. `radius` is the corner radius in
 * CSS px (a capsule passes half its short side). Returns what every per-pixel query needs.
 */
export function shapeFor(style, {width, height, radius, density = 1}) {
  if (![width, height, radius, density].every(Number.isFinite) || width <= 0 || height <= 0 || density <= 0 || radius < 0)
    throw new RangeError('Shape requires positive finite size and density and a nonnegative radius');
  const hx = width * density / 2, hy = height * density / 2;
  const r = Math.min(radius * density, Math.min(hx, hy));
  // GlassStyle.bandPx: the style's own band, else 0.6 of the corner radius capped at the inradius.
  const band = style.refractionBand != null ? style.refractionBand * density : BEVEL_RATIO * r;
  return {width, height, density, hx, hy, r, band, scale: sizeFactor(width, height), style};
}

/**
 * The geometry block of the material shader's main() at one point, p relative to the centre in
 * device px: signed distance, depth, outward normal, axis fade, optical depth and e.
 */
export function geometryAt(shape, px, py) {
  const {hx, hy, r, band, style} = shape;
  const d = sdRoundRect(px, py, hx, hy, r);
  const inradius = Math.min(hx, hy);
  const measured = style.profile === 'measured';
  let n, axisFade;
  if (band < inradius * 0.75) { // analyticNormalEligible
    n = gradRoundRect(px, py, hx, hy, r, measured ? 1 : 1.5);
    axisFade = 1;
  } else {
    const eps = clamp(band * 0.3, 1, 16);
    const gx = sdRoundRect(px + eps, py, hx, hy, r) - sdRoundRect(px - eps, py, hx, hy, r);
    const gy = sdRoundRect(px, py + eps, hx, hy, r) - sdRoundRect(px, py - eps, hx, hy, r);
    const gLen = Math.hypot(gx, gy), inv = 1 / Math.max(gLen, 1e-5);
    n = [gx * inv, gy * inv];
    axisFade = smoothstep(0.15, 0.80, gLen / (2 * eps));
  }
  const depth = Math.max(-d, 0);
  const aspect = Math.max(hx, hy) / Math.max(inradius, 1e-4);
  const domeWeight = smoothstep(1.5, 3, aspect) * smoothstep(0.75, 1, band / Math.max(inradius, 1e-4));
  let opticalDepth = depth;
  if (domeWeight > 0.001) {
    const qx = px / Math.max(hx, 1e-4), qy = py / Math.max(hy, 1e-4);
    const q2x = qx * qx, q2y = qy * qy;
    const domeRadius = Math.sqrt(clamp(q2x + q2y - q2x * q2y, 0, 1));
    opticalDepth = mix(depth, (1 - domeRadius) * band, domeWeight);
    const gx = qx * (1 - q2y), gy = qy * (1 - q2x), len = Math.hypot(gx, gy);
    if (len > 1e-4) {
      const mx = mix(n[0], gx / len, domeWeight), my = mix(n[1], gy / len, domeWeight);
      const ml = Math.hypot(mx, my) || 1;
      n = [mx / ml, my / ml];
    }
    axisFade = mix(axisFade, 1, domeWeight);
  }
  const e = clamp(opticalDepth / Math.max(band, 0.001), 0, 1);
  return {d, depth, n, axisFade, domeWeight, opticalDepth, e};
}

/**
 * Where the backdrop is sampled from, as an offset [dx, dy] in device px (the shader's `push`:
 * it samples base + push). Measured: inward only, from the rest map. Legacy: the Snell bevel,
 * outward, pulling the surroundings in. Dispersion and the legacy mirrored echo are not included.
 */
export function displacementAt(shape, px, py) {
  const g = geometryAt(shape, px, py);
  if (g.d >= 0.75) return [0, 0]; // outside coverage
  const {style, band, density} = shape;
  if (style.profile === 'measured') {
    const W = Math.max(band, 0.001);
    const u = clamp(g.depth / W, 0, 1);
    const corner = cornerWeight(px, py, shape.hx, shape.hy, shape.r);
    const src = restSource(u, corner);
    let shift = g.depth < W ? src * W - g.depth : 0;
    shift = Math.max(shift, 0) * g.axisFade * smoothstep(0, 1.5, g.depth);
    return [-g.n[0] * shift, -g.n[1] * shift];
  }
  const pw = Math.max(style.bevelPower, 1.5);
  const slope = bevelSlope(g.e, pw);
  let bend = snellShift(slope, style.ior) / Math.max(snellShift(bevelSlope(0, pw), style.ior), 1e-4);
  bend *= smoothstep(1, 0.75, g.e) * g.axisFade * smoothstep(0, 1.5, g.depth);
  bend *= mix(1, smoothstep(0, 2, g.depth), g.domeWeight);
  bend = clamp(bend, 0, 1);
  const lens = style.refractionDepth * density * mix(0.85, 1.25, shape.scale);
  return [g.n[0] * bend * lens, g.n[1] * bend * lens];
}

/**
 * The edge light added over the material at one point (device px), before coverage: the
 * shader's `highlight` (key and counter lobes, edge line, Fresnel, the measured rim glow).
 * Applied additively, as GlassOklabSource.applyHighlight does at highlightChroma 0.
 */
export function highlightAt(shape, px, py, g = geometryAt(shape, px, py)) {
  const s = shape.style, density = shape.density;
  const bevel = s.bevel * density;
  const facing = g.n[0] * s.light.x + g.n[1] * s.light.y;
  const peakAt = clamp(s.bevelPeak, 0, 0.9) * bevel;
  const bevelBand = peakAt < 0.5
    ? smoothstep(bevel, 0, g.depth)
    : smoothstep(0, peakAt, g.depth) * smoothstep(bevel, peakAt, g.depth);
  const slope = bevelSlope(g.e, Math.max(s.bevelPower, 1.5));
  const cosI = 1 / Math.sqrt(1 + slope * slope);
  let f0 = (s.ior - 1) / (s.ior + 1); f0 *= f0;
  const fresnel = f0 + (1 - f0) * Math.pow(Math.max(1 - cosI, 0), 5);
  const counterLight = clamp(s.counterLight, 0, 1);
  const counterPow = s.specularPower * mix(1.6, 1.0, smoothstep(0.35, 1.0, counterLight));
  const key = Math.pow(Math.max(facing, 0), s.specularPower) * bevelBand;
  const counter = Math.pow(Math.max(-facing, 0), counterPow) * bevelBand * counterLight;
  const edge = smoothstep(2, 0, g.depth);
  const lit = Math.max(facing, 0) + counterLight * Math.max(-facing, 0);
  const edgeLine = edge * 0.5 * lit;
  const glowReach = Math.max(bevel, 1);
  const glow = s.glow * Math.exp(-Math.max(g.depth - 0.67 * bevel, 0) / glowReach) * lit;
  return (key + counter) * s.specular + edgeLine * s.specular * s.edgeLight +
    fresnel * s.fresnel * bevelBand + glow;
}

/** Coverage of the outline at signed distance d (the shader's 1.5 px antialiasing ramp). */
export const coverageAt = d => 1 - smoothstep(-0.75, 0.75, d);

/**
 * The displacement map for feDisplacementMap, at `scale` map pixels per CSS px, covering the
 * element plus `pad` CSS px on every side. RGBA bytes: R and G encode the sampling offset in CSS
 * px as 0.5 + offset / mapScale (feDisplacementMap reads `scale * (C - 0.5)`), B is the crisp-rim
 * weight (1 - e)^2 that the Clear filter mixes its sharp and scattered copies by, A is 255.
 * Returns {width, height, data, scale: the feDisplacementMap scale in CSS px, maxShift}.
 */
export function displacementMap(style, {width, height, radius, density = 1, pad = 0, scale = 1}) {
  const shape = shapeFor(style, {width, height, radius, density});
  const mw = Math.max(1, Math.round((width + 2 * pad) * scale));
  const mh = Math.max(1, Math.round((height + 2 * pad) * scale));
  const offsets = new Float32Array(mw * mh * 2), crisp = new Float32Array(mw * mh);
  let maxShift = 0;
  for (let j = 0; j < mh; j++) {
    for (let i = 0; i < mw; i++) {
      // Map pixel centre -> CSS px relative to the element's centre -> device px.
      const cx = ((i + 0.5) / scale - pad - width / 2) * density;
      const cy = ((j + 0.5) / scale - pad - height / 2) * density;
      const k = j * mw + i;
      if (Math.abs(cx) > shape.hx + 1 || Math.abs(cy) > shape.hy + 1) continue;
      const [dx, dy] = displacementAt(shape, cx, cy);
      const ox = dx / density, oy = dy / density; // back to CSS px
      offsets[2 * k] = ox; offsets[2 * k + 1] = oy;
      maxShift = Math.max(maxShift, Math.abs(ox), Math.abs(oy));
      if (style.profile === 'legacy') {
        const g = geometryAt(shape, cx, cy);
        crisp[k] = g.d < 0.75 ? (1 - g.e) * (1 - g.e) : 0;
      }
    }
  }
  // An exact zero is not representable in 8 bits (127.5); scale bounds the residual to scale/510.
  const mapScale = Math.max(1, 2 * Math.ceil(maxShift + 0.5));
  const data = new Uint8ClampedArray(mw * mh * 4);
  for (let k = 0; k < mw * mh; k++) {
    data[4 * k] = Math.round(255 * (0.5 + offsets[2 * k] / mapScale));
    data[4 * k + 1] = Math.round(255 * (0.5 + offsets[2 * k + 1] / mapScale));
    data[4 * k + 2] = Math.round(255 * crisp[k]);
    data[4 * k + 3] = 255;
  }
  return {width: mw, height: mh, data, scale: mapScale, maxShift};
}

/** Decode one map pixel back into the CSS px offset feDisplacementMap will apply. */
export const decodeOffset = (byte, mapScale) => mapScale * (byte / 255 - 0.5);

/**
 * The rim image: white at alpha = highlight x coverage (straight alpha, as ImageData wants), at
 * device resolution over the element's own box (no pad). The element composites it normally
 * (source-over), which gives bg + a (1 - bg) where the shader adds bg + a: an authored
 * approximation, chosen because mix-blend-mode: plus-lighter isolates the nearest stacking context
 * and in Chromium that turns a transformed ancestor into the backdrop root (the glass would then
 * see nothing behind it). Interior pixels beyond the reach of every term are skipped.
 */
export function rimMap(style, {width, height, radius, density = 1}) {
  const shape = shapeFor(style, {width, height, radius, density});
  const w = Math.max(1, Math.round(width * density)), h = Math.max(1, Math.round(height * density));
  const data = new Uint8ClampedArray(w * h * 4);
  const bevel = style.bevel * density, reach = Math.max(bevel, 1);
  const limit = Math.max(2.2 * bevel, 2, style.glow > 0 ? 0.67 * bevel + 8 * reach : 0) + 2;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const px = i + 0.5 - w / 2, py = j + 0.5 - h / 2;
      const d = sdRoundRect(px, py, shape.hx, shape.hy, shape.r);
      if (d > 0.75 || -d > limit) continue;
      const g = geometryAt(shape, px, py);
      const a = clamp(highlightAt(shape, px, py, g), 0, 1) * coverageAt(g.d);
      const v = Math.round(a * 255);
      const k = 4 * (j * w + i);
      if (v > 0) { data[k] = data[k + 1] = data[k + 2] = 255; data[k + 3] = v; }
    }
  }
  return {width: w, height: h, data};
}
