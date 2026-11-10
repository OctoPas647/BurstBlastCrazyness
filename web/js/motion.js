/* BurstBlastCrazyness — motion engine.
 *
 * The rules this game's motion follows (from Apple's "Designing Fluid
 * Interfaces" and "Animate with springs" talks):
 *   1. Respond on touch-down, never wait for an animation.
 *   2. Everything that moves can be grabbed and redirected mid-flight.
 *   3. Motion starts from where the thing is on screen, at the speed it has.
 *   4. Bounce only when a throw put momentum in; menus settle without it.
 *   5. Game state never waits for motion: the move counts on release.
 *
 * Springs use Apple's (iOS 17 / SwiftUI) "duration + bounce" model:
 *   mass = 1
 *   stiffness = (2π / duration)²
 *   damping   = (1 − bounce) · 4π / duration      (bounce ≥ 0)
 *   damping   = 4π / (duration · (1 + bounce))   (bounce < 0)
 * Momentum projection is the one from Apple's "Designing Fluid Interfaces"
 * sample code, and rubber-banding uses UIScrollView's 0.55 coefficient.
 */
(function (BBC) {
  'use strict';

  function params(duration, bounce) {
    var k = Math.pow((2 * Math.PI) / duration, 2);
    var c = bounce >= 0
      ? ((1 - bounce) * 4 * Math.PI) / duration
      : (4 * Math.PI) / (duration * (1 + bounce));
    return { k: k, c: c };
  }

  /** A 1-D spring you can retarget any time; it keeps its velocity (interruptible). */
  function Spring(value, opts) {
    this.x = value;
    this.v = 0;
    this.target = value;
    this.set(opts || {});
  }
  Spring.prototype.set = function (opts) {
    var p = params(opts.duration || 0.4, opts.bounce || 0);
    this.k = p.k;
    this.c = p.c;
    return this;
  };
  Spring.prototype.step = function (dt) {
    // Semi-implicit Euler in 4 ms sub-steps: stable for stiff springs.
    var n = Math.max(1, Math.ceil(dt / 0.004));
    var h = dt / n;
    for (var i = 0; i < n; i++) {
      var a = -this.k * (this.x - this.target) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  };
  Spring.prototype.settled = function (eps) {
    eps = eps || 0.5;
    return Math.abs(this.x - this.target) < eps && Math.abs(this.v) < eps * 10;
  };
  Spring.prototype.snap = function (value) {
    this.x = this.target = value;
    this.v = 0;
  };
  /** Retarget (and optionally retune) without losing the current speed. */
  Spring.prototype.to = function (target, opts) {
    if (opts) this.set(opts);
    this.target = target;
    return this;
  };

  /** Where a flick ends up (Apple's exponential deceleration). v in px/s. */
  function project(v, rate) {
    rate = rate || 0.998;
    return ((v / 1000) * rate) / (1 - rate);
  }

  /** Resistance past an edge: the further you pull, the less it follows. */
  function rubberBand(overshoot, dimension, c) {
    c = c || 0.55;
    var s = overshoot < 0 ? -1 : 1;
    var x = Math.abs(overshoot);
    return s * (1 - 1 / ((x * c) / dimension + 1)) * dimension;
  }

  /**
   * Sample a spring from 0 → 1 into a CSS linear() easing, so plain CSS
   * animations move like real springs (overshoot included).
   */
  function cssEasing(duration, bounce) {
    var s = new Spring(0, { duration: duration, bounce: bounce });
    s.target = 1;
    var pts = [], dt = 1 / 120, t = 0;
    while (t < 3) {
      pts.push(s.x);
      if (t > 0.05 && s.settled(0.0008)) break;
      s.step(dt);
      t += dt;
    }
    pts.push(1);
    var total = (pts.length - 1) * dt;
    var step = Math.max(1, Math.round(pts.length / 60));
    var out = [];
    for (var i = 0; i < pts.length; i += step) out.push(pts[i].toFixed(4));
    if (out[out.length - 1] !== '1.0000') out.push('1');
    return { easing: 'linear(' + out.join(', ') + ')', ms: Math.round(total * 1000) };
  }

  /**
   * Finger tracker: keeps the last ~100 ms of touch samples (including the
   * extra samples the browser coalesces between frames) and estimates the
   * finger's velocity with a least-squares fit.
   *
   * The velocity is only trusted while the finger is actually moving: a
   * finger that stopped sends no more events, so velocityAt() fades the last
   * known speed to zero within 60 ms. (Before, a fast drag followed by a pause
   * kept its old speed, which threw the piece off on release.)
   */
  function Tracker() {
    this.samples = [];
    this.vx = 0;
    this.vy = 0;
    this.px = 0;
    this.py = 0;
    this.t = 0;
  }
  Tracker.prototype.reset = function (x, y, t) {
    this.samples = [{ x: x, y: y, t: t }];
    this.vx = this.vy = 0;
    this.px = x;
    this.py = y;
    this.t = t;
  };
  Tracker.prototype.add = function (e) {
    var list = [];
    try { if (e.getCoalescedEvents) list = e.getCoalescedEvents(); } catch (err) { list = []; }
    if (!list || !list.length) list = [e];
    for (var i = 0; i < list.length; i++) {
      var ev = list[i];
      var t = ev.timeStamp || performance.now();
      var last = this.samples[this.samples.length - 1];
      if (last && t <= last.t) t = last.t + 0.5;
      this.samples.push({ x: ev.clientX, y: ev.clientY, t: t });
    }
    // The event itself is the newest truth, even if its coalesced list lags behind.
    var end = this.samples[this.samples.length - 1];
    end.x = e.clientX;
    end.y = e.clientY;
    while (this.samples.length > 3 && end.t - this.samples[0].t > 100) this.samples.shift();
    this.fit();
  };
  Tracker.prototype.fit = function () {
    // Weighted least squares over the last 60 ms (recent samples count more).
    var s = this.samples, n = s.length;
    var last = s[n - 1];
    this.px = last.x;
    this.py = last.y;
    this.t = last.t;
    var sw = 0, st = 0, sx = 0, sy = 0, stt = 0, stx = 0, sty = 0, used = 0;
    for (var i = 0; i < n; i++) {
      var dt = (s[i].t - last.t) / 1000;
      if (dt < -0.06) continue;
      var w = 1 + (dt + 0.06) * 20;
      used++;
      sw += w; st += w * dt; sx += w * s[i].x; sy += w * s[i].y;
      stt += w * dt * dt; stx += w * dt * s[i].x; sty += w * dt * s[i].y;
    }
    var den = sw * stt - st * st;
    if (used < 2 || Math.abs(den) < 1e-9) {
      // Nothing recent to compare with: the finger was resting.
      this.vx = this.vy = 0;
      return;
    }
    var vx = (sw * stx - st * sx) / den;
    var vy = (sw * sty - st * sy) / den;
    // Light smoothing so one noisy sample can't jerk the piece.
    this.vx = this.vx * 0.3 + vx * 0.7;
    this.vy = this.vy * 0.3 + vy * 0.7;
  };
  /** Velocity in px/s right now; fades to zero when no sample arrived for 20–60 ms. */
  Tracker.prototype.velocityAt = function (now) {
    var age = now - this.t;
    var k = age <= 20 ? 1 : age >= 60 ? 0 : 1 - (age - 20) / 40;
    return { x: this.vx * k, y: this.vy * k };
  };
  /** Finger position `ms` milliseconds ahead of the last sample (capped at maxPx). */
  Tracker.prototype.predict = function (ms, maxPx, now) {
    var v = this.velocityAt(now);
    var dx = (v.x * ms) / 1000;
    var dy = (v.y * ms) / 1000;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > maxPx && d > 0) { dx *= maxPx / d; dy *= maxPx / d; }
    return { x: this.px + dx, y: this.py + dy };
  };

  BBC.motion = {
    Spring: Spring,
    params: params,
    project: project,
    rubberBand: rubberBand,
    cssEasing: cssEasing,
    Tracker: Tracker
  };

  // CSS spring easings, generated once at startup.
  var presets = {
    smooth: [0.4, 0],      // menus, sheets: no bounce, nothing was thrown
    snappy: [0.28, 0.12],  // new pieces arriving, cards
    bouncy: [0.45, 0.28],  // praise text
    swift: [0.22, 0.05]    // quick UI feedback
  };
  BBC.motion.easings = {};
  var root = document.documentElement;
  Object.keys(presets).forEach(function (name) {
    var e = cssEasing(presets[name][0], presets[name][1]);
    root.style.setProperty('--spring-' + name, e.easing);
    root.style.setProperty('--spring-' + name + '-ms', e.ms + 'ms');
    BBC.motion.easings[name] = e;
  });
})((window.BBC = window.BBC || {}));
