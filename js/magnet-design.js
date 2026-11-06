/*!
 * magnet-design.js — animated title sequence for the ALESIA deck.
 *
 * Six minimalist "software windows" appear one after the other (every 4.6 s),
 * hold, fade out and start again, forever. Each one runs a
 * small live simulation drawn on <canvas> with a hand-written 3D painter's
 * renderer (no libraries):
 *   0  cst · opera · rat   racetrack coil coloured by |B| (Biot–Savart) + field lines
 *   1  ansys · cast3m      same coil, von Mises colour map, exaggerated deformation
 *   2  conductor design    Rutherford cable with changing dimensions + Jc(B) fit
 *   3  quench design       normal-zone propagation, temperature colour map
 *   4  cryogenics design   process loop: compressor, cold box, turbines, JT, bath
 *   5  nx · catia          CAD: sketch → extrude → shaded model
 * Earlier windows slide left and stack; a blocked red arrow links consecutive
 * windows (the tools do not talk to each other — the problem ALESIA solves).
 *
 * Usage inside deck.js:   <div data-widget="magnet-design"></div>
 * The window engine (Stage) and scenes are exposed as window.MDKit for other
 * widgets (see alesia-windows.js).
 * The sequence plays by itself and loops forever (no key presses). Injects its own CSS.
 * It also runs without deck.js. Timing: MAGNET.auto near the end of this file.
 */
(function () {
  'use strict';

  /* ================================================================ helpers */
  var TAU = Math.PI * 2, DEG = Math.PI / 180;
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { t = clamp01(t); return 1 - (1 - t) * (1 - t) * (1 - t); }
  function easeOutQ(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 4); }
  function easeInOut(t) { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function backOut(t) { t = clamp01(t); var c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
  function hex(h) { return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }
  function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ')'; }
  function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }
  function frac(x) { return x - Math.floor(x); }

  function cmap(stops) {
    var s = stops.map(function (p) { var c = hex(p[1]); return [p[0], c[0], c[1], c[2]]; });
    return function (t, out) {
      t = clamp01(t);
      var i = 1;
      while (i < s.length - 1 && t > s[i][0]) i++;
      var a = s[i - 1], b = s[i], u = (t - a[0]) / ((b[0] - a[0]) || 1);
      u = clamp01(u);
      out[0] = a[1] + (b[1] - a[1]) * u;
      out[1] = a[2] + (b[2] - a[2]) * u;
      out[2] = a[3] + (b[3] - a[3]) * u;
      return out;
    };
  }
  var CM_FIELD = cmap([[0, '#d9e9fb'], [0.25, '#b3d2f4'], [0.5, '#79abe6'], [0.75, '#3a78c6'], [1, '#143c80']]);
  var CM_STRESS = cmap([[0, '#fde3e6'], [0.25, '#f9b3bc'], [0.5, '#f27382'], [0.75, '#da2a40'], [1, '#860013']]);
  var CM_TEMP = cmap([[0, '#fffdf6'], [0.2, '#fff5c4'], [0.46, '#ffe46e'], [0.72, '#ffbf2f'], [1, '#ee7d06']]);

  var RED = hex('#E50019'), RED_D = hex('#b40014');

  /* ================================================================ camera */
  function Cam() { this.yaw = 0.5; this.pitch = 0.6; this.dist = 7; this.focal = 800; this.cx = 0; this.cy = 0; this.update(); }
  Cam.prototype.update = function () {
    this.cyw = Math.cos(this.yaw); this.syw = Math.sin(this.yaw);
    this.cp = Math.cos(this.pitch); this.sp = Math.sin(this.pitch);
  };
  // world (z up) -> screen; writes x, y, depth(w) into out[o..o+2]
  Cam.prototype.proj = function (x, y, z, out, o) {
    var x1 = x * this.cyw - y * this.syw, y1 = x * this.syw + y * this.cyw;
    var d = y1 * this.cp - z * this.sp, up = y1 * this.sp + z * this.cp;
    var w = this.dist + d, k = this.focal / w;
    out[o] = this.cx + x1 * k; out[o + 1] = this.cy - up * k; out[o + 2] = w;
  };
  // world direction/position -> camera space (right, depth, up)
  Cam.prototype.rot = function (x, y, z, out) {
    var x1 = x * this.cyw - y * this.syw, y1 = x * this.syw + y * this.cyw;
    out[0] = x1; out[1] = y1 * this.cp - z * this.sp; out[2] = y1 * this.sp + z * this.cp;
  };

  var LIGHT = (function () { var l = [-0.42, -0.6, 0.68], n = Math.sqrt(l[0] * l[0] + l[1] * l[1] + l[2] * l[2]); return [l[0] / n, l[1] / n, l[2] / n]; })();
  var HALF = (function () { var h = [LIGHT[0], LIGHT[1] - 1, LIGHT[2]], n = Math.sqrt(h[0] * h[0] + h[1] * h[1] + h[2] * h[2]); return [h[0] / n, h[1] / n, h[2] / n]; })();

  /* painter's algorithm item buffer (shared, rendering is synchronous) */
  var MAXI = 20000;
  var I_DEPTH = new Float32Array(MAXI), I_TYPE = new Uint8Array(MAXI), I_A = new Int32Array(MAXI), I_B = new Int32Array(MAXI), I_ORD = new Uint32Array(MAXI);
  var nItems = 0;
  function pushItem(depth, type, a, b) {
    if (nItems >= MAXI) return;
    I_DEPTH[nItems] = depth; I_TYPE[nItems] = type; I_A[nItems] = a; I_B[nItems] = b; nItems++;
  }
  function byDepth(a, b) { return I_DEPTH[b] - I_DEPTH[a]; }
  function sortedItems() {
    var ord = I_ORD.subarray(0, nItems);
    for (var i = 0; i < nItems; i++) ord[i] = i;
    ord.sort(byDepth);
    return ord;
  }

  /* ========================================================= racetrack coil */
  // o (optional): { Ls, Rc, wr, hz, nS, nA, no, nt }; Ls = 0 (no straight parts) gives a solenoid
  function Coil(o) {
    o = o || {};
    var Ls = this.Ls = o.Ls != null ? o.Ls : 2.0, Rc = this.Rc = o.Rc || 0.62, wr = this.wr = o.wr || 0.36, hz = this.hz = o.hz || 0.30;
    var a = this.a = wr / 2, b = this.b = hz / 2, arcL = Math.PI * Rc;
    this.sol = Ls === 0;
    this.P = 2 * Ls + 2 * arcL;
    var nS = this.nS = o.nS != null ? o.nS : 16, nA = this.nA = o.nA || 22, s = [], i;
    for (i = 0; i < nS; i++) s.push(Ls * i / nS);
    for (i = 0; i < nA; i++) s.push(Ls + arcL * i / nA);
    for (i = 0; i < nS; i++) s.push(Ls + arcL + Ls * i / nS);
    for (i = 0; i < nA; i++) s.push(2 * Ls + arcL + arcL * i / nA);
    var NR = this.NR = s.length;
    this.ringS = new Float32Array(s);
    this.cx = new Float32Array(NR); this.cy = new Float32Array(NR);
    this.nx = new Float32Array(NR); this.ny = new Float32Array(NR);
    this.seg = new Uint8Array(NR); this.u = new Float32Array(NR);
    for (i = 0; i < NR; i++) {
      var f = this.frame(s[i]);
      this.cx[i] = f.x; this.cy[i] = f.y; this.nx[i] = f.nx; this.ny[i] = f.ny; this.seg[i] = f.seg; this.u[i] = f.u;
    }
    this.transitions = [0, nS, nS + nA, 2 * nS + nA];
    // cross-section perimeter (r along N, h along Z)
    var no = o.no || 2, nt = o.nt || 3, cs = [];
    for (i = 0; i < no; i++) cs.push([a, -b + 2 * b * i / no, 0]);
    for (i = 0; i < nt; i++) cs.push([a - 2 * a * i / nt, b, 1]);
    for (i = 0; i < no; i++) cs.push([-a, b - 2 * b * i / no, 2]);
    for (i = 0; i < nt; i++) cs.push([-a + 2 * a * i / nt, -b, 3]);
    var NP = this.NP = cs.length;
    this.csR = new Float32Array(NP); this.csH = new Float32Array(NP); this.csFace = new Uint8Array(NP);
    for (i = 0; i < NP; i++) { this.csR[i] = cs[i][0]; this.csH[i] = cs[i][1]; this.csFace[i] = cs[i][2]; }
    this.corners = [0, no, no + nt, 2 * no + nt];
    var NV = this.NV = NR * NP;
    this.bx = new Float32Array(NV); this.by = new Float32Array(NV); this.bz = new Float32Array(NV);
    for (i = 0; i < NR; i++) for (var j = 0; j < NP; j++) {
      var v = i * NP + j;
      this.bx[v] = this.cx[i] + this.csR[j] * this.nx[i];
      this.by[v] = this.cy[i] + this.csR[j] * this.ny[i];
      this.bz[v] = this.csH[j];
    }
  }
  Coil.prototype.frame = function (s) {
    var Ls = this.Ls, Rc = this.Rc, arcL = Math.PI * Rc, th;
    if (s < Ls) return { x: -Ls / 2 + s, y: Rc, nx: 0, ny: 1, seg: 0, u: -Ls / 2 + s };
    s -= Ls;
    if (s < arcL) { th = Math.PI / 2 - s / Rc; return { x: Ls / 2 + Rc * Math.cos(th), y: Rc * Math.sin(th), nx: Math.cos(th), ny: Math.sin(th), seg: 1, u: th }; }
    s -= arcL;
    if (s < Ls) return { x: Ls / 2 - s, y: -Rc, nx: 0, ny: -1, seg: 2, u: Ls / 2 - s };
    s -= Ls;
    th = -Math.PI / 2 - s / Rc;
    return { x: -Ls / 2 + Rc * Math.cos(th), y: Rc * Math.sin(th), nx: Math.cos(th), ny: Math.sin(th), seg: 3, u: th };
  };
  // straight-line current filaments for Biot–Savart, offsets = [[r, h], ...]
  Coil.prototype.filaments = function (offs) {
    var NR = this.NR, n = NR * offs.length, k = 0;
    var F = { n: n, mx: new Float32Array(n), my: new Float32Array(n), mz: new Float32Array(n), lx: new Float32Array(n), ly: new Float32Array(n), lz: new Float32Array(n) };
    for (var o = 0; o < offs.length; o++) {
      var r = offs[o][0], h = offs[o][1];
      for (var i = 0; i < NR; i++) {
        var i1 = (i + 1) % NR;
        var x0 = this.cx[i] + r * this.nx[i], y0 = this.cy[i] + r * this.ny[i];
        var x1 = this.cx[i1] + r * this.nx[i1], y1 = this.cy[i1] + r * this.ny[i1];
        F.mx[k] = (x0 + x1) / 2; F.my[k] = (y0 + y1) / 2; F.mz[k] = h;
        F.lx[k] = x1 - x0; F.ly[k] = y1 - y0; F.lz[k] = 0;
        k++;
      }
    }
    return F;
  };
  function biot(F, x, y, z, eps2, out) {
    var bx = 0, by = 0, bz = 0, mx = F.mx, my = F.my, mz = F.mz, lx = F.lx, ly = F.ly, lz = F.lz;
    for (var k = 0, n = F.n; k < n; k++) {
      var rx = x - mx[k], ry = y - my[k], rz = z - mz[k];
      var r2 = rx * rx + ry * ry + rz * rz + eps2;
      var inv = 1 / (r2 * Math.sqrt(r2));
      bx += (ly[k] * rz - lz[k] * ry) * inv;
      by += (lz[k] * rx - lx[k] * rz) * inv;
      bz += (lx[k] * ry - ly[k] * rx) * inv;
    }
    out[0] = bx; out[1] = by; out[2] = bz;
  }

  Coil.prototype.computeFields = function () {
    var NV = this.NV, NP = this.NP, a = this.a, b = this.b, i, v;
    // |B| on the surface
    var offs = [[a / 2, b / 2], [a / 2, -b / 2], [-a / 2, b / 2], [-a / 2, -b / 2]];
    if (this.sol) { offs = []; [-0.75, -0.25, 0.25, 0.75].forEach(function (h) { offs.push([a / 2, h * b], [-a / 2, h * b]); }); }
    var F = this.filaments(offs);
    var B = [0, 0, 0], mag = new Float32Array(NV), lo = 1e9, hi = -1e9;
    for (v = 0; v < NV; v++) {
      biot(F, this.bx[v], this.by[v], this.bz[v], 0.003, B);
      mag[v] = Math.sqrt(B[0] * B[0] + B[1] * B[1] + B[2] * B[2]);
      if (mag[v] < lo) lo = mag[v];
      if (mag[v] > hi) hi = mag[v];
    }
    this.Bn = new Float32Array(NV);
    for (v = 0; v < NV; v++) this.Bn[v] = Math.pow((mag[v] - lo) / (hi - lo), 0.85);

    // von Mises-like stress map and Lorentz-force displacement direction
    this.sig = new Float32Array(NV);
    this.dispDir = new Float32Array(NV * 3);
    var smax = 0;
    for (i = 0; i < this.NR; i++) {
      var seg = this.seg[i], bend, g;
      if (seg === 0 || seg === 2) {
        var xi = 2 * this.u[i] / this.Ls;
        bend = 0.62 * (1 - xi * xi) + 0.38 * Math.pow(Math.abs(xi), 8);
        g = 0.2 + 0.8 * (1 - xi * xi);
      } else { bend = 0.34; g = 0.2; }
      for (var j = 0; j < NP; j++) {
        v = i * NP + j;
        var s;
        if (this.sol) {   // solenoid: hoop stress highest on the inner radius, ends pulled towards the mid-plane
          s = 0.12 + 0.48 * this.Bn[v] + 0.4 * (a - this.csR[j]) / (2 * a);
          this.dispDir[3 * v] = this.nx[i] * 0.6;
          this.dispDir[3 * v + 1] = this.ny[i] * 0.6;
          this.dispDir[3 * v + 2] = -0.3 * (this.csH[j] / b);
        } else {
          var fr = 0.32 + 0.68 * Math.abs(this.csR[j]) / a;
          s = 0.08 + 0.72 * bend * fr + 0.28 * this.Bn[v];
          this.dispDir[3 * v] = this.nx[i] * g;
          this.dispDir[3 * v + 1] = this.ny[i] * g;
          this.dispDir[3 * v + 2] = 0.12 * g * (this.csH[j] / b);
        }
        this.sig[v] = s; if (s > smax) smax = s;
      }
    }
    for (v = 0; v < NV; v++) this.sig[v] /= smax;

    // quench: arrival-time ingredients from a hot spot on the top straight
    // (solenoid: on the outer surface, on the side facing the camera of the quench window)
    var s0 = this.Ls / 2, P = this.P, r0 = a * 0.2, h0 = b;
    if (this.sol) { s0 = arcLen(this) + 0.72 * this.Rc; r0 = a; h0 = 0.3 * b; }
    this.qDs = new Float32Array(NV); this.qDt = new Float32Array(NV);
    for (i = 0; i < this.NR; i++) for (j = 0; j < NP; j++) {
      v = i * NP + j;
      var ds = Math.abs(this.ringS[i] - s0); ds = Math.min(ds, P - ds);
      this.qDs[v] = ds;
      this.qDt[v] = Math.abs(this.csR[j] - r0) / (2 * a) + Math.abs(this.csH[j] - h0) / (2 * b);
    }
    var fh = this.frame(s0);
    this.hot = [fh.x + r0 * fh.nx, fh.y + r0 * fh.ny, h0]; // world position of the hot spot
  };

  /* field lines: RK4 streamlines of a single softened filament loop */
  function arcLen(c) { return Math.PI * c.Rc; }
  function traceFieldLines(coil) {
    var F = coil.filaments(coil.sol ? [[0, -0.6 * coil.b], [0, 0], [0, 0.6 * coil.b]] : [[0, 0]]), eps2 = 0.012, B = [0, 0, 0];
    var zMax = coil.sol ? 2.4 : 1.9;
    function dir(x, y, z, o) {
      biot(F, x, y, z, eps2, B);
      var m = Math.sqrt(B[0] * B[0] + B[1] * B[1] + B[2] * B[2]) || 1;
      o[0] = B[0] / m; o[1] = B[1] / m; o[2] = B[2] / m;
    }
    var k1 = [0, 0, 0], k2 = [0, 0, 0], k3 = [0, 0, 0], k4 = [0, 0, 0];
    function trace(p0, sgn) {
      var pts = [p0[0], p0[1], p0[2]], p = p0.slice(), h = 0.05 * sgn, len = 0, closed = false;
      for (var n = 0; n < 360; n++) {
        dir(p[0], p[1], p[2], k1);
        dir(p[0] + k1[0] * h / 2, p[1] + k1[1] * h / 2, p[2] + k1[2] * h / 2, k2);
        dir(p[0] + k2[0] * h / 2, p[1] + k2[1] * h / 2, p[2] + k2[2] * h / 2, k3);
        dir(p[0] + k3[0] * h, p[1] + k3[1] * h, p[2] + k3[2] * h, k4);
        p[0] += h * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6;
        p[1] += h * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6;
        p[2] += h * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) / 6;
        pts.push(p[0], p[1], p[2]);
        len += Math.abs(h);
        var dx = p[0] - p0[0], dy = p[1] - p0[1], dz = p[2] - p0[2];
        if (len > 0.5 && dx * dx + dy * dy + dz * dz < 1.6 * h * h) { closed = true; break; }
        if (Math.abs(p[0]) > 3.1 || Math.abs(p[1]) > 2.6 || Math.abs(p[2]) > zMax) break;
      }
      return { pts: pts, closed: closed };
    }
    var inner = coil.Rc - coil.a, seeds = [];
    if (coil.sol) {   // solenoid: seeds in the bore, at three radii
      [0.3, 0.62, 0.86].forEach(function (f, k) {
        for (var q = 0; q < 4; q++) { var an = q * Math.PI / 2 + k * 0.5; seeds.push([f * inner * Math.cos(an), f * inner * Math.sin(an), 0]); }
      });
    } else [0.06, 0.15, 0.26].forEach(function (d) {
      [-0.72, 0, 0.72].forEach(function (x) { seeds.push([x, inner - d, 0]); seeds.push([x, -(inner - d), 0]); });
      seeds.push([coil.Ls / 2 + inner - d, 0, 0]);
      seeds.push([-(coil.Ls / 2 + inner - d), 0, 0]);
    });
    return seeds.map(function (sd) {
      var f = trace(sd, 1), pts, mid = 0, closed = f.closed;
      if (closed) pts = f.pts;
      else {
        var bk = trace(sd, -1).pts, rb = [];
        for (var i = bk.length - 3; i >= 3; i -= 3) rb.push(bk[i], bk[i + 1], bk[i + 2]);
        mid = rb.length / 3;
        pts = rb.concat(f.pts);
      }
      var n = pts.length / 3, arc = new Float32Array(n);
      for (var q = 1; q < n; q++) {
        var ex = pts[3 * q] - pts[3 * q - 3], ey = pts[3 * q + 1] - pts[3 * q - 2], ez = pts[3 * q + 2] - pts[3 * q - 1];
        arc[q] = arc[q - 1] + Math.sqrt(ex * ex + ey * ey + ez * ez);
      }
      // nearest coil ring for every point: decides whether a segment is behind or in front of the conductor
      var ring = new Uint16Array(n);
      for (var q2 = 0; q2 < n; q2++) {
        var best = 1e9, bi = 0, px = pts[3 * q2], py = pts[3 * q2 + 1], pz = pts[3 * q2 + 2];
        for (var r = 0; r < coil.NR; r++) {
          var ddx = px - coil.cx[r], ddy = py - coil.cy[r], dd = ddx * ddx + ddy * ddy + pz * pz;
          if (dd < best) { best = dd; bi = r; }
        }
        ring[q2] = bi;
      }
      return { pts: new Float32Array(pts), n: n, mid: mid, closed: closed, arc: arc, ring: ring, sp: new Float32Array(n * 3), lo: 0, hi: 0 };
    });
  }

  /* ===================================================== coil renderer */
  function Renderer(coil) {
    var NV = coil.NV, NQ = coil.NR * coil.NP;
    this.coil = coil;
    this.vx = new Float32Array(NV); this.vy = new Float32Array(NV); this.vz = new Float32Array(NV);
    this.sp = new Float32Array(NV * 3);
    this.qf = new Float32Array(NQ); this.qs = new Float32Array(NQ);
    this.cf = new Float32Array(4); this.cs = new Float32Array(4);
    this.rc = [0, 0, 0]; this.col = [0, 0, 0];
  }

  var CH = 6; // field-line chunk length (points)

  /**
   * cfg: scalar (Float32Array NV) + cmap | base [r,g,b]; disp (Float32Array 3NV); grow 0..1;
   *      hScale; lines + reveal + time + lineRGB; edges + edgeColor; quadTint(q, col) ; alpha
   */
  function renderCoil(ctx, cam, R, cfg) {
    var c = R.coil, NR = c.NR, NP = c.NP, NV = c.NV, b = c.b;
    var vx = R.vx, vy = R.vy, vz = R.vz, sp = R.sp, rc = R.rc;
    var disp = cfg.disp, hS = cfg.hScale == null ? 1 : cfg.hScale, v, i, j;
    for (v = 0; v < NV; v++) {
      var x = c.bx[v], y = c.by[v], z = c.bz[v];
      if (hS !== 1) z = -b + (z + b) * hS;
      if (disp) { x += disp[3 * v]; y += disp[3 * v + 1]; z += disp[3 * v + 2]; }
      vx[v] = x; vy[v] = y; vz[v] = z;
      cam.proj(x, y, z, sp, 3 * v);
    }
    nItems = 0;
    var full = cfg.grow == null || cfg.grow >= 0.999;
    var nRing = full ? NR : Math.max(2, Math.floor(cfg.grow * NR));
    var nQR = full ? NR : nRing - 1;

    function facing(nx, ny, nz, mx, my, mz) {
      cam.rot(nx, ny, nz, rc); var a0 = rc[0], a1 = rc[1], a2 = rc[2];
      cam.rot(mx, my, mz, rc);
      return a0 * -rc[0] + a1 * -(cam.dist + rc[1]) + a2 * -rc[2] > 0 ? [a0, a1, a2] : null;
    }

    for (i = 0; i < nQR; i++) {
      var i1 = (i + 1) % NR;
      for (j = 0; j < NP; j++) {
        var j1 = (j + 1) % NP;
        var a0 = i * NP + j, a1 = i * NP + j1, b1 = i1 * NP + j1, b0 = i1 * NP + j;
        var ux = vx[b1] - vx[a0], uy = vy[b1] - vy[a0], uz = vz[b1] - vz[a0];
        var wx = vx[a1] - vx[b0], wy = vy[a1] - vy[b0], wz = vz[a1] - vz[b0];
        var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        var f = c.csFace[j], ox = 0, oy = 0, oz = 0;
        if (f === 0) { ox = c.nx[i]; oy = c.ny[i]; } else if (f === 2) { ox = -c.nx[i]; oy = -c.ny[i]; } else if (f === 1) oz = 1; else oz = -1;
        if (nx * ox + ny * oy + nz * oz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        var n = facing(nx, ny, nz, (vx[a0] + vx[a1] + vx[b1] + vx[b0]) * 0.25, (vy[a0] + vy[a1] + vy[b1] + vy[b0]) * 0.25, (vz[a0] + vz[a1] + vz[b1] + vz[b0]) * 0.25);
        if (!n) continue;
        var q = i * NP + j;
        var lam = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
        var hs = n[0] * HALF[0] + n[1] * HALF[1] + n[2] * HALF[2];
        R.qf[q] = 0.6 + 0.42 * (lam > 0 ? lam : 0);
        R.qs[q] = hs > 0 ? Math.pow(hs, 30) : 0;
        pushItem((sp[3 * a0 + 2] + sp[3 * a1 + 2] + sp[3 * b1 + 2] + sp[3 * b0 + 2]) * 0.25, 0, q, 0);
      }
    }
    // end caps while the coil is "growing"
    if (!full) {
      [0, nRing - 1].forEach(function (ri, k) {
        var tx = c.ny[ri], ty = -c.nx[ri], sg = k === 0 ? -1 : 1, mx = 0, my = 0, mz = 0, d = 0;
        for (var jj = 0; jj < NP; jj++) { var vv = ri * NP + jj; mx += vx[vv]; my += vy[vv]; mz += vz[vv]; d += sp[3 * vv + 2]; }
        var nn = facing(sg * tx, sg * ty, 0, mx / NP, my / NP, mz / NP);
        if (!nn) return;
        var lam = nn[0] * LIGHT[0] + nn[1] * LIGHT[1] + nn[2] * LIGHT[2];
        R.cf[k] = 0.6 + 0.42 * (lam > 0 ? lam : 0);
        pushItem(d / NP - 0.001, 4, ri, k);
      });
    }
    // field lines: each chunk goes into a "behind" or "in front of the coil" bucket, grouped by brightness,
    // so the whole set is drawn with ~16 strokes instead of one stroke per chunk
    var lines = cfg.lines, li, L, p, NB = 8, Qq = QUALITY(), lstep = Qq ? [1, 1, 2][Qq.level] : 1;
    var LB = R.lb || (R.lb = []), LF = R.lf || (R.lf = []);
    var lrgb0 = cfg.lineRGB || [60, 120, 200], tnow0 = cfg.time || 0;
    if (lines) {
      for (var bq = 0; bq < NB; bq++) { (LB[bq] = LB[bq] || []).length = 0; (LF[bq] = LF[bq] || []).length = 0; }
      var rw = R.ringW || (R.ringW = new Float32Array(NR)), tmp3 = R.tmp3 || (R.tmp3 = new Float32Array(3));
      for (var rr = 0; rr < NR; rr++) { cam.proj(c.cx[rr], c.cy[rr], 0, tmp3, 0); rw[rr] = tmp3[2]; }
      for (li = 0; li < lines.length; li += lstep) {  // low quality: every other field line
        L = lines[li];
        var lo = Math.floor(L.mid * (1 - cfg.reveal)), hi = Math.ceil(L.mid + (L.n - 1 - L.mid) * cfg.reveal);
        L.lo = lo; L.hi = hi;
        if (hi - lo < 1) continue;
        for (p = lo; p <= hi; p++) cam.proj(L.pts[3 * p], L.pts[3 * p + 1], L.pts[3 * p + 2], L.sp, 3 * p);
        for (var c0 = lo; c0 < hi; c0 += CH) {
          var c1 = Math.min(hi, c0 + CH), ds = 0, cm = (c0 + c1) >> 1;
          for (p = c0; p <= c1; p++) ds += L.sp[3 * p + 2];
          ds /= (c1 - c0 + 1);
          var pulse0 = 0.5 + 0.5 * Math.sin(L.arc[cm] * 6.5 - tnow0 * 3.4 + li * 1.7), p6 = Math.pow(pulse0, 6);
          var al0 = 0.2 + 0.62 * p6;
          if (!L.closed) al0 *= clamp01(Math.min(c0, L.n - 1 - c1) / 14);
          var bk = Math.min(NB - 1, Math.floor(al0 / 0.82 * NB));
          (ds < rw[L.ring[cm]] ? LF : LB)[bk].push(li, c0);
        }
      }
    }
    // behind the coil the lines are drawn opaque (pre-mixed with the white background): same look, much
    // cheaper to rasterise than translucent strokes; points closer than ~2 px on screen are skipped
    var wb = cfg.alpha == null;
    function strokeBuckets(B, front) {
      ctx.lineJoin = 'bevel'; ctx.lineCap = 'butt';
      for (var b2 = 0; b2 < NB; b2++) {
        var arr = B[b2];
        if (!arr || !arr.length) continue;
        var al = (b2 + 0.5) / NB * 0.82;
        ctx.strokeStyle = front || !wb ? rgba(lrgb0, al) : 'rgb(' + Math.round(255 + (lrgb0[0] - 255) * al) + ',' + Math.round(255 + (lrgb0[1] - 255) * al) + ',' + Math.round(255 + (lrgb0[2] - 255) * al) + ')';
        ctx.lineWidth = 1.2 + 0.9 * clamp01((al - 0.2) / 0.62);
        ctx.beginPath();
        for (var m2 = 0; m2 < arr.length; m2 += 2) {
          var Ln = lines[arr[m2]], s0 = arr[m2 + 1], s1 = Math.min(Ln.hi, s0 + CH), sp2 = Ln.sp;
          var lx = sp2[3 * s0], ly = sp2[3 * s0 + 1];
          ctx.moveTo(lx, ly);
          for (var p2 = s0 + 1; p2 <= s1; p2++) {
            var px = sp2[3 * p2], py = sp2[3 * p2 + 1], ddx = px - lx, ddy = py - ly;
            if (p2 < s1 && ddx * ddx + ddy * ddy < 4) continue;
            ctx.lineTo(px, py); lx = px; ly = py;
          }
        }
        ctx.stroke();
      }
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    }
    // CAD feature edges
    if (cfg.edges) {
      for (var ck = 0; ck < 4; ck++) {
        var jc = c.corners[ck];
        for (i = 0; i < nQR; i++) {
          var e0 = i * NP + jc, e1 = ((i + 1) % NR) * NP + jc;
          pushItem((sp[3 * e0 + 2] + sp[3 * e1 + 2]) * 0.5 - 0.035, 2, e0, e1);
        }
      }
      c.transitions.forEach(function (ri) {
        if (ri >= nRing) return;
        for (var k = 0; k < 4; k++) {
          var e0 = ri * NP + c.corners[k], e1 = ri * NP + c.corners[(k + 1) % 4];
          pushItem((sp[3 * e0 + 2] + sp[3 * e1 + 2]) * 0.5 - 0.035, 3, e0, e1);
        }
      });
    }

    var ord = sortedItems(), col = R.col, S = cfg.scalar, cm = cfg.cmap, base = cfg.base, spec = cfg.spec == null ? 70 : cfg.spec;
    var lrgb = cfg.lineRGB || [60, 120, 200], tnow = cfg.time || 0;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (cfg.alpha != null) ctx.globalAlpha = cfg.alpha;
    if (lines) strokeBuckets(LB, false);
    for (var k = 0; k < nItems; k++) {
      var it = ord[k], type = I_TYPE[it];
      if (type === 0) {
        var qq = I_A[it], qi = (qq / NP) | 0, qj = qq % NP, qi1 = (qi + 1) % NR, qj1 = (qj + 1) % NP;
        var v0 = qi * NP + qj, v1 = qi * NP + qj1, v2 = qi1 * NP + qj1, v3 = qi1 * NP + qj;
        if (S) cm((S[v0] + S[v1] + S[v2] + S[v3]) * 0.25, col); else { col[0] = base[0]; col[1] = base[1]; col[2] = base[2]; }
        if (cfg.quadTint) cfg.quadTint(qq, col);
        var ff = R.qf[qq], sh = R.qs[qq] * spec;
        var cs = 'rgb(' + Math.min(255, col[0] * ff + sh) + ',' + Math.min(255, col[1] * ff + sh) + ',' + Math.min(255, col[2] * ff + sh) + ')';
        ctx.fillStyle = cs; ctx.strokeStyle = cs; ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(sp[3 * v0], sp[3 * v0 + 1]); ctx.lineTo(sp[3 * v1], sp[3 * v1 + 1]);
        ctx.lineTo(sp[3 * v2], sp[3 * v2 + 1]); ctx.lineTo(sp[3 * v3], sp[3 * v3 + 1]);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (type === 1) {
        L = lines[I_A[it]];
        var s0 = I_B[it], s1 = Math.min(L.hi, s0 + CH), am = L.arc[(s0 + s1) >> 1];
        var pulse = 0.5 + 0.5 * Math.sin(am * 6.5 - tnow * 3.4 + I_A[it] * 1.7);
        var al = 0.2 + 0.62 * Math.pow(pulse, 6);
        if (!L.closed) al *= clamp01(Math.min(s0, L.n - 1 - s1) / 14);
        ctx.strokeStyle = rgba(lrgb, al);
        ctx.lineWidth = 1.2 + 0.9 * Math.pow(pulse, 6);
        ctx.beginPath(); ctx.moveTo(L.sp[3 * s0], L.sp[3 * s0 + 1]);
        for (p = s0 + 1; p <= s1; p++) ctx.lineTo(L.sp[3 * p], L.sp[3 * p + 1]);
        ctx.stroke();
      } else if (type === 2 || type === 3) {
        var ea = I_A[it], eb = I_B[it];
        ctx.strokeStyle = cfg.edgeColor || '#2b2f36';
        ctx.lineWidth = type === 2 ? 1.25 : 0.8;
        ctx.beginPath(); ctx.moveTo(sp[3 * ea], sp[3 * ea + 1]); ctx.lineTo(sp[3 * eb], sp[3 * eb + 1]); ctx.stroke();
      } else if (type === 4) {
        var ri = I_A[it], kk = I_B[it], s = 0;
        if (S) { for (j = 0; j < NP; j++) s += S[ri * NP + j]; cm(s / NP, col); } else { col[0] = base[0]; col[1] = base[1]; col[2] = base[2]; }
        var f2 = R.cf[kk];
        var cs2 = 'rgb(' + col[0] * f2 + ',' + col[1] * f2 + ',' + col[2] * f2 + ')';
        ctx.fillStyle = cs2; ctx.strokeStyle = cs2; ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (j = 0; j < NP; j++) { var vv = ri * NP + j; if (j) ctx.lineTo(sp[3 * vv], sp[3 * vv + 1]); else ctx.moveTo(sp[3 * vv], sp[3 * vv + 1]); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    if (lines) strokeBuckets(LF, true);
    ctx.globalAlpha = 1;
  }

  /* shared geometry (computed once, lazily) */
  var GEOS = {};
  var SHAPES = { racetrack: null, solenoid: { Ls: 0, nS: 0, nA: 30, Rc: 0.74, wr: 0.28, hz: 1.3, no: 6, nt: 3 } };
  function geo(shape) {
    shape = shape || 'racetrack';
    if (GEOS[shape]) return GEOS[shape];
    var coil = new Coil(SHAPES[shape]);
    coil.computeFields();
    return (GEOS[shape] = { coil: coil, R: new Renderer(coil), lines: traceFieldLines(coil) });
  }
  // camera spans [width, height] of each scene, per shape
  var SPANS = { racetrack: { mag: [5.4, 3.0], mech: [4.7, 2.5] }, solenoid: { mag: [3.3, 2.8], mech: [2.5, 2.25] } };
  function spans(shape, k) { return SPANS[shape || 'racetrack'][k]; }

  function fitCam(cam, W, H, spanX, spanY, cxFrac, cyFrac) {
    cam.dist = 7;
    cam.cx = W * (cxFrac == null ? 0.5 : cxFrac);
    cam.cy = H * (cyFrac == null ? 0.5 : cyFrac);
    cam.focal = Math.min(W / spanX, H / spanY) * cam.dist;
  }

  /* ================================================================ scenes */

  // the same scene drawn with another coil shape (e.g. a solenoid instead of the racetrack)
  function withShape(Base, shape) {
    function S() { Base.call(this, shape); }
    S.prototype = Object.create(Base.prototype); S.prototype.constructor = S;
    return S;
  }

  /* 0 — magnetic: |B| colour map + animated field lines */
  function SceneMagnetic(shape) { this.cam = new Cam(); this.shape = shape; }
  SceneMagnetic.prototype.draw = function (ctx, W, H, t) {
    var G = geo(this.shape), cam = this.cam, sp = spans(this.shape, 'mag');
    fitCam(cam, W, H, sp[0], sp[1], 0.5, 0.52);
    cam.yaw = 0.5 + 0.32 * Math.sin(t * 0.21);
    cam.pitch = 0.6 + 0.04 * Math.sin(t * 0.16);
    cam.update();
    var rev = clamp01((t - 1.2) / 2.4);
    renderCoil(ctx, cam, G.R, {
      scalar: G.coil.Bn, cmap: CM_FIELD, grow: easeOut(t / 1.4),
      lines: rev > 0 ? G.lines : null, reveal: easeInOut(rev), time: t, lineRGB: [44, 108, 196]
    });
  };

  /* 1 — mechanics: stress colour map + breathing deformation + undeformed ghost */
  function SceneMechanics(shape) {
    this.cam = new Cam(); this.shape = shape;
    var c = geo(shape).coil;
    this.disp = new Float32Array(c.NV * 3);
    this.sc = new Float32Array(c.NV);
    this.ghost = new Float32Array(c.NR * 3);
  }
  SceneMechanics.prototype.draw = function (ctx, W, H, t) {
    var G = geo(this.shape), c = G.coil, cam = this.cam, v, sp = spans(this.shape, 'mech');
    fitCam(cam, W, H, sp[0], sp[1], 0.5, 0.53);
    cam.yaw = 0.42 + 0.26 * Math.sin(t * 0.18 + 1.2);
    cam.pitch = 0.62;
    cam.update();
    var Amax = 0.22, ph = Math.max(0, t - 1.4);
    var A = Amax * (0.5 - 0.5 * Math.cos(ph * TAU / 3.6)) * clamp01(ph / 0.8 + 0.2 * (ph > 0));
    var a = A / Amax;
    for (v = 0; v < c.NV; v++) {
      this.disp[3 * v] = c.dispDir[3 * v] * A;
      this.disp[3 * v + 1] = c.dispDir[3 * v + 1] * A;
      this.disp[3 * v + 2] = c.dispDir[3 * v + 2] * A;
      this.sc[v] = c.sig[v] * (0.42 + 0.55 * a);
    }
    // undeformed ghost (outer top + inner top edges)
    if (t > 1.2) {
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(150,150,160,' + (0.55 * clamp01((t - 1.2) / 0.6)) + ')';
      ctx.lineWidth = 1;
      var g = this.ghost;
      [c.corners[1], c.corners[2], c.corners[0], c.corners[3]].forEach(function (jc) {
        ctx.beginPath();
        for (var i = 0; i <= c.NR; i++) {
          var vv = (i % c.NR) * c.NP + jc;
          cam.proj(c.bx[vv], c.by[vv], c.bz[vv], g, 0);
          if (i) ctx.lineTo(g[0], g[1]); else ctx.moveTo(g[0], g[1]);
        }
        ctx.stroke();
      });
      ctx.restore();
    }
    renderCoil(ctx, cam, G.R, { scalar: this.sc, cmap: CM_STRESS, grow: easeOut(t / 1.4), disp: this.disp });
  };

  /* 3 — quench: normal-zone propagation */
  function SceneQuench(shape) {
    this.cam = new Cam(); this.shape = shape;
    this.T = new Float32Array(geo(shape).coil.NV);
    this.hp = new Float32Array(3);
  }
  SceneQuench.prototype.draw = function (ctx, W, H, t) {
    var G = geo(this.shape), c = G.coil, cam = this.cam, v, sp = spans(this.shape, 'mech');
    fitCam(cam, W, H, sp[0], sp[1], 0.5, 0.53);
    cam.yaw = 0.72 + 0.22 * Math.sin(t * 0.19);
    cam.pitch = 0.6;
    cam.update();
    var period = 11, tc = t > 1.3 ? (t - 1.3) % period : -1;
    var fade = tc > 9.6 ? clamp01((period - tc) / 1.4) : 1;
    for (v = 0; v < c.NV; v++) {
      if (tc < 0) { this.T[v] = 0; continue; }
      var arr = c.qDs[v] / 0.8 + c.qDt[v] * 0.9;
      var T = 0;
      if (tc > arr) T = (1 - Math.exp(-(tc - arr) / 1.25)) * (0.5 + 0.5 * Math.exp(-c.qDs[v] / 1.3));
      this.T[v] = T * fade;
    }
    renderCoil(ctx, cam, G.R, { scalar: this.T, cmap: CM_TEMP, grow: easeOut(t / 1.4), spec: 50 });
    if (tc >= 0) {
      cam.proj(c.hot[0], c.hot[1], c.hot[2], this.hp, 0);
      var x = this.hp[0], y = this.hp[1], k = clamp01(tc / 0.6) * fade, r = 26 + 6 * Math.sin(t * 5);
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,235,' + 0.95 * k + ')');
      g.addColorStop(0.35, 'rgba(255,190,40,' + 0.55 * k + ')');
      g.addColorStop(1, 'rgba(255,150,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
  };

  /* 5 — CAD: sketch → extrude → shaded model with feature edges */
  function SceneCAD() { this.cam = new Cam(); this.p = new Float32Array(3); this.q = new Float32Array(3); this.r = [0, 0, 0]; }
  SceneCAD.prototype.draw = function (ctx, W, H, t) {
    var G = geo(), c = G.coil, cam = this.cam, P = this.p, Q = this.q, i, k;
    var TW = 112; // feature tree width
    // feature tree panel
    ctx.fillStyle = '#fbf8f8'; ctx.fillRect(0, 0, TW, H);
    ctx.fillStyle = '#f1e4e6'; ctx.fillRect(TW, 0, 1, H);
    var phase = t < 0.3 ? 0 : t < 1.9 ? 1 : t < 3.2 ? 2 : 3;
    var widths = [58, 44, 66, 50, 38, 60, 46];
    for (i = 0; i < 7; i++) {
      var yy = 20 + i * 26, active = i === Math.min(phase + 1, 3) && i > 0;
      if (active) { ctx.fillStyle = '#fde4e7'; ctx.fillRect(4, yy - 9, TW - 9, 20); }
      ctx.globalAlpha = i <= phase + 1 ? 1 : 0.4;
      ctx.strokeStyle = active ? '#E50019' : '#d6b9bd'; ctx.lineWidth = 1.2;
      ctx.strokeRect(12.5, yy - 3.5, 8, 8);
      ctx.fillStyle = active ? '#f39aa5' : '#eadcde';
      ctx.fillRect(28, yy - 1, widths[i], 4);
      ctx.globalAlpha = 1;
    }
    // camera
    fitCam(cam, W - TW, H, 4.9, 2.7, 0.5, 0.54);
    cam.cx += TW;
    cam.yaw = 0.6 + t * 0.11;
    cam.pitch = 0.58;
    cam.update();
    var z0 = -c.b;
    // ground grid
    ctx.lineWidth = 1;
    for (k = -8; k <= 8; k++) {
      var gx = k * 0.3;
      ctx.strokeStyle = k === 0 ? '#ead7da' : '#f1eff1';
      cam.proj(gx, -2.4, z0 - 0.01, P, 0); cam.proj(gx, 2.4, z0 - 0.01, Q, 0);
      ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(Q[0], Q[1]); ctx.stroke();
      cam.proj(-2.4, gx, z0 - 0.01, P, 0); cam.proj(2.4, gx, z0 - 0.01, Q, 0);
      ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(Q[0], Q[1]); ctx.stroke();
    }
    // sketch
    var ps = clamp01((t - 0.3) / 1.5), pe = clamp01((t - 1.9) / 1.3);
    if (pe < 1) {
      var n = Math.floor(ps * c.NR);
      ctx.strokeStyle = '#3d7fd1'; ctx.lineWidth = 1.7;
      [c.a, -c.a].forEach(function (r) {
        ctx.beginPath();
        for (var ii = 0; ii <= n; ii++) {
          var ri = ii % c.NR;
          cam.proj(c.cx[ri] + r * c.nx[ri], c.cy[ri] + r * c.ny[ri], z0, P, 0);
          if (ii) ctx.lineTo(P[0], P[1]); else ctx.moveTo(P[0], P[1]);
        }
        ctx.stroke();
      });
      if (ps >= 1) {
        ctx.fillStyle = '#3d7fd1';
        c.transitions.forEach(function (ri) {
          [c.a, -c.a].forEach(function (r) {
            cam.proj(c.cx[ri] + r * c.nx[ri], c.cy[ri] + r * c.ny[ri], z0, P, 0);
            ctx.fillRect(P[0] - 2.5, P[1] - 2.5, 5, 5);
          });
        });
      }
    }
    // extrusion and final model
    if (pe > 0) {
      var e = easeInOut(pe);
      var base = mix([196, 218, 246], [210, 214, 221], clamp01((t - 3.2) / 0.6));
      var sel = t > 4.6 && ((t - 4.6) % 5) < 1.9;
      renderCoil(ctx, cam, G.R, {
        base: base, hScale: Math.max(0.03, e), spec: 90,
        edges: true, edgeColor: pe < 1 ? '#3d7fd1' : '#2b2f36',
        quadTint: sel ? function (q, col) {
          var qi = (q / c.NP) | 0, f = c.csFace[q % c.NP];
          if (f === 1 && qi < c.nS) { col[0] = 249; col[1] = 186; col[2] = 194; }
        } : null
      });
      if (pe < 1) { // extrude drag handle
        cam.proj(0, c.Rc, z0 + c.hz * e, P, 0);
        ctx.strokeStyle = '#3d7fd1'; ctx.fillStyle = '#3d7fd1'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(P[0], P[1] - 34); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(P[0] - 5, P[1] - 30); ctx.lineTo(P[0], P[1] - 40); ctx.lineTo(P[0] + 5, P[1] - 30); ctx.fill();
      }
    }
    // axis triad
    var ox = TW + 30, oy = H - 26, r = this.r;
    [[1, 0, 0, '#E50019'], [0, 1, 0, '#4f9d5a'], [0, 0, 1, '#3d7fd1']].forEach(function (ax) {
      cam.rot(ax[0], ax[1], ax[2], r);
      ctx.strokeStyle = ax[3]; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + r[0] * 18, oy - r[2] * 18); ctx.stroke();
    });
    // view cube
    var vcx = W - 38, vcy = 34, sz = 13, corners = [], faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
    var fn = [[0, 0, -1], [0, 0, 1], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0]];
    for (i = 0; i < 8; i++) {
      cam.rot(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, r);
      corners.push([vcx + r[0] * sz, vcy - r[2] * sz]);
    }
    faces.forEach(function (f, fi) {
      cam.rot(fn[fi][0], fn[fi][1], fn[fi][2], r);
      if (r[1] >= 0) return;
      ctx.fillStyle = fi === 1 ? '#fde4e7' : '#f7f3f4';
      ctx.strokeStyle = '#d9c2c6'; ctx.lineWidth = 1;
      ctx.beginPath();
      f.forEach(function (ci, m) { if (m) ctx.lineTo(corners[ci][0], corners[ci][1]); else ctx.moveTo(corners[ci][0], corners[ci][1]); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
    });
  };

  /* 2 — conductor: Rutherford cable + critical-current fit in the background */
  function jcNbTi(B, T) { // Bottura (2000) parametrisation, A/mm²
    var Tc0 = 9.2, Bc20 = 14.5, C0 = 27, al = 0.57, be = 0.9, ga = 2.32;
    var tt = Math.pow(T / Tc0, 1.7), Bc2 = Bc20 * (1 - tt), bb = B / Bc2;
    if (bb >= 1 || bb <= 0) return 0;
    return 3000 * C0 / B * Math.pow(bb, al) * Math.pow(1 - bb, be) * Math.pow(1 - tt, ga);
  }
  function SceneConductor() {
    this.cam = new Cam(); this.P = new Float32Array(3); this.Q = new Float32Array(3);
    this.N = 16;
    this.noise = [1.03, 0.965, 1.025, 0.985, 1.04, 0.96, 1.015, 0.99, 1.02];
  }
  SceneConductor.prototype.plot = function (ctx, W, H, t) {
    var x0 = 44, x1 = W - 22, y0 = 18, y1 = H - 24, Jmax = 9000, Bmax = 14;
    var X = function (B) { return x0 + (B / Bmax) * (x1 - x0); };
    var Y = function (J) { return y1 - (J / Jmax) * (y1 - y0); };
    var pa = easeOut(t / 0.6);
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0 - 4, x1 - x0 + 4, y1 - y0 + 4); ctx.clip();
    ctx.strokeStyle = '#f7eced'; ctx.lineWidth = 1;
    for (var g = 1; g < 7; g++) { ctx.beginPath(); ctx.moveTo(X(g * 2), y1); ctx.lineTo(X(g * 2), y1 - (y1 - y0) * pa); ctx.stroke(); }
    for (g = 1; g < 5; g++) { ctx.beginPath(); ctx.moveTo(x0, Y(g * 2000)); ctx.lineTo(x0 + (x1 - x0) * pa, Y(g * 2000)); ctx.stroke(); }
    var self = this;
    function curve(T, prog, color, width, dash) {
      if (prog <= 0) return;
      var Bc2 = 14.5 * (1 - Math.pow(T / 9.2, 1.7)), Bs = 1.0, Be = Bs + (Bc2 - 0.02 - Bs) * prog;
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
      ctx.beginPath();
      for (var B = Bs, first = true; B <= Be; B += 0.08) { var yy = Y(jcNbTi(B, T)); if (first) { ctx.moveTo(X(B), yy); first = false; } else ctx.lineTo(X(B), yy); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // measured points (4.2 K and 1.9 K)
    var pp = clamp01((t - 0.4) / 1.3);
    [[4.2, 2], [1.9, 3]].forEach(function (set, si) {
      for (var i = 0; i < 8; i++) {
        var B = set[1] + i * (si ? 1.05 : 0.95), show = clamp01(pp * 9 - i - si * 0.5);
        if (show <= 0) continue;
        var J = jcNbTi(B, set[0]) * self.noise[(i + si * 3) % self.noise.length];
        ctx.fillStyle = 'rgba(192,24,45,' + (0.75 * show) + ')';
        ctx.beginPath(); ctx.arc(X(B), Y(J), 3.2 * backOut(show), 0, TAU); ctx.fill();
      }
    });
    curve(4.2, easeInOut((t - 1.3) / 1.4), 'rgba(239,111,127,.85)', 2);
    curve(1.9, easeInOut((t - 1.8) / 1.4), 'rgba(229,0,25,.75)', 2);
    curve(6.0, easeInOut((t - 2.3) / 1.2), 'rgba(246,169,178,.85)', 1.6, [5, 5]);
    // load line: J = I / A, slope follows the cable cross-section
    var pl = easeOut((t - 3.0) / 0.9);
    if (pl > 0) {
      var slope = 640 * this.areaRef / this.area, lo = 0.5, hi = 14;
      for (var it = 0; it < 30; it++) { var mid = (lo + hi) / 2; if (slope * mid < jcNbTi(mid, 1.9)) lo = mid; else hi = mid; }
      var Bq = lo;
      ctx.strokeStyle = 'rgba(124,126,158,.8)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(Bq * 1.15 * pl), Y(slope * Bq * 1.15 * pl)); ctx.stroke();
      ctx.setLineDash([]);
      if (pl >= 1) {
        var Bop = 0.8 * Bq, xo = X(Bop), yo = Y(slope * Bop), pulse = 0.5 + 0.5 * Math.sin(t * 3);
        ctx.strokeStyle = 'rgba(229,0,25,' + (0.25 + 0.3 * pulse) + ')'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(xo, yo, 7 + 4 * pulse, 0, TAU); ctx.stroke();
        ctx.fillStyle = '#E50019'; ctx.beginPath(); ctx.arc(xo, yo, 3.6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#7c7e9e'; ctx.beginPath(); ctx.arc(X(Bq), Y(slope * Bq), 3, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
    // axes
    ctx.strokeStyle = '#dcc2c6'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x0, y1 - (y1 - y0) * pa); ctx.lineTo(x0, y1); ctx.lineTo(x0 + (x1 - x0) * pa, y1); ctx.stroke();
    for (g = 1; g < 7; g++) { ctx.beginPath(); ctx.moveTo(X(g * 2), y1); ctx.lineTo(X(g * 2), y1 + 4); ctx.stroke(); }
    for (g = 1; g < 5; g++) { ctx.beginPath(); ctx.moveTo(x0 - 4, Y(g * 2000)); ctx.lineTo(x0, Y(g * 2000)); ctx.stroke(); }
  };
  SceneConductor.prototype.fps = 20; // slow changes of the cable dimensions: 20 frames per second are enough
  SceneConductor.prototype.draw = function (ctx, W, H, t) {
    var cam = this.cam, P = this.P, Q = this.Q, N = this.N, k, m;
    // animated cable dimensions
    var d = 0.2 * (1 + 0.13 * Math.sin(0.75 * t));
    var kz = 0.92 + 0.045 * Math.sin(0.62 * t + 1.3);
    var ratio = 1.075 + 0.04 * Math.sin(0.5 * t + 2.1);
    var h = 2 * d * kz, rr = (h - d) / 2, Pst = ratio * N * d, Wf = (Pst - TAU * rr) / 2, Wc = Wf + h;
    var q = Pst / N, Lp = d * Pst / Math.sqrt(Math.max(1e-6, q * q - d * d));
    this.area = Wc * h;
    if (!this.areaRef) { // cross-section at the reference dimensions
      var h0 = 2 * 0.2 * 0.92, Ps0 = 1.075 * N * 0.2;
      this.areaRef = ((Ps0 - TAU * (h0 - 0.2) / 2) / 2 + h0) * h0;
    }
    this.plot(ctx, W, H, t);

    fitCam(cam, W, H, 6.8, 3.7, 0.52, 0.47);
    cam.yaw = -0.7 + 0.09 * Math.sin(t * 0.3);
    cam.pitch = 0.55;
    cam.update();
    var Lc = 3.7, xs = -Lc / 2, xe = xs + Lc * easeOut((t - 0.15) / 1.3);
    if (xe <= xs + 0.02) return;
    // level of detail from the real bitmap size: small windows need fewer segments and no filaments
    var dev = ctx.canvas.width, M = dev < 520 ? 28 : dev < 800 ? 44 : 64, devK = dev / W;
    function strandYZ(x, kk, out) {
      var u = frac(x / Lp + kk / N), s = u * Pst, y, z;
      if (s < Wf) { y = -Wf / 2 + s; z = rr; }
      else if (s < Wf + Math.PI * rr) { var f = (s - Wf) / rr; y = Wf / 2 + rr * Math.sin(f); z = rr * Math.cos(f); }
      else if (s < 2 * Wf + Math.PI * rr) { y = Wf / 2 - (s - Wf - Math.PI * rr); z = -rr; }
      else { var f2 = (s - 2 * Wf - Math.PI * rr) / rr; y = -Wf / 2 - rr * Math.sin(f2); z = -rr * Math.cos(f2); }
      out[0] = y; out[1] = z;
    }
    var yz = [0, 0], runs = [];
    for (k = 0; k < N; k++) {
      var cur = null;
      for (m = 0; m <= M; m++) {
        var x = xs + (xe - xs) * m / M;
        strandYZ(x, k, yz);
        cam.proj(x, yz[0], yz[1], P, 0);
        var top = yz[1] > 0;
        if (!cur || cur.top !== top) {
          if (cur) { cur.pts.push(P[0], P[1]); runs.push(cur); }
          cur = { top: top, pts: [], dsum: 0, n: 0 };
        }
        cur.pts.push(P[0], P[1]); cur.dsum += P[2]; cur.n++;
      }
      if (cur) runs.push(cur);
    }
    var wpx = d * cam.focal / cam.dist;
    runs.sort(function (A, B) { if (A.top !== B.top) return A.top ? 1 : -1; return B.dsum / B.n - A.dsum / A.n; });
    ctx.lineCap = 'round'; ctx.lineJoin = 'miter'; // gentle bends: miter joins look the same and rasterise much faster
    runs.forEach(function (r) {
      var p = r.pts;
      if (p.length < 4) return;
      var path = function () { ctx.beginPath(); ctx.moveTo(p[0], p[1]); for (var i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); };
      path(); ctx.strokeStyle = r.top ? '#9a4a33' : '#8a4330'; ctx.lineWidth = wpx; ctx.stroke();
      path(); ctx.strokeStyle = r.top ? '#d88f6c' : '#b77457'; ctx.lineWidth = wpx * 0.74; ctx.stroke();
      path(); ctx.strokeStyle = r.top ? '#fddcc9' : '#d9a086'; ctx.lineWidth = wpx * 0.22; ctx.stroke(); // opaque (pre-mixed): faster
    });
    // cut face: strand cross-sections with Nb-Ti filaments
    var fil = [[0, 0]];
    for (m = 0; m < 6; m++) fil.push([0.25 * Math.cos(m * TAU / 6), 0.25 * Math.sin(m * TAU / 6)]);
    for (m = 0; m < 12; m++) fil.push([0.4 * Math.cos(m * TAU / 12 + 0.26), 0.4 * Math.sin(m * TAU / 12 + 0.26)]);
    var ends = [];
    for (k = 0; k < N; k++) { strandYZ(xe, k, yz); cam.proj(xe, yz[0], yz[1], P, 0); ends.push([yz[0], yz[1], P[2]]); }
    ends.sort(function (A, B) { return B[2] - A[2]; });
    ends.forEach(function (e) {
      ctx.beginPath();
      for (var i = 0; i <= 16; i++) {
        var a = i * TAU / 16;
        cam.proj(xe, e[0] + 0.5 * d * Math.cos(a), e[1] + 0.5 * d * Math.sin(a), P, 0);
        if (i) ctx.lineTo(P[0], P[1]); else ctx.moveTo(P[0], P[1]);
      }
      ctx.fillStyle = '#eaa889'; ctx.fill();
      ctx.strokeStyle = '#9a4a33'; ctx.lineWidth = 1.1; ctx.stroke();
      if (wpx * devK < 7) return;
      ctx.fillStyle = '#7a2d1f';
      ctx.beginPath(); // all filaments of a strand in one fill
      var fr = Math.max(0.8, wpx * 0.045);
      fil.forEach(function (f) {
        cam.proj(xe, e[0] + f[0] * d, e[1] + f[1] * d, P, 0);
        ctx.moveTo(P[0] + fr, P[1]); ctx.arc(P[0], P[1], fr, 0, TAU);
      });
      ctx.fill();
    });
    // dimension lines
    var dimA = clamp01((t - 1.5) / 0.6);
    if (dimA > 0) {
      ctx.save();
      ctx.globalAlpha = dimA;
      ctx.strokeStyle = 'rgba(180,0,20,.75)'; ctx.fillStyle = 'rgba(180,0,20,.85)'; ctx.lineWidth = 1.1;
      var self = this;
      var dim = function (p1, p2, e1, e2) {
        cam.proj(p1[0], p1[1], p1[2], P, 0); var ax = P[0], ay = P[1];
        cam.proj(p2[0], p2[1], p2[2], P, 0); var bx = P[0], by = P[1];
        [e1, e2].forEach(function (e) {
          cam.proj(e[0][0], e[0][1], e[0][2], P, 0); cam.proj(e[1][0], e[1][1], e[1][2], Q, 0);
          ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(Q[0], Q[1]); ctx.stroke();
        });
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        var ang = Math.atan2(by - ay, bx - ax);
        self.head(ctx, ax, ay, ang + Math.PI); self.head(ctx, bx, by, ang);
      };
      var off = 0.3, ext = 0.38;
      dim([xe, -Wc / 2, -h / 2 - off], [xe, Wc / 2, -h / 2 - off],
        [[xe, -Wc / 2, -h / 2 - 0.04], [xe, -Wc / 2, -h / 2 - ext]], [[xe, Wc / 2, -h / 2 - 0.04], [xe, Wc / 2, -h / 2 - ext]]);
      dim([xe, -Wc / 2 - off, -h / 2], [xe, -Wc / 2 - off, h / 2],
        [[xe, -Wc / 2 - 0.04, -h / 2], [xe, -Wc / 2 - ext, -h / 2]], [[xe, -Wc / 2 - 0.04, h / 2], [xe, -Wc / 2 - ext, h / 2]]);
      ctx.restore();
    }
  };
  SceneConductor.prototype.head = function (ctx, x, y, a) {
    var s = 7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - s * Math.cos(a - 0.38), y - s * Math.sin(a - 0.38));
    ctx.lineTo(x - s * Math.cos(a + 0.38), y - s * Math.sin(a + 0.38));
    ctx.closePath(); ctx.fill();
  };

  /* 4 — cryogenics: process loop (no text) */
  function polyCum(pts) { var c = [0]; for (var i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; }
  function polyAt(pts, cum, d, out) {
    var i = 1; while (i < pts.length - 1 && cum[i] < d) i++;
    var u = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    out[0] = lerp(pts[i - 1][0], pts[i][0], u); out[1] = lerp(pts[i - 1][1], pts[i][1], u);
    return out;
  }
  var C_WARM = hex('#E50019'), C_COLD = hex('#4f8fdd'), C_RW = hex('#f39aa6'), C_RC = hex('#86b4ec');
  var CRYO_PIPES = [
    // [points, colour at start, colour at end, flow speed]
    { id: 's1', pts: [[70, 222], [70, 134]], c0: C_WARM, c1: C_WARM, delay: 0.9 },
    { id: 's2', pts: [[70, 50], [70, 24], [120, 24], [120, 112], [450, 112]], c0: C_WARM, c1: mix(C_WARM, C_COLD, 0.86), delay: 1.05 },
    { id: 's3', pts: [[474, 112], [520, 112], [520, 150], [556, 150]], c0: mix(C_WARM, C_COLD, 0.9), c1: C_COLD, delay: 1.6 },
    { id: 'r', pts: [[556, 178], [532, 178], [532, 164], [120, 164], [120, 250], [100, 250]], c0: C_RC, c1: C_RW, delay: 1.25 },
    { id: 't', pts: [[265, 112], [265, 155], [271, 158], [273, 164], [271, 170], [265, 173], [265, 250], [359, 250], [359, 164]], c0: mix(C_WARM, C_COLD, 0.45), c1: mix(C_WARM, C_COLD, 0.7), delay: 1.45 }
  ];
  CRYO_PIPES.forEach(function (p) { p.cum = polyCum(p.pts); p.len = p.cum[p.cum.length - 1]; });

  function SceneCryo() { this.tmp = [0, 0]; }
  SceneCryo.prototype.draw = function (ctx, W, H, t) {
    var k = Math.min(W / 690, H / 352), ox = (W - 680 * k) / 2, oy = (H - 344 * k) / 2 + 2;
    ctx.save();
    ctx.translate(ox, oy); ctx.scale(k, k);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var tmp = this.tmp;
    var pop = function (delay) { return backOut((t - delay) / 0.45); };
    var fade = function (delay) { return clamp01((t - delay) / 0.35); };
    // cold box
    var cb = fade(0.35);
    if (cb > 0) {
      ctx.globalAlpha = cb;
      ctx.setLineDash([7, 6]); ctx.strokeStyle = '#ebb2ba'; ctx.lineWidth = 1.6;
      roundRect(ctx, 152, 46, 346, 286, 16); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(253,240,242,.55)'; roundRect(ctx, 152, 46, 346, 286, 16); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // pipes (progressive reveal, temperature gradient)
    CRYO_PIPES.forEach(function (p) {
      var pr = easeInOut((t - p.delay) / 1.1);
      if (pr <= 0) return;
      var dmax = p.len * pr, segs = 24;
      for (var i = 0; i < segs; i++) {
        var d0 = p.len * i / segs, d1 = Math.min(dmax, p.len * (i + 1) / segs);
        if (d0 >= dmax) break;
        var c = mix(p.c0, p.c1, (i + 0.5) / segs);
        ctx.strokeStyle = rgba(c, 0.9); ctx.lineWidth = 3;
        ctx.beginPath();
        polyAt(p.pts, p.cum, d0, tmp); ctx.moveTo(tmp[0], tmp[1]);
        // include polyline vertices inside the interval
        for (var v = 1; v < p.pts.length; v++) if (p.cum[v] > d0 && p.cum[v] < d1) ctx.lineTo(p.pts[v][0], p.pts[v][1]);
        polyAt(p.pts, p.cum, d1, tmp); ctx.lineTo(tmp[0], tmp[1]);
        ctx.stroke();
      }
    });
    // flow dots (hidden under the equipment drawn afterwards)
    var flow = clamp01((t - 2.6) / 0.6);
    if (flow > 0) {
      CRYO_PIPES.forEach(function (p, pi) {
        var gap = 22, speed = 34 + pi * 3, off = (t * speed) % gap;
        for (var d = off; d < p.len; d += gap) {
          polyAt(p.pts, p.cum, d, tmp);
          var c = mix(p.c0, p.c1, d / p.len);
          ctx.fillStyle = rgba(mix(c, [255, 255, 255], 0.25), flow);
          ctx.beginPath(); ctx.arc(tmp[0], tmp[1], 3.3, 0, TAU); ctx.fill();
        }
      });
    }
    // junction dots
    if (t > 2.4) {
      ctx.fillStyle = '#c9707d';
      [[265, 112], [359, 164]].forEach(function (j) { ctx.beginPath(); ctx.arc(j[0], j[1], 3.6, 0, TAU); ctx.fill(); });
    }
    var stroke = '#d0606f';
    function comp(delay, cx, cy, drawFn) {
      var s = pop(delay);
      if (s <= 0) return;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = stroke; ctx.lineWidth = 1.8;
      drawFn();
      ctx.restore();
    }
    // compressor
    comp(0.1, 70, 250, function () {
      ctx.beginPath(); ctx.arc(0, 0, 29, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-20, -18); ctx.lineTo(22, -8); ctx.moveTo(-20, 18); ctx.lineTo(22, 8); ctx.stroke();
      ctx.save(); ctx.rotate(t * 2.2); ctx.strokeStyle = '#f2b6be';
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU * 0.75); ctx.stroke(); ctx.restore();
    });
    // buffer / oil separator
    comp(0.22, 70, 92, function () {
      roundRect(ctx, -17, -42, 34, 84, 17); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#f2c3c9'; ctx.beginPath(); ctx.moveTo(-17, 14); ctx.lineTo(17, 14); ctx.stroke();
    });
    // heat exchangers
    [[218, 0.5], [312, 0.62], [406, 0.74]].forEach(function (hx) {
      comp(hx[1], hx[0], 138, function () {
        roundRect(ctx, -32, -48, 64, 96, 6); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#efaab3'; ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (var i = 0; i <= 8; i++) { var x = -24 + i * 6, y = i % 2 ? -36 : 36; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-32, -26); ctx.lineTo(32, -26); ctx.moveTo(-32, 26); ctx.lineTo(32, 26); ctx.strokeStyle = '#f6d3d8'; ctx.stroke();
      });
    });
    // turbines (expanders: widen in the flow direction)
    [[300, 0.9], [342, 1.0]].forEach(function (tb) {
      comp(tb[1], tb[0], 250, function () {
        ctx.beginPath(); ctx.moveTo(-16, -9); ctx.lineTo(16, -17); ctx.lineTo(16, 17); ctx.lineTo(-16, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.save(); ctx.rotate(-t * 4); ctx.strokeStyle = '#f2b6be'; ctx.lineWidth = 1.4;
        for (var i = 0; i < 3; i++) { ctx.rotate(TAU / 3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 7); ctx.stroke(); }
        ctx.restore();
      });
    });
    // Joule–Thomson valve
    comp(1.1, 462, 112, function () {
      ctx.beginPath(); ctx.moveTo(-12, -9); ctx.lineTo(12, 9); ctx.lineTo(12, -9); ctx.lineTo(-12, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -16); ctx.moveTo(-7, -16); ctx.lineTo(7, -16); ctx.stroke();
    });
    // cryostat with helium bath and magnet
    comp(1.2, 596, 196, function () {
      roundRect(ctx, -56, -126, 112, 252, 18); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#efb0b8'; roundRect(ctx, -40, -96, 80, 206, 12); ctx.stroke();
      var lvl = 2 + 3 * Math.sin(t * 1.3);
      ctx.save(); roundRect(ctx, -40, -96, 80, 206, 12); ctx.clip();
      ctx.fillStyle = 'rgba(205,226,252,.75)';
      ctx.beginPath(); ctx.moveTo(-40, 110);
      for (var x = -40; x <= 40; x += 4) ctx.lineTo(x, lvl + 2 * Math.sin(x * 0.18 + t * 2.4));
      ctx.lineTo(40, 110); ctx.closePath(); ctx.fill();
      // bubbles
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      for (var bI = 0; bI < 6; bI++) {
        var bp = frac(t * 0.35 + bI / 6), bx = -24 + bI * 9.5, by = 96 - bp * (96 - lvl);
        ctx.beginPath(); ctx.arc(bx + 2 * Math.sin(t * 3 + bI), by, 1.8, 0, TAU); ctx.fill();
      }
      ctx.restore();
      // magnet (racetrack section) inside the bath
      ctx.strokeStyle = '#E50019'; ctx.lineWidth = 2; ctx.fillStyle = '#fde4e7';
      roundRect(ctx, -26, 44, 52, 24, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; roundRect(ctx, -15, 51, 30, 10, 5); ctx.fill(); ctx.stroke();
    });
    // pressure gauges
    [[96, 24, 1.3], [492, 164, 1.5]].forEach(function (gg, gi) {
      comp(gg[2], gg[0], gg[1], function () {
        ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill(); ctx.stroke();
        var a = -2.2 + 1.2 * (0.5 + 0.5 * Math.sin(t * (1.1 + gi * 0.4) + gi));
        ctx.strokeStyle = '#E50019'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(6.5 * Math.cos(a), 6.5 * Math.sin(a)); ctx.stroke();
      });
    });
    ctx.restore();
  };
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ========================================================== windows */
  var WINDOWS = [
    { title: 'cst · opera · rat', status: 'magnetic simulation ongoing', Scene: SceneMagnetic, menu: [30, 34, 28, 42, 36] },
    { title: 'ansys · cast3m', status: 'mechanics simulation ongoing', Scene: SceneMechanics, menu: [34, 26, 40, 30, 44, 24] },
    { title: 'conductor design', status: 'conductor simulation ongoing', Scene: SceneConductor, menu: [28, 38, 30, 34] },
    { title: 'quench design', status: 'quench simulation ongoing', Scene: SceneQuench, menu: [36, 28, 34, 40, 26] },
    { title: 'cryogenics design', status: 'cryogenics simulation ongoing', Scene: SceneCryo, menu: [30, 40, 26, 36, 32] },
    { title: 'nx · catia', status: 'cad ongoing', Scene: SceneCAD, menu: [26, 34, 30, 38, 28, 34, 30] }
  ];
  var WW = 700, WH = 480;            // default window size (px, before perspective)
  var PERSP = 1900;                  // CSS perspective (px)

  var CSS = [
    '.md-root{position:absolute;inset:0;perspective:' + PERSP + 'px;pointer-events:none;font-family:Poppins,system-ui,sans-serif}',
    '.md-win{position:absolute;left:0;top:0;display:flex;flex-direction:column;background:#fff;',
    'border:1.5px solid #f2c6cc;border-radius:12px;box-sizing:border-box;transform-origin:50% 50%;opacity:0;',
    'box-shadow:0 40px 70px -30px rgba(150,0,20,.30),0 12px 26px -14px rgba(150,0,20,.20);will-change:transform,opacity;backface-visibility:hidden}',
    '.md-win::after{content:"";position:absolute;inset:0;border-radius:inherit;background:#fff;opacity:var(--dim,0);pointer-events:none}',
    '.md-tb{height:38px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 12px 0 16px;border-radius:10.5px 10.5px 0 0;',
    'background:linear-gradient(#fff8f9,#fdeff1);border-bottom:1px solid #f6d6db;font:500 15px/1 ui-monospace,"SF Mono",Menlo,Consolas,"DejaVu Sans Mono",monospace;color:#a83b4a;letter-spacing:.02em;white-space:nowrap}',
    '.md-win.md-hub .md-tb{background:linear-gradient(#ffeef0,#fbd9de);color:#c0001a;font-weight:600}',
    '.md-win.md-hub{border-color:#ee9aa6;box-shadow:0 40px 80px -30px rgba(200,0,30,.40),0 0 0 4px rgba(229,0,25,.06)}',
    '.md-ctrl{display:flex;gap:7px}',
    '.md-ctrl i{width:13px;height:13px;border:1.5px solid #eba9b2;border-radius:3px;display:block;position:relative;box-sizing:border-box}',
    '.md-ctrl i:nth-child(1)::after{content:"";position:absolute;left:2px;right:2px;bottom:2px;height:1.5px;background:#eba9b2}',
    '.md-ctrl i:nth-child(2)::after{content:"";position:absolute;left:2px;top:2px;right:2px;bottom:2px;border:1.2px solid #eba9b2}',
    '.md-ctrl i:nth-child(3){background:#f6b5be;border-color:#f19ca8}',
    '.md-ctrl i:nth-child(3)::before,.md-ctrl i:nth-child(3)::after{content:"";position:absolute;left:1.5px;right:1.5px;top:4.3px;height:1.5px;background:#fff;transform:rotate(45deg)}',
    '.md-ctrl i:nth-child(3)::after{transform:rotate(-45deg)}',
    '.md-mb{height:30px;flex:none;display:flex;align-items:center;gap:15px;padding:0 16px;border-bottom:1px solid #faeaec}',
    '.md-mb i{height:7px;border-radius:4px;background:#f4e0e3;display:block}',
    '.md-body{position:relative;flex:1;min-height:0}',
    '.md-body canvas{position:absolute;left:0;top:0;width:calc(100% - 16px);height:100%;display:block}',
    '.md-sb{position:absolute;right:5px;top:8px;bottom:8px;width:6px;border-radius:3px;background:#fcf0f2}',
    '.md-sb b{position:absolute;left:0;right:0;top:6%;height:30%;border-radius:3px;background:#f3bfc6;display:block}',
    '.md-st{height:40px;flex:none;display:flex;align-items:center;gap:7px;padding:0 18px;border-top:1px solid #f9e4e7;',
    'font:400 15px/1 ui-monospace,"SF Mono",Menlo,Consolas,"DejaVu Sans Mono",monospace;color:#b5525f;letter-spacing:.02em;white-space:nowrap}',
    '.md-caret{width:8px;height:15px;background:#ef909c;display:inline-block;animation:md-blink 1.05s steps(1) infinite}',
    '@keyframes md-blink{50%{opacity:0}}',
    '.md-arrows{position:absolute;inset:0;overflow:visible;z-index:60;pointer-events:none}',
    /* .md-big: larger chrome for windows shown at small scale (stays legible) */
    '.md-big{border-width:2.5px;border-radius:16px}',
    '.md-big .md-tb{height:58px;font-size:27px;padding:0 18px 0 24px}',
    '.md-big .md-ctrl{gap:10px}.md-big .md-ctrl i{width:20px;height:20px;border-width:2px;border-radius:4px}',
    '.md-big .md-ctrl i:nth-child(1)::after{left:3px;right:3px;bottom:3px;height:2px}',
    '.md-big .md-ctrl i:nth-child(2)::after{left:3px;top:3px;right:3px;bottom:3px;border-width:2px}',
    '.md-big .md-ctrl i:nth-child(3)::before,.md-big .md-ctrl i:nth-child(3)::after{left:2px;right:2px;top:7px;height:2.4px}',
    '.md-big .md-mb{height:40px;gap:20px;padding:0 24px}.md-big .md-mb i{height:11px;border-radius:6px}',
    '.md-big .md-st{height:58px;font-size:25px;padding:0 24px}.md-big .md-caret{width:13px;height:25px}',
    '.md-big .md-body canvas{width:calc(100% - 22px)}.md-big .md-sb{width:9px;right:7px}.md-big .md-tb{border-radius:13.5px 13.5px 0 0}',
    /* lighter rendering when Deck.quality steps down (slow computers) */
    '.deck-q-medium .md-win{box-shadow:0 22px 34px -20px rgba(150,0,20,.30)}',
    '.deck-q-low .md-win{box-shadow:none}.deck-q-low .md-caret{animation:none}'
  ].join('\n');
  function injectCSS() {
    if (document.getElementById('md-style')) return;
    var s = document.createElement('style');
    s.id = 'md-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  // frame rate / resolution settings shared with the deck (deck.js), when present
  function QUALITY() { return window.Deck && window.Deck.quality; }
  function TICKER() { return window.Deck && window.Deck.ticker; }
  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /**
   * Stage — a set of tilted windows animated between "stages" (key presses).
   * cfg: {
   *   windows: [{ title, status, Scene, menu, hub }],
   *   steps,                         // presses consumed (stages = steps + 1)
   *   layout(stage) -> [target|null] // one entry per window: {x,y,z,ry,rx,s,o,dim} (this = Stage)
   *   links: [{ a, b, type: 'blocked'|'flow'|'hub', from: stage, dv }],
   *   origin: [fx, fy], ww, wh, gapMin, overlapLen,
   *   appearFrom(target, i), appearDelay(i, n, instant), linkDelay(link, instant), every(i, stage)
   * }
   */
  function Stage(el, api, cfg) {
    injectCSS();
    this.el = el; this.api = api || {}; this.cfg = cfg;
    if (window.getComputedStyle(el).position === 'static') el.style.position = 'relative';
    var root = this.root = document.createElement('div');
    root.className = 'md-root';
    el.appendChild(root);
    this.W = el.clientWidth || 1920; this.H = el.clientHeight || 800;
    var o = cfg.origin || [0.52, 0.44];
    this.ox = this.W * o[0]; this.oy = this.H * o[1];
    root.style.perspectiveOrigin = this.ox + 'px ' + this.oy + 'px';
    this.ww = cfg.ww || WW; this.wh = cfg.wh || WH;
    this.maxStage = cfg.maxStage != null ? cfg.maxStage : (cfg.steps || 0);
    var self = this;
    this.wins = cfg.windows.map(function (c, i) { return self.buildWindow(c, i); });
    this.svg = svgEl('svg', { class: 'md-arrows', width: this.W, height: this.H, viewBox: '0 0 ' + this.W + ' ' + this.H });
    root.appendChild(this.svg);
    this.links = (cfg.links || []).map(function (l, i) { return self.buildLink(l, i); });
    this.stage = -1; this.running = false; this.frame = 0;
    this.loop = this.loop.bind(this);
    if (QUALITY()) QUALITY().onChange(function () { if (self.running) self.resize(); });
  }

  Stage.prototype.buildWindow = function (cfg, i) {
    var w = document.createElement('div');
    w.className = 'md-win' + (cfg.hub ? ' md-hub' : '') + (this.cfg.cls ? ' ' + this.cfg.cls : '');
    var ww = cfg.ww || this.ww, wh = cfg.wh || this.wh;  // a window may have its own size
    w.style.width = ww + 'px'; w.style.height = wh + 'px';
    w.style.zIndex = String(10 + (cfg.z != null ? cfg.z : i));
    w.style.display = 'none';
    w.innerHTML =
      '<div class="md-tb"><span class="md-title"></span><span class="md-ctrl"><i></i><i></i><i></i></span></div>' +
      '<div class="md-mb">' + (cfg.menu || [30, 34, 28, 40]).map(function (x) { return '<i style="width:' + x + 'px"></i>'; }).join('') + '</div>' +
      '<div class="md-body"><canvas></canvas><div class="md-sb"><b></b></div></div>' +
      '<div class="md-st"><span class="md-status"></span><span class="md-caret"></span></div>';
    w.querySelector('.md-title').textContent = cfg.title;
    w.querySelector('.md-status').textContent = cfg.status || '';
    if (!cfg.status) w.querySelector('.md-caret').style.display = 'none';
    this.root.appendChild(w);
    var canvas = w.querySelector('canvas'), bg = null;
    if (cfg.Scene.prototype.drawBg) { // static part of the picture: painted once, underneath
      bg = document.createElement('canvas');
      canvas.parentNode.insertBefore(bg, canvas);
    }
    return {
      i: i, el: w, canvas: canvas, ctx: canvas.getContext('2d'), scene: null, cfg: cfg, thumb: w.querySelector('.md-sb b'), thumbY: -1,
      bg: bg, bgctx: bg && bg.getContext('2d'), ww: ww, wh: wh,
      visible: false, hiding: false, cur: null, from: null, to: null, t0: 0, dur: 1000, t0Scene: 0,
      cssW: 0, cssH: 0, k: 0
    };
  };

  Stage.prototype.buildLink = function (def, i) {
    var g = svgEl('g', { opacity: 0 }, this.svg);
    var a = { i: i, def: def, g: g, visible: false, t0: 0, hideT: 0 };
    if (def.type === 'hub') {
      a.path = svgEl('path', { fill: 'none', stroke: '#E50019', 'stroke-width': 3.2, 'stroke-linecap': 'round', opacity: 0.85 }, g);
      a.headA = svgEl('path', { fill: '#E50019' }, g);
      a.headB = svgEl('path', { fill: '#E50019' }, g);
      a.pulses = [0, 1, 2].map(function (k) { return svgEl('circle', { r: k === 2 ? 4 : 5, fill: k === 2 ? '#ff9aa6' : '#E50019', opacity: 0 }, g); });
      return a;
    }
    a.halo = svgEl('path', { stroke: '#fff', 'stroke-width': 13, 'stroke-linecap': 'round', fill: 'none', opacity: 0.9 }, g);
    if (def.type === 'blocked') a.ghost = svgEl('line', { stroke: '#f3a5af', 'stroke-width': 2.6, 'stroke-dasharray': '0.5 8', 'stroke-linecap': 'round' }, g);
    a.shaft = svgEl('line', { stroke: '#E50019', 'stroke-width': 4.6, 'stroke-linecap': 'round' }, g);
    a.head = svgEl('path', { fill: '#E50019' }, g);
    if (def.type === 'blocked') {
      a.wall = svgEl('rect', { fill: '#b40014', rx: 3, width: 7, height: 50 }, g);
      a.pulse = svgEl('circle', { r: 4.5, fill: '#ff8796', opacity: 0 }, g);
      a.nogo = svgEl('g', {}, g);
      svgEl('circle', { r: 11, fill: '#fff', stroke: '#b40014', 'stroke-width': 3 }, a.nogo);
      svgEl('line', { x1: -7.2, y1: 7.2, x2: 7.2, y2: -7.2, stroke: '#b40014', 'stroke-width': 3, 'stroke-linecap': 'round' }, a.nogo);
    } else {
      a.pulses = [0, 1, 2].map(function () { return svgEl('circle', { r: 4.5, fill: '#ff5c70', opacity: 0 }, g); });
    }
    return a;
  };

  function appearFrom(t) { return { x: t.x + 140, y: t.y + 26, z: t.z - 220, ry: t.ry + 18, rx: t.rx, s: t.s * 0.92, o: 0, dim: t.dim }; }
  function copyState(s) { return { x: s.x, y: s.y, z: s.z, ry: s.ry, rx: s.rx, s: s.s, o: s.o, dim: s.dim }; }

  Stage.prototype.tween = function (w, to, now, dur, delay) {
    w.from = copyState(w.cur); w.to = to; w.t0 = now + (delay || 0) * 1000; w.dur = dur * 1000;
  };

  Stage.prototype.measure = function (w, s) {
    var cw = w.canvas.offsetWidth, ch = w.canvas.offsetHeight;
    if (!cw || !ch) return;
    if (s == null) s = w.to ? w.to.s : (w.cur ? w.cur.s : 1);
    var Q = QUALITY(), kMax = Math.min(this.cfg.maxK || 1.5, Q ? Q.kMax : 1.5), kMin = Q ? Q.kMin : 0.7;
    var k = Math.min(kMax, Math.max(kMin, (window.devicePixelRatio || 1) * (this.api.scale || 1) * Math.max(0.5, s) * 1.08));
    if (s >= 0.85) k = Math.max(Math.min(1, kMax), k);
    if (cw === w.cssW && ch === w.cssH && Math.abs(k - w.k) < 0.05) return false;
    w.cssW = cw; w.cssH = ch; w.k = k; w.drawn = false; w.cleared = false; w.bgDirty = true;
    w.canvas.width = Math.round(cw * k); w.canvas.height = Math.round(ch * k);
    if (w.bg) { w.bg.width = w.canvas.width; w.bg.height = w.canvas.height; }
    return true;
  };

  Stage.prototype.setStage = function (stage, instant) {
    var cfg = this.cfg;
    stage = Math.max(0, Math.min(this.maxStage, stage | 0));
    var now = performance.now(), T = cfg.layout.call(this, stage), self = this;
    var from = cfg.appearFrom || appearFrom;
    this.stage = stage;
    var newCount = 0;
    this.wins.forEach(function (w, i) {
      var tg = T[i];
      if (tg) {
        if (!w.visible || w.hiding) {
          var fresh = !w.visible;
          w.visible = true; w.hiding = false;
          w.el.style.display = '';
          self.measure(w, tg.s);
          if (!w.scene) w.scene = new w.cfg.Scene();
          var delay = cfg.appearDelay ? cfg.appearDelay(i, newCount, instant) : (instant ? 0.1 + newCount * 0.09 : 0.18);
          if (fresh) { w.cur = from(tg, i); w.t0Scene = now + (delay + 0.3) * 1000; w.dirty = true; }
          self.tween(w, tg, now, 1.15, delay);
          newCount++;
        } else {
          self.tween(w, tg, now, 1.05, 0);
        }
      } else if (w.visible && !w.hiding) {
        w.hiding = true;
        self.tween(w, from(w.cur, i), now, 0.55, 0);
      }
    });
    if (cfg.onStage) cfg.onStage(this, stage, instant);
    this.links.forEach(function (a) {
      var want = stage >= (a.def.from || 0);
      if (want && !a.visible) {
        a.visible = true; a.hideT = 0;
        a.t0 = now + (cfg.linkDelay ? cfg.linkDelay(a, instant) : (instant ? 0.35 + a.i * 0.09 : 0.75)) * 1000;
      } else if (!want && a.visible) { a.visible = false; a.hideT = now; }
    });
    this.start();
  };

  /* project a point given in window-local coordinates (relative to its centre) */
  Stage.prototype.projWin = function (st, du, dv, out) {
    var x = du * st.s, y = dv * st.s, z = 0;
    var ca = Math.cos(st.rx * DEG), sa = Math.sin(st.rx * DEG);
    var y2 = y * ca - z * sa, z2 = y * sa + z * ca;
    var cb = Math.cos(st.ry * DEG), sb = Math.sin(st.ry * DEG);
    var x3 = x * cb + z2 * sb, z3 = -x * sb + z2 * cb;
    var X = st.x + x3, Y = st.y + y2, Z = st.z + z3, k = PERSP / (PERSP - Z);
    out[0] = this.ox + (X - this.ox) * k; out[1] = this.oy + (Y - this.oy) * k;
    return out;
  };

  // set an SVG attribute only when its value really changes: unchanged arrows are not repainted
  function sa(el, name, v) {
    var c = el._sa || (el._sa = {});
    v = String(v);
    if (c[name] !== v) { c[name] = v; el.setAttribute(name, v); }
  }
  function headPath(x, y, ang, s) {
    var a1 = ang + 2.62, a2 = ang - 2.62;
    return 'M' + x.toFixed(1) + ',' + y.toFixed(1) + ' L' + (x + s * Math.cos(a1)).toFixed(1) + ',' + (y + s * Math.sin(a1)).toFixed(1) +
      ' L' + (x + s * Math.cos(a2)).toFixed(1) + ',' + (y + s * Math.sin(a2)).toFixed(1) + 'Z';
  }

  Stage.prototype.updateLinks = function (now) {
    var self = this, pA = [0, 0], pB = [0, 0], cfg = this.cfg;
    this.links.forEach(function (a) {
      var A = self.wins[a.def.a], B = self.wins[a.def.b], alpha = 1;
      if (!a.visible) {
        if (!a.hideT) { sa(a.g, 'opacity', 0); return; }
        alpha = 1 - (now - a.hideT) / 300;
        if (alpha <= 0) { a.hideT = 0; sa(a.g, 'opacity', 0); return; }
      }
      if (!A.cur || !B.cur) { sa(a.g, 'opacity', 0); return; }
      var tt = (now - a.t0) / 1000;
      if (tt < 0) { sa(a.g, 'opacity', 0); return; }

      if (a.def.type === 'hub') {
        var side = A.cur.x < B.cur.x ? 1 : -1;
        self.projWin(A.cur, side * A.ww / 2, 0, pA);
        self.projWin(B.cur, -side * B.ww / 2, a.def.dv || 0, pB);
        var x0 = pA[0] + side * 10, y0 = pA[1], x3 = pB[0] - side * 10, y3 = pB[1], dx = (x3 - x0) * 0.55;
        var x1 = x0 + dx, x2 = x3 - dx;
        var bez = function (t, o) {
          var u = 1 - t;
          o[0] = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
          o[1] = u * u * u * y0 + 3 * u * u * t * y0 + 3 * u * t * t * y3 + t * t * t * y3;
          return o;
        };
        var len = Math.hypot(x3 - x0, y3 - y0) * 1.12, grow = easeInOut(tt / 0.8);
        sa(a.g, 'opacity', (alpha * clamp01(tt / 0.1)).toFixed(3));
        sa(a.path, 'd', 'M' + x0.toFixed(1) + ',' + y0.toFixed(1) + ' C' + x1.toFixed(1) + ',' + y0.toFixed(1) + ' ' + x2.toFixed(1) + ',' + y3.toFixed(1) + ' ' + x3.toFixed(1) + ',' + y3.toFixed(1));
        sa(a.path, 'stroke-dasharray', len.toFixed(1));
        sa(a.path, 'stroke-dashoffset', (len * (1 - grow)).toFixed(1));
        var hp = grow >= 1 ? backOut((tt - 0.8) * 3) : 0, q = [0, 0];
        sa(a.headB, 'd', hp > 0 ? headPath(x3 + side * 2, y3, side > 0 ? 0 : Math.PI, 13 * hp) : '');
        sa(a.headA, 'd', hp > 0 ? headPath(x0 - side * 2, y0, side > 0 ? Math.PI : 0, 11 * hp) : '');
        a.pulses.forEach(function (c, k) {
          if (tt < 1.1) { sa(c, 'opacity', 0); return; }
          var period = 2.4, ph = frac((tt - 1.1) / period + k * 0.37 + a.i * 0.13);
          var t = k === 2 ? 1 - ph : ph; // two pulses travel into ALESIA, one comes back out
          bez(t, q);
          sa(c, 'cx', q[0].toFixed(1)); sa(c, 'cy', q[1].toFixed(1));
          sa(c, 'opacity', (Math.sin(Math.PI * ph) * 0.95).toFixed(3));
        });
        return;
      }

      // chain links between consecutive windows
      self.projWin(A.cur, A.ww / 2, 0, pA);
      self.projWin(B.cur, -B.ww / 2, 0, pB);
      var gap = pB[0] - pA[0], y = pB[1], sx, ex, sc, gmin = cfg.gapMin || 96, olen = cfg.overlapLen || 92;
      if (gap > gmin) { sx = pA[0] + 20; ex = pB[0] - 20; sc = 1; }
      else { ex = pB[0] - 14; sx = ex - olen; sc = 0.78; }
      if (cfg.linkScale) sc *= cfg.linkScale;
      var L = (ex - sx) / sc;
      sa(a.g, 'transform', 'translate(' + sx.toFixed(1) + ',' + y.toFixed(1) + ') scale(' + sc.toFixed(3) + ')');
      sa(a.halo, 'd', gap <= gmin ? 'M0,0 L' + L.toFixed(1) + ',0' : 'M0,0');
      sa(a.shaft, 'x1', 0); sa(a.shaft, 'y1', 0); sa(a.shaft, 'y2', 0);

      if (a.def.type === 'flow') {
        var gr = easeOut(tt / 0.55), tipF = L * gr;
        sa(a.g, 'opacity', (alpha * clamp01(tt / 0.15) * (gap <= gmin ? 0.85 : 1)).toFixed(3));
        sa(a.shaft, 'x2', Math.max(0, tipF - 12).toFixed(1));
        sa(a.head, 'd', tipF > 4 ? 'M' + tipF.toFixed(1) + ',0 l-16,-9 l0,18 z' : '');
        a.pulses.forEach(function (c, k) {
          if (tt < 0.6) { sa(c, 'opacity', 0); return; }
          var ph = frac((tt - 0.6) / 1.6 + k / 3);
          sa(c, 'cx', (ph * (L - 18)).toFixed(1)); sa(c, 'cy', 0);
          sa(c, 'opacity', (Math.sin(Math.PI * ph) * 0.95).toFixed(3));
        });
        return;
      }

      var xw = L * 0.62;
      var grow2 = easeOut(tt / 0.55), hit = tt - 0.55;
      var recoil = hit > 0 ? -9 * Math.exp(-hit * 6) * Math.sin(hit * 22) : 0;
      var tip = Math.max(0, (xw - 9) * grow2 + recoil);
      sa(a.g, 'opacity', (alpha * clamp01(tt / 0.15) * (gap <= gmin ? 0.8 : 1)).toFixed(3));
      sa(a.shaft, 'x2', Math.max(0, tip - 10).toFixed(1));
      sa(a.head, 'd', tip > 4 ? 'M' + tip.toFixed(1) + ',0 l-16,-9 l0,18 z' : '');
      var wp = hit > 0 ? backOut(hit * 3.2) : 0, shake = hit > 0 ? 3 * Math.exp(-hit * 5) * Math.sin(hit * 40) : 0;
      sa(a.wall, 'x', (xw - 3.5 + shake).toFixed(1));
      sa(a.wall, 'y', (-25 * wp).toFixed(1));
      sa(a.wall, 'height', (50 * wp).toFixed(1));
      sa(a.ghost, 'x1', (xw + 12).toFixed(1)); sa(a.ghost, 'x2', (xw + 12 + (L - xw - 12) * clamp01(hit / 0.5)).toFixed(1));
      sa(a.ghost, 'y1', 0); sa(a.ghost, 'y2', 0);
      var np = hit > 0.08 ? backOut((hit - 0.08) * 3) : 0;
      sa(a.nogo, 'transform', 'translate(' + (xw + shake).toFixed(1) + ',-44) scale(' + np.toFixed(3) + ')');
      if (hit > 1) { // periodic "retry" pulse that dies against the wall
        var ph2 = ((hit - 1) % 2.8) / 2.8, px = ph2 < 0.4 ? (ph2 / 0.4) * (xw - 14) : xw - 14;
        var po = ph2 < 0.4 ? 0.9 : Math.max(0, 0.9 - (ph2 - 0.4) * 6);
        sa(a.pulse, 'cx', px.toFixed(1)); sa(a.pulse, 'cy', 0);
        sa(a.pulse, 'opacity', po.toFixed(3));
        sa(a.pulse, 'r', (4.5 + (ph2 >= 0.4 ? (ph2 - 0.4) * 30 : 0)).toFixed(2));
        sa(a.wall, 'fill', ph2 >= 0.4 && ph2 < 0.5 ? '#ff2a45' : '#b40014');
      } else sa(a.pulse, 'opacity', 0);
    });
  };

  Stage.prototype.applyWin = function (w) {
    var s = w.cur;
    w.el.style.transform = 'translate3d(' + (s.x - w.ww / 2).toFixed(2) + 'px,' + (s.y - w.wh / 2).toFixed(2) + 'px,' + s.z.toFixed(2) + 'px) rotateY(' + s.ry.toFixed(3) + 'deg) rotateX(' + s.rx.toFixed(3) + 'deg) scale(' + s.s.toFixed(4) + ')';
    w.el.style.opacity = s.o.toFixed(3);
    w.el.style.setProperty('--dim', s.dim.toFixed(3));
  };

  Stage.prototype.renderWin = function (w, now) {
    if (!w.cssW) this.measure(w);
    if (!w.cssW) return;
    var ctx = w.ctx, t = (now - w.t0Scene) / 1000;
    if (w.bg && w.bgDirty && w.scene) {
      w.bgDirty = false;
      w.bgctx.setTransform(w.k, 0, 0, w.k, 0, 0);
      w.bgctx.clearRect(0, 0, w.cssW, w.cssH);
      try { w.scene.drawBg(w.bgctx, w.cssW, w.cssH); } catch (e) { console.error('[magnet-design]', e); }
    }
    if (t < 0 && w.cleared) return;
    ctx.setTransform(w.k, 0, 0, w.k, 0, 0);
    ctx.clearRect(0, 0, w.cssW, w.cssH);
    w.cleared = true;
    if (t < 0) return;
    if (w.bg && document.body.classList.contains('deck-printing')) { // PDF export drops a canvas stacked under another: flatten
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(w.bg, 0, 0); ctx.setTransform(w.k, 0, 0, w.k, 0, 0);
    }
    try { w.scene.draw(ctx, w.cssW, w.cssH, t); }
    catch (e) { if (!w.err) { console.error('[magnet-design]', e); w.err = true; } }
    w.drawn = true;
    var Q = QUALITY();
    if (w.thumb && !(Q && Q.level >= 2)) { // slow up-and-down scroll of the cosmetic scrollbar
      var ph = (t / 9 + w.i * 0.19) % 2, e = ph > 1 ? 2 - ph : ph;
      var y = Math.round(e * e * (3 - 2 * e) * 372) / 2;
      if (y !== w.thumbY) { w.thumbY = y; w.thumb.style.transform = 'translateY(' + y + '%)'; }
    }
  };

  Stage.prototype.loop = function (now) {   // standalone use (no deck.js): own loop at 30 fps
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    if (now - (this.lastT || 0) < 1000 / (this.cfg.fps || 30) - 4) return;
    this.lastT = now;
    this.tick(now);
  };
  Stage.prototype.onTicker = function (now) { // with deck.js: the shared ticker sets the frame rate
    if (!this.running) return;
    if (this.cfg.fps && now - (this.lastT || 0) < 1000 / this.cfg.fps - 4) return;
    this.lastT = now;
    this.tick(now);
  };
  Stage.prototype.tick = function (now) {
    var self = this, cfg = this.cfg;
    if (this.autoOn) this.autoStep(now);
    this.wins.forEach(function (w) {
      if (!w.visible && !w.hiding) return;
      if (w.to) {
        var u = (now - w.t0) / w.dur;
        if (u >= 0) {
          var e = easeOutQ(u);
          for (var k in w.to) w.cur[k] = lerp(w.from[k], w.to[k], e);
          if (u >= 1) {
            w.to = null;
            if (w.hiding) { w.hiding = false; w.visible = false; w.el.style.display = 'none'; w.cur = null; self.freeCanvas(w); return; }
          }
        }
        self.applyWin(w);
      } else if (w.dirty) { self.applyWin(w); }
      w.dirty = false;
    });
    this.updateLinks(now);
    if (cfg.onTick) cfg.onTick(this, now);
    this.frame++;
    var Q = QUALITY(), slow = Q ? Q.slow : 1, fps = Q ? Q.fps : (cfg.fps || 30);
    this.wins.forEach(function (w, i) {
      if (!w.visible) return;
      // full frame rate for the main window, less for the others (smaller or mostly hidden);
      // text-like scenes declare a lower rate of their own (scene.fps)
      var every = cfg.every ? cfg.every(i, self.stage) : (i === self.stage ? 1 : i === self.stage - 1 ? 3 : 10);
      if (every > 1) every = Math.round(every * slow);
      if (w.scene && w.scene.fps) every = Math.max(every, Math.round(fps / w.scene.fps));
      if (!w.drawn || (self.frame + i) % every === 0) self.renderWin(w, now);
    });
  };

  /* auto-play: build every stage on a timer, hold, fade out, start again (forever) */
  Stage.prototype.startAuto = function () {
    this.autoOn = true; this.autoPhase = 'build'; this.autoT0 = performance.now();
    this.stage = -1;
    this.setStage(0, false);
  };
  Stage.prototype.autoStep = function (now) {
    var a = this.cfg.auto, el = (now - this.autoT0) / 1000;
    if (this.autoPhase === 'build') {
      var want = Math.min(this.maxStage, Math.floor(el / a.interval));
      if (want > this.stage) this.setStage(want, false);
      if (el > this.maxStage * a.interval + a.hold) { this.hideAll(now); this.autoPhase = 'out'; this.autoT0 = now; }
    } else if (el > a.out) {
      this.autoPhase = 'build'; this.autoT0 = now; this.stage = -1;
      this.setStage(0, false);
    }
  };
  Stage.prototype.hideAll = function (now) {
    var self = this, from = this.cfg.appearFrom || appearFrom;
    this.wins.forEach(function (w, i) {
      if (w.visible && !w.hiding) { w.hiding = true; self.tween(w, from(w.cur, i), now, 0.9, i * 0.05); }
    });
    this.links.forEach(function (a) { if (a.visible) { a.visible = false; a.hideT = now; } });
  };

  Stage.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    var T = TICKER();
    if (T) { this._tk = this._tk || this.onTicker.bind(this); T.add(this._tk); }
    else this.raf = requestAnimationFrame(this.loop);
  };
  Stage.prototype.stop = function () {
    this.running = false;
    var T = TICKER();
    if (T && this._tk) T.remove(this._tk);
    cancelAnimationFrame(this.raf);
  };
  Stage.prototype.freeCanvas = function (w) {
    w.canvas.width = 1; w.canvas.height = 1; w.cssW = 0; w.cssH = 0; w.k = 0; w.drawn = false; w.cleared = false;
    if (w.bg) { w.bg.width = 1; w.bg.height = 1; }
  };
  Stage.prototype.reset = function () {
    var self = this;
    this.stop();
    this.autoOn = false;
    this.stage = -1;
    this.wins.forEach(function (w) { w.visible = false; w.hiding = false; w.to = null; w.cur = null; w.el.style.display = 'none'; w.scene = null; self.freeCanvas(w); });
    this.links.forEach(function (a) { a.visible = false; a.hideT = 0; sa(a.g, 'opacity', 0); });
  };
  Stage.prototype.enter = function () {
    clearTimeout(this.resetTimer);
    geo();
    this.fit();
  };
  // the area may have changed since start-up (e.g. a slide version that was hidden): measure it again
  Stage.prototype.fit = function () {
    var W = this.el.clientWidth, H = this.el.clientHeight;
    if (!W || !H || (W === this.W && H === this.H)) return;
    var o = this.cfg.origin || [0.52, 0.44];
    this.W = W; this.H = H; this.ox = W * o[0]; this.oy = H * o[1];
    this.root.style.perspectiveOrigin = this.ox + 'px ' + this.oy + 'px';
    this.svg.setAttribute('width', W); this.svg.setAttribute('height', H); this.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  };
  Stage.prototype.leave = function () {
    var self = this;
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(function () { self.reset(); }, 700);
  };
  Stage.prototype.resize = function () {
    var self = this, now = performance.now();
    this.wins.forEach(function (w) { if (w.visible && self.measure(w) && w.scene) self.renderWin(w, now); });
  };
  /* render the final state synchronously (print / PDF export) */
  Stage.prototype.finalFrame = function () {
    var now = performance.now(), self = this;
    clearTimeout(this.resetTimer);
    this.autoOn = false;
    this.fit();
    this.setStage(this.maxStage, true);
    this.wins.forEach(function (w) {
      if (w.to) { w.cur = w.to; w.to = null; }
      w.dirty = true; w.drawn = false; w.cleared = false; w.bgDirty = true;
      w.t0Scene = now - (self.cfg.printTime || 9500);
      self.measure(w);
    });
    this.links.forEach(function (a) { a.t0 = now - 2600; });
    this.tick(now);
  };

  function makeWidget(cfg) {
    return {
      steps: cfg.steps || 0,
      mount: function (el, api) {
        var st = new Stage(el, api, cfg);
        el._stage = st;
        if (cfg.onMount) cfg.onMount(st);
        return {
          enter: function () { st.enter(); if (cfg.onEnter) cfg.onEnter(st); },
          leave: function () { st.leave(); if (cfg.onLeave) cfg.onLeave(st); },
          step: function (k, dir) {
            if (cfg.auto) { if (dir === 'jump' || !st.autoOn) st.startAuto(); }
            else st.setStage(k, dir === 'jump');
          },
          resize: function () { st.resize(); },
          print: function () { st.finalFrame(); if (cfg.onPrint) cfg.onPrint(st); }
        };
      }
    };
  }

  /* ============================================ title sequence configuration */
  var MAGNET = {
    windows: WINDOWS,
    steps: 0,                        // no key presses: the sequence plays by itself…
    maxStage: WINDOWS.length - 1,
    auto: { interval: 4.6, hold: 6, out: 1.3 },   // …one window every 4.6 s, hold 6 s, fade, repeat
    origin: [0.52, 0.44],
    layout: function (stage) {
      var cy = this.H * 0.47, W = this.W, out = [];
      for (var i = 0; i < WINDOWS.length; i++) {
        if (i > stage) { out.push(null); continue; }
        if (i === stage) { out.push({ x: W * 0.745, y: cy, z: 0, ry: 13, rx: 2, s: 0.98, o: 1, dim: 0 }); continue; }
        if (stage === 1) { out.push({ x: W * 0.3, y: cy, z: -40, ry: 15, rx: 2, s: 0.96, o: 1, dim: 0.04 }); continue; }
        var k = stage - 1 - i; // 0 = most recent stacked window
        out.push({ x: W * 0.33 - k * 92, y: cy - k * 20, z: -110 - k * 46, ry: 30, rx: 2, s: 0.9 - k * 0.018, o: 1, dim: Math.min(0.42, 0.07 + 0.08 * k) });
      }
      return out;
    },
    links: WINDOWS.slice(1).map(function (_, i) { return { a: i, b: i + 1, type: 'blocked', from: i + 1 }; })
  };

  /* ======================================================== registration */
  window.MDKit = {
    Stage: Stage, makeWidget: makeWidget, WINDOWS: WINDOWS, WW: WW, WH: WH,
    scenes: { SceneMagnetic: SceneMagnetic, SceneMechanics: SceneMechanics, SceneConductor: SceneConductor, SceneQuench: SceneQuench, SceneCryo: SceneCryo, SceneCAD: SceneCAD,
      SceneMagneticSol: withShape(SceneMagnetic, 'solenoid'), SceneMechanicsSol: withShape(SceneMechanics, 'solenoid'), SceneQuenchSol: withShape(SceneQuench, 'solenoid') },
    Cam: Cam, renderCoil: renderCoil, geo: geo, fitCam: fitCam,
    helpers: { clamp01: clamp01, lerp: lerp, easeOut: easeOut, easeInOut: easeInOut, backOut: backOut, hex: hex, rgba: rgba, mix: mix, frac: frac, cmap: cmap, roundRect: roundRect, polyCum: polyCum, polyAt: polyAt }
  };
  window.MagnetDesign = function (el, api) { return new Stage(el, api, MAGNET); };

  if (window.Deck && window.Deck.widget) {
    window.Deck.widget('magnet-design', makeWidget(MAGNET));
  } else {
    // standalone use (no deck.js): drive the stages with the same keys
    var boot = function () {
      Array.prototype.forEach.call(document.querySelectorAll('[data-widget="magnet-design"]'), function (el) {
        var md = new Stage(el, { scale: 1 }, MAGNET);
        geo(); md.startAuto();
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})();
