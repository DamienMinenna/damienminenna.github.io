/*!
 * hero.js — animation at the top of the home page.
 *
 * Five "software windows" appear one after the other, each running a small
 * simulation (magnetic, mechanics, conductor, quench, beam dynamics), linked by
 * blocked arrows; after a hold they fade out and the sequence starts again.
 *
 * It is the title animation of the ALESIA slides (github.com/DamienMinenna/alesia,
 * gh-pages branch, commit 2cb5e6a):
 *   - js/magnet-design.js is widgets/magnet-design.js, copied unchanged
 *     (window engine + scenes, exposed as window.MDKit);
 *   - the IBSimu beam-extraction scene below is copied from widgets/alesia-windows.js.
 * Changes for this page: no "ongoing" in the status bars, no cryogenics and CAD
 * windows, a beam-dynamics window last, a layout for narrow screens, a pause when
 * the animation is off screen and a still picture when reduced motion is requested.
 */
(function () {
  'use strict';
  var K = window.MDKit;
  var band = document.querySelector('.hero-anim');
  if (!K || !band) return;
  var H = K.helpers, clamp01 = H.clamp01, lerp = H.lerp, frac = H.frac, rgba = H.rgba, TAU = Math.PI * 2;

  function rng(seed) { // mulberry32
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ================================================== IBSimu beam extraction */
  // geometry in (z, r) millimetres, after the ECRIS extraction system (CEA)
  var IB = {
    PE: [[-6, 60], [7.5, 60], [7.5, 34], [6.5, 30], [4, 27], [2.8, 24], [2.8, 8], [2, 6.3], [-6, 3.2]],
    EA: [[20, 8], [21, 6.3], [23, 6.3], [24.2, 8], [36, 28.5], [40.5, 33], [47, 35], [110, 35], [110, 45], [47, 45], [38, 40.5], [33, 35], [29.5, 29]],
    EB: [[28, 8], [29, 7], [31.2, 7], [32, 8], [33.2, 12], [40, 26], [43, 28.5], [78, 28.5], [81, 30.5], [97, 31], [97, 33], [46, 33], [41.5, 31.8], [38, 28], [30.3, 12.5]],
    EC: [[38, 8], [39, 7], [43, 7], [70, 12], [78, 12], [110, 19.5], [110, 27.5], [95, 26], [51.5, 26], [47.5, 24.5], [45.5, 21]],
    // electrode being optimised (outline), top-left → tip → top-right
    HP: [[10.6, 40], [10.1, 32], [9.4, 24], [8.6, 17], [8.3, 11.5], [9.2, 7.6], [11.2, 6.2], [13.4, 6.9], [16.2, 10], [18.3, 16], [20.6, 23], [23.5, 29], [27, 33], [31, 36]],
    // beam envelope R(z)
    ENV: [[-4, 4.6], [0, 4.4], [6, 4.0], [11, 3.4], [20, 3.5], [35, 4.0], [60, 4.9], [104, 6.0]]
  };
  var Z0 = -3, Z1 = 103, R1 = 30;
  function envR(z) {
    var e = IB.ENV, i = 1;
    while (i < e.length - 1 && e[i][0] < z) i++;
    var u = clamp01((z - e[i - 1][0]) / (e[i][0] - e[i - 1][0])), s = u * u * (3 - 2 * u);
    return lerp(e[i - 1][1], e[i][1], s);
  }
  var HOT = H.cmap([[0, '#140000'], [0.3, '#7a0000'], [0.55, '#e00000'], [0.78, '#ff8a00'], [1, '#ffe94d']]);
  function catmull(ctx, pts) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
  }
  var IB_CYCLE = 4.6, NTRAJ = 30;
  function SceneIBSimu() { this.R = rng(42); this.gen = -1; this.cands = []; this.best = IB.HP; this.col = [0, 0, 0]; }
  SceneIBSimu.prototype.newGeneration = function () {
    this.gen++;
    var R = this.R, amp = 3.2 * Math.exp(-this.gen / 3.5) + 0.35, self = this;
    for (var c = 0; c < 6; c++) {
      var ph = R() * TAU, ph2 = R() * TAU, a1 = (R() - 0.5) * 2 * amp, a2 = (R() - 0.5) * 2 * amp;
      var pts = IB.HP.map(function (p, i) {
        var s = i / (IB.HP.length - 1);
        var dz = a1 * Math.sin(Math.PI * s + ph) + 0.5 * a2 * Math.sin(3 * Math.PI * s + ph2);
        var dr = 0.6 * a2 * Math.cos(2 * Math.PI * s + ph);
        return [p[0] + dz, Math.max(5.2, p[1] + dr * (p[1] < 10 ? 0.4 : 1))];
      });
      self.cands.push({ pts: pts, fit: clamp01(0.35 + 0.65 * Math.min(1, amp / 2.5) * (0.5 + 0.5 * R())), born: self.gen });
    }
    while (this.cands.length > 54) this.cands.shift();
    var bestC = this.cands[this.cands.length - 1 - Math.floor(R() * 6)];
    bestC.fit = Math.min(bestC.fit, 0.12);
    this.best = bestC.pts;
    if (this.gen > 12) { this.gen = -1; this.cands = []; }
  };
  SceneIBSimu.prototype.draw = function (ctx, W, Hh, t) {
    var cyc = Math.floor(t / IB_CYCLE), ct = t - cyc * IB_CYCLE;
    if (cyc !== this.cycle) { this.cycle = cyc; this.newGeneration(); }
    var m = 12, rx = m + 6, rw = W - 2 * m - 6, ry = m, rh = Hh - 2 * m - 6;
    var X = function (z) { return rx + (z - Z0) / (Z1 - Z0) * rw; }, Y = function (r) { return ry + rh - (r / R1) * rh; };
    ctx.save();
    ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
    // beam
    var front = Z0 + Math.max(0, ct - 0.25) * 62, fadeB = clamp01((IB_CYCLE - ct) / 0.5);
    var zEnd = Math.min(Z1, front);
    if (zEnd > Z0) {
      // envelope glow
      var gEnv = ctx.createLinearGradient(0, Y(7), 0, Y(0));
      gEnv.addColorStop(0, 'rgba(240,60,200,0)'); gEnv.addColorStop(1, 'rgba(240,60,200,.22)');
      ctx.fillStyle = gEnv;
      ctx.beginPath(); ctx.moveTo(X(Z0), Y(0));
      for (var z = Z0; z <= zEnd; z += 1.5) ctx.lineTo(X(z), Y(envR(z) * 1.05));
      ctx.lineTo(X(zEnd), Y(0)); ctx.closePath();
      ctx.globalAlpha = fadeB; ctx.fill();
      ctx.lineWidth = 1.1;
      for (var k = 0; k < NTRAJ; k++) {
        var uu = (k + 0.5) / NTRAJ;
        ctx.strokeStyle = 'rgba(236,48,196,' + (0.25 + 0.3 * (1 - uu)) + ')';
        ctx.beginPath();
        for (z = Z0; z <= zEnd; z += 1.5) {
          var rr2 = envR(z) * uu + 0.12 * uu * Math.sin(z * 0.22 + k * 1.3);
          if (z === Z0) ctx.moveTo(X(z), Y(rr2)); else ctx.lineTo(X(z), Y(rr2));
        }
        ctx.stroke();
      }
      // particles flowing once the beam is established
      if (front > Z1) {
        ctx.fillStyle = 'rgba(255,170,240,.95)';
        for (k = 0; k < NTRAJ; k += 2) {
          var uk = (k + 0.5) / NTRAJ, zp = Z0 + frac(ct * 0.55 + k * 0.137) * (Z1 - Z0);
          ctx.beginPath(); ctx.arc(X(zp), Y(envR(zp) * uk), 1.9, 0, TAU); ctx.fill();
        }
      }
      // beam front
      if (front <= Z1) {
        var fg = ctx.createRadialGradient(X(front), Y(0), 0, X(front), Y(0), 26);
        fg.addColorStop(0, 'rgba(255,230,250,.95)'); fg.addColorStop(0.4, 'rgba(250,90,215,.55)'); fg.addColorStop(1, 'rgba(250,90,215,0)');
        ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(X(front), Y(0), 26, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // electrodes
    ctx.fillStyle = '#8e8e95'; ctx.strokeStyle = '#5c5c63'; ctx.lineWidth = 1.3; ctx.lineJoin = 'round';
    var fills = this.elecFill;  // optional colours, e.g. by electrode potential
    [IB.PE, IB.EA, IB.EB, IB.EC].forEach(function (poly, k) {
      if (fills) ctx.fillStyle = fills[k];
      ctx.beginPath();
      poly.forEach(function (p, i) { if (i) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
    });
    // optimised electrode: candidate outlines coloured by fitness score, best in black
    var self = this, col = this.col;
    ctx.lineCap = 'round';
    this.cands.forEach(function (c) {
      var age = self.gen - c.born;
      HOT(c.fit, col);
      ctx.strokeStyle = rgba(col, Math.max(0.06, 0.32 - age * 0.04));
      ctx.lineWidth = 1.6;
      ctx.beginPath(); catmull(ctx, c.pts.map(function (p) { return [X(p[0]), Y(p[1])]; })); ctx.stroke();
    });
    ctx.strokeStyle = '#1a0003'; ctx.lineWidth = 3.2;
    ctx.beginPath(); catmull(ctx, this.best.map(function (p) { return [X(p[0]), Y(p[1])]; })); ctx.stroke();
    ctx.restore();
  };
  SceneIBSimu.prototype.drawBg = function (ctx, W, Hh) { // never changes: painted once, underneath
    var m = 12, rx = m + 6, rw = W - 2 * m - 6, ry = m, rh = Hh - 2 * m - 6;
    var X = function (z) { return rx + (z - Z0) / (Z1 - Z0) * rw; }, Y = function (r) { return ry + rh - (r / R1) * rh; };
    ctx.save();
    ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
    // light grid
    ctx.strokeStyle = '#f3ecee'; ctx.lineWidth = 1;
    for (var gz = 0; gz <= 100; gz += 20) { ctx.beginPath(); ctx.moveTo(X(gz), ry); ctx.lineTo(X(gz), ry + rh); ctx.stroke(); }
    for (var gr = 10; gr < R1; gr += 10) { ctx.beginPath(); ctx.moveTo(rx, Y(gr)); ctx.lineTo(rx + rw, Y(gr)); ctx.stroke(); }
    // equipotential lines
    ctx.strokeStyle = 'rgba(96,200,120,.55)'; ctx.lineWidth = 1.1;
    for (var e = 0; e < 11; e++) {
      var zz = 3.6 + e * 1.45, bulge = 1.6 * Math.exp(-Math.pow((zz - 10) / 6, 2)) + 0.4;
      ctx.beginPath();
      for (var rr = 0; rr <= 5.6; rr += 0.4) {
        var zq = zz + bulge * (1 - Math.pow(rr / 5.8, 2));
        if (rr) ctx.lineTo(X(zq), Y(rr)); else ctx.moveTo(X(zq), Y(rr));
      }
      ctx.stroke();
    }
    // plasma (left)
    var pg = ctx.createRadialGradient(X(-3), Y(0), 0, X(-3), Y(0), (X(6) - X(-3)) * 1.4);
    pg.addColorStop(0, 'rgba(255,90,215,.75)'); pg.addColorStop(0.6, 'rgba(255,120,225,.35)'); pg.addColorStop(1, 'rgba(255,140,230,0)');
    ctx.fillStyle = pg; ctx.fillRect(X(-3), Y(9), X(8) - X(-3), Y(0) - Y(9));
    // symmetry axis
    ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(70,70,80,.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(rx, Y(0) - 1); ctx.lineTo(rx + rw, Y(0) - 1); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1; ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
  };

  /* ======================================================= windows */
  var W6 = K.WINDOWS;
  var WINDOWS = W6.slice(0, 4).map(function (w) {      // magnetic, mechanics, conductor, quench
    return Object.assign({}, w, { status: w.status.replace(/\s*ongoing$/, '') });
  });
  WINDOWS.push({ title: 'ibsimu', status: 'beam dynamics', Scene: SceneIBSimu, menu: [28, 36, 30, 40] });
  var N = WINDOWS.length;

  /* nominal stage sizes (px before scaling); the stage is scaled to the width of the band */
  var WIDE = { W: 1920, H: 640 }, NARROW = { W: 980, H: 700 };

  // wide screens: the title-slide layout (current window on the right, earlier ones stacked on the left)
  function layoutWide(stage) {
    var cy = this.H * 0.47, W = this.W, dx = 40, out = [];
    for (var i = 0; i < N; i++) {
      if (i > stage) { out.push(null); continue; }
      if (i === stage) { out.push({ x: W * 0.745 + dx, y: cy, z: 0, ry: 13, rx: 2, s: 0.98, o: 1, dim: 0 }); continue; }
      if (stage === 1) { out.push({ x: W * 0.3 + dx, y: cy, z: -40, ry: 15, rx: 2, s: 0.96, o: 1, dim: 0.04 }); continue; }
      var k = stage - 1 - i; // 0 = most recent stacked window
      out.push({ x: W * 0.33 + dx - k * 92, y: cy - k * 20, z: -110 - k * 46, ry: 30, rx: 2, s: 0.9 - k * 0.018, o: 1, dim: Math.min(0.42, 0.07 + 0.08 * k) });
    }
    return out;
  }
  // narrow screens: the current window in front, the earlier ones stacked behind it on the left
  function layoutNarrow(stage) {
    var cy = this.H * 0.52, W = this.W, out = [];
    for (var i = 0; i < N; i++) {
      if (i > stage) { out.push(null); continue; }
      if (i === stage) { out.push({ x: W * 0.6, y: cy, z: 0, ry: 12, rx: 2, s: 1, o: 1, dim: 0 }); continue; }
      var k = stage - 1 - i;
      out.push({ x: W * 0.41 - k * 34, y: cy - 26 - k * 20, z: -150 - k * 50, ry: 30, rx: 2, s: 0.9 - k * 0.02, o: 1, dim: Math.min(0.42, 0.1 + 0.08 * k) });
    }
    return out;
  }
  function config(narrow) {
    return {
      windows: WINDOWS, steps: 0, maxStage: N - 1,
      auto: { interval: 4.6, hold: 6, out: 1.3 },   // one window every 4.6 s, hold 6 s, fade, repeat
      origin: narrow ? [0.5, 0.46] : [0.52, 0.44],
      cls: narrow ? 'md-big' : '',
      gapMin: narrow ? 70 : 96, overlapLen: narrow ? 80 : 92,
      layout: narrow ? layoutNarrow : layoutWide,
      links: WINDOWS.slice(1).map(function (_, i) { return { a: i, b: i + 1, type: 'blocked', from: i + 1 }; })
    };
  }

  /* ======================================================= mount */
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var host = document.createElement('div');
  host.className = 'hero-anim-stage';
  host.setAttribute('aria-hidden', 'true');
  band.appendChild(host);

  var st = null, mode = null, api = { scale: 1 }, onScreen = true;

  function build() {
    var narrow = band.clientWidth < 820, size = narrow ? NARROW : WIDE;
    api.scale = band.clientWidth / size.W;
    host.style.width = size.W + 'px'; host.style.height = size.H + 'px';
    host.style.transform = 'scale(' + api.scale.toFixed(5) + ')';
    band.classList.toggle('is-narrow', narrow);
    if (mode === narrow && st) { st.resize(); return; }
    if (st) { st.stop(); host.removeChild(st.root); }
    mode = narrow;
    st = new K.Stage(host, api, config(narrow));
    K.geo();
    if (reduce && reduce.matches) { st.finalFrame(); st.stop(); }
    else { st.startAuto(); if (!onScreen) st.stop(); }
  }

  var rt = 0;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(build, 150); });
  if (reduce && reduce.addEventListener) reduce.addEventListener('change', function () { mode = null; build(); });

  // no animation while the band is off screen
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[entries.length - 1].isIntersecting;
      if (!st || (reduce && reduce.matches)) return;
      if (onScreen) st.start(); else st.stop();
    }).observe(band);
  }

  build();
})();
