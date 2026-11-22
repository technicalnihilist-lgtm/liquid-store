// Apache-2.0. Generated from ports/web/core.mjs and interaction.mjs.
// Do not edit. npm test rejects drift; this package needs no sibling directory at runtime.
/** Apache-2.0. Portable authored lens/feedback math; no DOM or graphics dependency. */
function lensSource(x, y, halfWidth, halfHeight, magnification = 1.25) {
  for (const n of [x, y, halfWidth, halfHeight, magnification])
    if (!Number.isFinite(n)) throw new RangeError('Lens inputs must be finite');
  if (halfWidth <= 0 || halfHeight <= 0 || magnification < 1 || magnification > 2.5)
    throw new RangeError('Positive size and magnification 1…2.5 required');
  const radius2 = Math.min(1, (x / halfWidth) ** 2 + (y / halfHeight) ** 2);
  const factor = 1 - (1 - 1 / magnification) * (1 - radius2) ** 2;
  return { x: x * factor, y: y * factor };
}

/** Exact critically damped step. Time in seconds, values in the caller's units. */
function stepSpring(value, velocity, target, seconds, stiffness = 220) {
  if (![value, velocity, target, seconds, stiffness].every(Number.isFinite) || seconds < 0 || stiffness <= 0)
    throw new RangeError('Finite spring values, nonnegative time and positive stiffness required');
  const omega = Math.sqrt(stiffness), error = value - target;
  if (seconds === 0) return {value, velocity};
  if (omega * seconds > 750) return {value: target, velocity: 0};
  const b = velocity + omega * error, decay = Math.exp(-omega * seconds);
  return { value: target + (error + b * seconds) * decay,
    velocity: (velocity - omega * b * seconds) * decay };
}

/** Material deformation only. Keep text/hit targets outside the transformed drawing. */
function calmFeedback(width, height, dx, dy, pressed = true, radius = Math.min(width, height) / 2) {
  if (![width, height, dx, dy, radius].every(Number.isFinite) || width <= 0 || height <= 0 || radius < 0)
    throw new RangeError('Finite displacement and positive dimensions required');
  if (!pressed) return { pressX: 1, pressY: 1, along: 1, across: 1, angle: 0 };
  const target = calmPullTarget(width, height, dx, dy);
  return calmDeformation(width, height, target.x, target.y, 1, radius);
}

/** Internal shared geometry for the timestamped controller. Inputs are validated by callers. */
function calmPullTarget(width, height, dx, dy,
  pressX = calmPressScale(width), pressY = calmPressScale(height)) {
  const limit = Math.min(width * pressX, height * pressY) * .5;
  // Normalize before taking a length: even an enormous finite over-pull must not create NaN.
  const scale = Math.max(Math.abs(dx), Math.abs(dy));
  if (!scale) return {x: 0, y: 0};
  const length = Math.hypot(dx / scale, dy / scale);
  const resisted = limit * Math.tanh(scale * .2 / limit * length) / .2;
  return {x: dx / scale / length * resisted, y: dy / scale / length * resisted};
}

/** Per-edge growth is in logical pixels. Zero selects percentage-only growth, as in Compose. */
function calmPressScale(side, scale = 1.03, growth = 2) {
  return growth > 0 ? Math.min(scale, 1 + 2 * growth / side) : scale;
}

/** Pull coordinates have already been resisted and animated; do not resist them a second time. */
function calmDeformation(width, height, dx, dy, pressAmount, radius,
  pressX = 1 + (calmPressScale(width) - 1) * pressAmount,
  pressY = 1 + (calmPressScale(height) - 1) * pressAmount,
  pullShape = 'adaptive', targetLimit = Math.min(width*pressX,height*pressY)*.5) {
  const travel = Math.hypot(dx, dy);
  if (!travel) return { pressX, pressY, along: 1, across: 1, angle: 0 };
  const c = dx / travel, s = dy / travel, r = Math.min(radius, width / 2, height / 2);
  if (pullShape === 'area-preserving') {
    const amount = Math.max(0,Math.min(1,travel*.2/targetLimit));
    // Same authored .047 log-strain as Compose; input compliance/timing remain independent.
    const strain=.047*amount;
    const roundness=Math.max(0,Math.min(1,2*Math.min(width,height)/Math.max(width,height)-1));
    const u=strain*(c*c-s*s), v=2*strain*c*s*roundness, magnitude=Math.hypot(u,v);
    const bias=.056*Math.min(width,height)*amount;
    return {pressX,pressY,along:Math.exp(magnitude),across:Math.exp(-magnitude),angle:Math.atan2(v,u)/2,
      offsetX:bias*c,offsetY:bias*s};
  }
  const extent = (nx, ny) => (width - 2*r)*pressX*Math.abs(nx) + (height - 2*r)*pressY*Math.abs(ny) +
    2*r*Math.hypot(pressX*nx, pressY*ny);
  const alongExtent=extent(c,s), acrossExtent=extent(-s,c), extension=.03*travel;
  const t=Math.max(0,Math.min(1,(Math.max(width,height)-80)/80)), mix=t*t*(3-2*t);
  const surfaceGain=extension<.001 ? .2 : 2*Math.tanh(.2*extension/2)/extension;
  const gain=1+(surfaceGain-1)*mix;
  const along=1+extension/alongExtent*gain, across=1-extension/acrossExtent*gain;
  const roundness=Math.max(0,Math.min(1,2*Math.min(width,height)/Math.max(width,height)-1));
  const xx=along*c*c+across*s*s, yy=along*s*s+across*c*c, xy=(along-across)*c*s*roundness;
  const mean=(xx+yy)/2, eigenRadius=Math.hypot((xx-yy)/2,xy);
  return { pressX,pressY,along:mean+eigenRadius,across:mean-eigenRadius,angle:Math.atan2(2*xy,xx-yy)/2 };
}

/**
 * Compose's animation specs evaluated in closed form, for the free button: a spring is the damped
 * oscillator `spring(dampingRatio, stiffness)` defines (unit mass), a tween is
 * `tween(durationMillis, FastOutSlowInEasing)`. Time in seconds from the animation's start.
 */
function springAt(from, velocity, target, seconds, dampingRatio, stiffness) {
  const x0 = from - target, w = Math.sqrt(stiffness), z = dampingRatio, t = Math.max(0, seconds);
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z), e = Math.exp(-z * w * t), a = x0, b = (velocity + z * w * x0) / wd;
    const c = Math.cos(wd * t), s = Math.sin(wd * t);
    return {value: target + e * (a * c + b * s), velocity: e * ((b * wd - z * w * a) * c - (a * wd + z * w * b) * s)};
  }
  if (z === 1) {
    const e = Math.exp(-w * t), b = velocity + w * x0;
    return {value: target + (x0 + b * t) * e, velocity: (b - w * (x0 + b * t)) * e};
  }
  const q = w * Math.sqrt(z * z - 1), r1 = -z * w + q, r2 = -z * w - q;
  const c2 = (velocity - r1 * x0) / (r2 - r1), c1 = x0 - c2;
  return {value: target + c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t),
    velocity: c1 * r1 * Math.exp(r1 * t) + c2 * r2 * Math.exp(r2 * t)};
}

/** Compose's FastOutSlowInEasing, cubic-bezier(0.4, 0, 0.2, 1). */
function fastOutSlowIn(u) {
  if (u <= 0 || u >= 1) return Math.max(0, Math.min(1, u));
  const bez = (t, p1, p2) => 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
  let lo = 0, hi = 1, t = u;
  for (let i = 0; i < 40; i++) { t = (lo + hi) / 2; if (bez(t, .4, .2) < u) lo = t; else hi = t; }
  return bez(t, 0, 1);
}

/** Apache-2.0. Framework-independent, anchored Calm material feedback. No DOM or timer ownership. */

const identity = () => [1, 0, 0, 1];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/**
 * Logical pixels, monotonic timestamps in SECONDS. The host owns pointer arbitration and redraws.
 * This is whole-surface feedback, not the navigation-selector travel controller.
 * The spring stiffnesses and steady geometry match the opt-in Compose Calm choices; timing is authored.
 */
export function createCalmInteraction({width, height, radius = Math.min(width, height) / 2,
  x = 0, y = 0, viewportWidth, viewportHeight, reducedMotion = false,
  pressScale = 1.03, pressGrowth = 2, pullShape = 'adaptive'}) {
  if (![pressScale, pressGrowth].every(Number.isFinite) || pressScale < 1 || pressScale > 2 || pressGrowth < 0)
    throw new RangeError('Press scale must be 1..2 and per-edge growth must be nonnegative');
  if (!['adaptive','area-preserving'].includes(pullShape))
    throw new RangeError('Pull shape must be adaptive or area-preserving');
  let geometry, reduced = !!reducedMotion, clock = null, held = false;
  let pressure = {value: 0, velocity: 0}, horizontal = {...pressure}, vertical = {...pressure};
  let target = {x: 0, y: 0};
  function configure(options) {
    const next = {...geometry, ...options};
    if (![next.width, next.height, next.radius, next.x, next.y].every(Number.isFinite) ||
        next.width <= 0 || next.height <= 0 || next.radius < 0 ||
        next.width > 1e7 || next.height > 1e7)
      throw new RangeError('Finite position, positive dimensions up to 10 million, and nonnegative radius required');
    if ((next.viewportWidth !== undefined || next.viewportHeight !== undefined) &&
        (![next.viewportWidth, next.viewportHeight].every(Number.isFinite) ||
        next.viewportWidth <= 0 || next.viewportHeight <= 0))
      throw new RangeError('Supply both positive viewport dimensions, or neither');
    next.radius = Math.min(next.radius, next.width / 2, next.height / 2);
    geometry = next;
  }
  configure({width, height, radius, x, y, viewportWidth, viewportHeight});

  function pressTargets() {
    const {width:w, height:h, x, y, viewportWidth:vw, viewportHeight:vh} = geometry;
    let sx=calmPressScale(w,pressScale,pressGrowth), sy=calmPressScale(h,pressScale,pressGrowth);
    // Constrain the target before its spring, matching Compose; clipping the animated result
    // instead would reach an edge early and abruptly stop an otherwise gradual press.
    if (vw !== undefined && x >= 0 && x+w <= vw)
      sx=Math.min(sx,Math.max(1,2*Math.min(x+w/2,vw-x-w/2)/w));
    if (vh !== undefined && y >= 0 && y+h <= vh)
      sy=Math.min(sy,Math.max(1,2*Math.min(y+h/2,vh-y-h/2)/h));
    return [sx,sy];
  }

  function advance(time, staleFrame = false) {
    if (!Number.isFinite(time) || time < 0)
      throw new RangeError('Use monotonic nonnegative timestamps in seconds');
    if (clock !== null && time < clock) {
      if (staleFrame) return;
      throw new RangeError('Use monotonic nonnegative timestamps in seconds');
    }
    const dt = clock === null ? 0 : time - clock;
    clock = time;
    pressure = stepSpring(pressure.value, pressure.velocity, held && !reduced ? 1 : 0, dt, held ? 220 : 260);
    horizontal = stepSpring(horizontal.value, horizontal.velocity, target.x, dt, held ? 350 : 260);
    vertical = stepSpring(vertical.value, vertical.velocity, target.y, dt, held ? 350 : 260);
    // A settled controller can stop scheduling. Snap only below a sub-pixel threshold.
    if (!held && Math.abs(pressure.value) < 1e-5 && Math.abs(pressure.velocity) < 1e-4 &&
        Math.hypot(horizontal.value, vertical.value) < 1e-4 &&
        Math.hypot(horizontal.velocity, vertical.velocity) < 1e-3) clear();
  }
  function clear() {
    pressure = {value: 0, velocity: 0}; horizontal = {...pressure}; vertical = {...pressure};
    target = {x: 0, y: 0};
  }
  function snapshot() {
    const {width: w, height: h, radius: r, x, y, viewportWidth: vw, viewportHeight: vh} = geometry;
    if (reduced) return {matrix: identity(), offset: [0,0], press: 0, held, active: false};
    const amount = clamp(pressure.value, 0, 1);
    const [targetX,targetY] = pressTargets();
    const pressX = 1 + (targetX - 1) * amount;
    const pressY = 1 + (targetY - 1) * amount;
    const contained = vw !== undefined && x >= 0 && y >= 0 && x + w <= vw && y + h <= vh;
    const cx = x + w / 2, cy = y + h / 2;
    const shape = calmDeformation(w, h, horizontal.value, vertical.value, amount, r, pressX, pressY,
      pullShape,Math.min(w*targetX,h*targetY)*.5);
    const c = Math.cos(shape.angle), s = Math.sin(shape.angle);
    function matrix(gain) {
      const a = 1 + (shape.along - 1) * gain, b = 1 + (shape.across - 1) * gain;
      const shear = (a - b) * c * s;
      return [(a*c*c+b*s*s)*pressX, shear*pressY, shear*pressX, (a*s*s+b*c*c)*pressY];
    }
    function extent(gain) {
      const [a,b,c,d] = matrix(gain);
      // Support of a transformed rounded rectangle, including diagonals; never clip the glass.
      const hx = (w/2-r)*Math.abs(a) + (h/2-r)*Math.abs(b) + r*Math.hypot(a,b);
      const hy = (w/2-r)*Math.abs(c) + (h/2-r)*Math.abs(d) + r*Math.hypot(c,d);
      return [hx,hy];
    }
    function fits(gain) {
      const [hx,hy]=extent(gain);
      return hx <= Math.min(cx,vw-cx) && hy <= Math.min(cy,vh-cy);
    }
    let gain = 1;
    if (contained && !fits(1)) {
      let low = 0, high = 1;
      for (let i=0;i<24;i++) {const mid=(low+high)/2;if(fits(mid))low=mid;else high=mid;}
      gain = low;
    }
    let offset=[shape.offsetX??0,shape.offsetY??0];
    if(contained) {
      const [hx,hy]=extent(gain);
      // Same C1 edge resistance as Compose. The material may bias; layout never does.
      const travel=(value,before,after)=>{
        const room=Math.max(0,value<0?before:after),free=room/2;
        if(Math.abs(value)<=free)return value;
        const span=room-free, result=free+(span>0?span*Math.tanh((Math.abs(value)-free)/span):0);
        return value<0?-result:result;
      };
      offset=[travel(offset[0],cx-hx,vw-cx-hx),travel(offset[1],cy-hy,vh-cy-hy)];
    }
    const active = Math.abs(pressure.value-(held?1:0)) > 1e-5 || Math.abs(pressure.velocity) > 1e-4 ||
      Math.hypot(horizontal.value-target.x, vertical.value-target.y) > 1e-4 ||
      Math.hypot(horizontal.velocity, vertical.velocity) > 1e-3;
    return {matrix: matrix(gain), offset, press: amount, held, active};
  }
  return {
    /** Total displacement since pointer-down, never a per-event delta. Advance the OLD target first. */
    press(time, dx = 0, dy = 0) {
      if (![dx,dy].every(Number.isFinite)) throw new RangeError('Finite cumulative displacement required');
      advance(time); held = true;
      target = reduced ? {x: 0, y: 0} : calmPullTarget(geometry.width, geometry.height, dx, dy, ...pressTargets());
      return snapshot();
    },
    /** Use for both pointer-up and cancellation; navigation selection belongs to the host. */
    release(time) {advance(time); held = false; target = {x: 0,y: 0}; return snapshot();},
    // A queued animation frame can predate the latest input event; it must never rewind state.
    sample(time) {advance(time, true); return snapshot();},
    /** Reconfigure after a layout change. Cancel the current gesture rather than keeping stale coordinates. */
    resize(options, time) {advance(time); configure(options); held = false; clear(); return snapshot();},
    setReducedMotion(value, time) {advance(time); reduced = !!value; held = false; clear(); return snapshot();},
  };
}

// The free button: GlassInteraction.Pullable with GlassPullShape.Free, the Phone scene's search button
// (measured on iOS 26's, IMG_6756). Each value restarts from where it is when its target changes, as
// Compose's animateFloatAsState does; the laws are Modifier.liquidGlass's own (glassPressScale,
// glassPullTargetScale, glassPullDeformation without anchoring, glassFreeLanding). Checked frame by
// frame against the Kotlin-exported ports/skia/fixtures/free-button.json.
const FREE_SPECS = {
  glowIn: {tween: .09}, freeGlow: {tween: .35},
  balloonDown: {damping: .62, stiffness: 644}, pressUp: {damping: .72, stiffness: 700},
  pullFollow: {damping: 1, stiffness: 2500}, freeRelease: {damping: .45, stiffness: 264},
};

function animated(initial) {
  const a = {start: 0, from: initial, velocity: 0, target: initial, spec: null};
  const at = time => {
    if (!a.spec) return {value: a.from, velocity: 0};
    // Compose evaluates its animations on whole elapsed milliseconds (nanoseconds / 1e6, truncated).
    // As (elapsed seconds * 1e9).toLong() / 1e6: truncated twice, as the Kotlin host and Compose do.
    const tm = Math.floor(Math.trunc(Math.max(0, time - a.start) * 1e9) / 1e6) / 1000;
    if (a.spec.tween !== undefined) {
      // A tween reads its elapsed time to the nanosecond; a spring to the whole millisecond.
      const u = Math.min(1, Math.trunc(Math.max(0, time - a.start) * 1e9) / 1e9 / a.spec.tween);
      return {value: a.from + (a.target - a.from) * fastOutSlowIn(u), velocity: 0};
    }
    return springAt(a.from, a.velocity, a.target, tm, a.spec.damping, a.spec.stiffness);
  };
  return {
    value: time => at(time).value,
    to(time, target, spec) {
      if (target === a.target && a.spec) return;
      const now = at(time);
      Object.assign(a, {start: time, from: now.value, velocity: now.velocity, target, spec});
    },
  };
}

/**
 * A free-standing round glass button pulled off its place (px; time in seconds). down / move (total
 * finger travel since down) / up drive it; sample returns the drawing transform: press scale, a
 * stretch along and across `angle` (degrees), the offset, and the glow and its lift.
 */
export function createFreeButton({size, density = 1, pressScale = 1.26, pressGrowth = 8, pressLift = .2,
  pullFollow = .2, pullElongation = .124, pullWidthRatio = 1, pullLimit = .5, pullLiftShare = .65,
  pullReleaseDampingX = .3} = {}) {
  if (!(size > 0) || !(density > 0)) throw new RangeError('Positive size and density required');
  const growth = pressGrowth * density, radius = size / 2;
  const balloon = Math.min(1 + 2 * growth / size, pressScale);
  const limit = size * balloon * pullLimit;
  const press = animated(0), glow = animated(0), px = animated(0), py = animated(0);
  let anchor = NaN, moved = false;
  const extent = (sx, sy, x, y) => {
    const len = Math.hypot(x, y);
    if (len < 1e-5) return Math.min(size * sx, size * sy);
    const nx = Math.abs(x) / len, ny = Math.abs(y) / len;
    return 2 * radius * Math.hypot(sx * nx, sy * ny);
  };
  // glassFreeLanding: the edge away from the pull holds at rest; the overshoot lands as a squash.
  function landing(d) {
    if (!Number.isFinite(anchor)) return d;
    const a = anchor * Math.PI / 180, nx = Math.cos(a), ny = Math.sin(a);
    const restHalf = Math.hypot(radius * nx, radius * ny);
    const c = d.tx * nx + d.ty * ny, perp = -d.tx * ny + d.ty * nx;
    const dd = (d.angle - anchor) * Math.PI / 180, cd = Math.cos(dd), sd = Math.sin(dd);
    const stretched = c >= 0;
    const axis = stretched ? Math.sqrt(d.along ** 2 * cd * cd + d.across ** 2 * sd * sd) : 1;
    const side = stretched ? Math.sqrt(d.along ** 2 * sd * sd + d.across ** 2 * cd * cd) : 1;
    const half = restHalf * axis;
    if (c - half >= -restHalf) return d;
    const newHalf = Math.max((c + half + restHalf) / 2, restHalf * .5), centre = c + half - newHalf;
    const k = newHalf / half;
    return {along: axis * k, across: side * (1 + .2 * (1 - k)), angle: anchor,
      tx: centre * nx - perp * ny, ty: centre * ny + perp * nx};
  }
  return {
    down(time) {
      moved = false;
      glow.to(time, 1, FREE_SPECS.glowIn); press.to(time, 1, FREE_SPECS.balloonDown);
      px.to(time, 0, FREE_SPECS.pullFollow); py.to(time, 0, FREE_SPECS.pullFollow);
    },
    move(time, dx, dy) {
      const len = Math.hypot(dx, dy);
      if (!moved && len > 4 * density) { moved = true; glow.to(time, pullLiftShare, FREE_SPECS.freeGlow); }
      if (len > 4 * density) anchor = Math.atan2(dy, dx) * 180 / Math.PI;
      const travel = len * pullFollow;
      const k = !(len > 1e-5) || pullFollow <= 0 ? 1 : limit * Math.tanh(travel / limit) / travel;
      px.to(time, dx * k, FREE_SPECS.pullFollow); py.to(time, dy * k, FREE_SPECS.pullFollow);
    },
    up(time) {
      glow.to(time, 0, FREE_SPECS.freeGlow); press.to(time, 0, FREE_SPECS.pressUp);
      // Compose's GlassInteraction.pullReleaseDampingX: a separate x damping on release.
      const releaseX = Number.isFinite(pullReleaseDampingX)
        ? {...FREE_SPECS.freeRelease, damping: Math.min(Math.max(pullReleaseDampingX, .05), 2)} : FREE_SPECS.freeRelease;
      px.to(time, 0, releaseX); py.to(time, 0, FREE_SPECS.freeRelease);
    },
    sample(time) {
      const amount = press.value(time), scale = 1 + (balloon - 1) * amount;
      const x = px.value(time), y = py.value(time), len = Math.hypot(x, y);
      let d = {along: 1, across: 1, angle: 0, tx: 0, ty: 0};
      if (len >= 1e-3) {
        const e = extent(scale, scale, x, y), across = extent(scale, scale, -y, x);
        const along = Math.min(1 + pullElongation * len / Math.max(e, 1), 1.6);
        const extension = (along - 1) * Math.max(e, 1);
        d = {along, across: Math.max(1 - pullWidthRatio * extension / Math.max(across, 1), .5),
          angle: Math.atan2(y, x) * 180 / Math.PI, tx: pullFollow * x, ty: pullFollow * y};
      }
      d = landing(d);
      const g = glow.value(time);
      return {...d, pressScale: scale, glow: g, lift: g * pressLift, pullX: x};
    },
  };
}
