// Apache-2.0. The Compose Calm selector's material, as shader uniforms: the production pill,
// lens and bar styles (exported by GlassSelectorPortMaterialTest) blended by the same rules as
// glassSelectorMaterial / glassSelectorFormation in GlassTabBar.kt.
import {CALM_SELECTOR_MATERIAL_DATA as DATA} from './selector-material-data.mjs';

/** Decisions, not quantities: they snap at the midpoint (lerpGlassStyle). */
const SNAP = new Set(['uProfile', 'uRestMap', 'uHeldInk']);
/** Lengths that may be unset (-1): an unset end snaps at the midpoint (GlassMorph `d`). */
const OPTIONAL_DP = new Set(['contactShadowBlur', 'contactShadowOffset']);
/** Host terms, not shader uniforms. */
const HOST = new Set(['rawShare', 'rawBlur', 'bodyBandScale', 'contactShadow', 'contactShadowInside', 'contactShadowBlur', 'contactShadowOffset']);
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
// Compose's sRGB Color stores 8 bits per channel.
const q8 = x => Math.floor(clamp(x, 0, 1) * 255 + .5) / 255;

function lerpTint(a, b, t) {
  if (t <= 0) return a.slice();
  if (t >= 1) return b.slice();
  const alpha = a[3] + (b[3] - a[3]) * t;
  if (alpha <= 1e-5) return [b[0], b[1], b[2], q8(alpha)];
  const ch = (x, y) => clamp((x * a[3] + (y * b[3] - x * a[3]) * t) / alpha, 0, 1);
  return [q8(ch(a[0], b[0])), q8(ch(a[1], b[1])), q8(ch(a[2], b[2])), q8(alpha)];
}

function lerpStyle(style, t) {
  t = clamp(t, 0, 1);
  const a = style.pill, b = style.lens, out = {};
  for (const key of Object.keys(a)) {
    if (key === 'uTint') out.uTint = lerpTint(a.uTint, b.uTint, t);
    else if (SNAP.has(key) || (OPTIONAL_DP.has(key) && (a[key] < 0 || b[key] < 0))) out[key] = t < .5 ? a[key] : b[key];
    else out[key] = t <= 0 ? a[key] : t >= 1 ? b[key] : a[key] + (b[key] - a[key]) * t;
  }
  // An ink split that follows dispersion snaps with the identity (GlassMorph `s`).
  const follows = t < .5 ? style.pillInkFollows : style.lensInkFollows;
  if (style.pillInkFollows || style.lensInkFollows) out.uInkSplit = follows ? out.uAberration : (t < .5 ? a : b).uInkSplit;
  return out;
}

/**
 * The selector's material for a formation, tap transit appearance and held travel, as
 * GlassTabBar draws it: `values` (shader uniforms, lengths in dp; `rawShare` is the host's
 * share of raw backdrop over the bar it looks through) and `uFormation` (the band's fold or
 * rim-mirror blend).
 */
export function calmSelectorMaterial({dark = true, formation = 0, transit = 0, heldTravel = 0} = {}) {
  if (![formation, transit, heldTravel].every(Number.isFinite)) throw new RangeError('Finite formation, transit and heldTravel required');
  const style = DATA.styles[dark ? 'dark' : 'light'];
  // Pigment: the lens/pill blend, its tint faded by the transit (glassTransitStyle).
  const pigment = lerpStyle(style, formation);
  const amount = clamp(transit * style.tapTintFade, 0, .95);
  if (amount > 0) {
    pigment.uTint = [pigment.uTint[0], pigment.uTint[1], pigment.uTint[2], q8(pigment.uTint[3] * (1 - amount))];
    pigment.uLift = pigment.uLift * (1 - amount);
  }
  let values = pigment;
  let fold = 0;
  if (style.tapOptics > 0) {
    const lift = clamp(Math.max(formation, transit * style.tapOptics), 0, 1);
    values = {...lerpStyle(style, lift), uTint: pigment.uTint, uLift: pigment.uLift};
    // A tapped selector's own fold (Compose's GlassTabBarStyle.tapTransitFold; tapOpticsFold before it).
    const transitFold = style.tapTransitFold ?? style.tapOpticsFold;
    if (transitFold > 0 && formation < .5) {
      const t = clamp(transit * style.tapOptics, 0, 1);
      fold = t > formation ? t * clamp(transitFold, 0, 1) : 0;
    }
    const mirror = {uFoldCorners: DATA.fold.foldCorners, uRimMirror: DATA.fold.rimMirror,
      uRimMirrorGain: DATA.fold.rimMirrorGain, uAberration: DATA.fold.dispersion, uInkSplit: DATA.fold.dispersion};
    if (fold > 0) values = {...values, ...mirror, uFoldCorners: DATA.fold.transitFoldCorners, uProfile: DATA.fold.measuredProfile};
    else if (style.tapOpticsFold > 0 && formation >= .5) values = {...values, ...mirror};
  }
  const uFormation = style.tapOpticsFold > 0 && formation >= .5
    ? clamp(heldTravel * style.tapOpticsFold, 0, 1) : fold;
  return {values, uFormation: clamp(uFormation, 0, 1)};
}

/**
 * The Calm bar's material, lengths in dp. Its held lift follows the selector's formation, or, where
 * the style lifts for any touch (GlassTabBarStyle.touchLift), the larger of that and `touch`
 * (the navigation's touch amount). `clear` is GlassTabBarStyle.CalmClear's bar: the clearer glass
 * of WhatsApp's and the App Store's dark bars (the same in light appearance).
 */
export function calmBarMaterial({dark = true, formation = 0, touch = 0, clear = false} = {}) {
  const style = DATA.styles[dark ? 'dark' : 'light'];
  const lift = style.touchLift ? Math.max(formation, touch) : formation;
  const bar = clear ? style.clearBar : style.bar;
  return {...bar, uLift: bar.uLift + style.heldLift * clamp(lift, 0, 1)};
}

/** Uniform values in device px for a density. */
export function calmMaterialUniforms(values, density = 1) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    if (HOST.has(key)) continue;
    out[key] = DATA.dpFields.includes(key) ? value * density : value;
  }
  return out;
}
