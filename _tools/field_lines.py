"""Generate img/field-lines.svg: magnetic field lines of an actively shielded solenoid.

The field lines are iso-contours of the flux function psi = r * A_phi(r, z),
computed analytically (elliptic integrals) for a set of axisymmetric current
filaments: a main coil made of several blocks and a counter-wound shielding
coil whose dipole moment cancels the main one.

Usage: python3 _tools/field_lines.py   (writes img/field-lines.svg)
"""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy.special import ellipe, ellipk

OUT = Path(__file__).resolve().parent.parent / "img" / "field-lines.svg"

# ---- Coil geometry (arbitrary units) -----------------------------------------
# Each block: (z_center, r_inner, r_outer, half_length, current_density_sign*weight)
MAIN_R = (0.46, 0.52)
MAIN_BLOCKS = [  # z centre, half length, relative current density
    (0.10, 0.06, 1.00),
    (0.34, 0.07, 1.00),
    (0.62, 0.10, 1.35),
]
SHIELD_R = (0.86, 0.90)
SHIELD_BLOCKS = [(0.52, 0.16, None)]  # current set so the dipole moment cancels


def block_filaments(zc, r_in, r_out, half_len, n_r=5, n_z=10):
    rs = np.linspace(r_in, r_out, n_r)
    zs = np.linspace(zc - half_len, zc + half_len, n_z)
    rr, zz = np.meshgrid(rs, zs)
    return rr.ravel(), zz.ravel()


def build_filaments():
    fil_r, fil_z, fil_i = [], [], []
    moment_main = 0.0
    for zc, hl, j in MAIN_BLOCKS:
        for sgn in (1, -1):
            r, z = block_filaments(sgn * zc, *MAIN_R, hl)
            i = np.full(r.size, j * hl / r.size)
            fil_r.append(r), fil_z.append(z), fil_i.append(i)
            moment_main += np.sum(i * r**2)
    shield_r, shield_z = [], []
    for zc, hl, _ in SHIELD_BLOCKS:
        for sgn in (1, -1):
            r, z = block_filaments(sgn * zc, *SHIELD_R, hl)
            shield_r.append(r), shield_z.append(z)
    shield_r = np.concatenate(shield_r)
    shield_z = np.concatenate(shield_z)
    i_shield = -moment_main / np.sum(shield_r**2)  # zero net dipole moment
    fil_r.append(shield_r), fil_z.append(shield_z)
    fil_i.append(np.full(shield_r.size, i_shield))
    return np.concatenate(fil_r), np.concatenate(fil_z), np.concatenate(fil_i)


def flux(r, z, fr, fz, fi):
    """psi = r * A_phi for a sum of circular filaments (constants dropped)."""
    psi = np.zeros_like(r)
    for a, z0, i in zip(fr, fz, fi):
        dz = z - z0
        m = 4 * a * r / ((a + r) ** 2 + dz**2)
        m = np.clip(m, 1e-12, 1 - 1e-9)
        k = np.sqrt(m)
        a_phi = i / k * np.sqrt(a / r) * ((1 - m / 2) * ellipk(m) - ellipe(m))
        psi += r * a_phi
    return psi


def simplify(pts, tol):
    """Ramer-Douglas-Peucker polyline simplification."""
    pts = np.asarray(pts)
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = b - a
    norm = np.hypot(*ab)
    if norm == 0:
        dist = np.hypot(*(pts - a).T)
    else:
        dist = np.abs(ab[0] * (pts[:, 1] - a[1]) - ab[1] * (pts[:, 0] - a[0])) / norm
    i = int(np.argmax(dist))
    if dist[i] > tol:
        left = simplify(pts[: i + 1], tol)
        right = simplify(pts[i:], tol)
        return np.vstack([left[:-1], right])
    return np.vstack([a, b])


def main():
    fr, fz, fi = build_filaments()

    # Grid: horizontal axis = z (bore axis), vertical axis = r (mirrored).
    zmax, rmax = 1.55, 1.0
    z = np.linspace(-zmax, zmax, 760)
    r = np.linspace(1e-4, rmax, 300)
    zz, rr = np.meshgrid(z, r)
    psi = flux(rr, zz, fr, fz, fi)
    # Mask the conductor cross-sections so contours do not run through them.
    for blocks, (r_in, r_out) in ((MAIN_BLOCKS, MAIN_R), (SHIELD_BLOCKS, SHIELD_R)):
        for zc, hl, _ in blocks:
            for sgn in (1, -1):
                inside = (np.abs(zz - sgn * zc) <= hl + 0.02) & (rr >= r_in - 0.02) & (rr <= r_out + 0.02)
                psi[inside] = np.nan

    # Levels: field-line density follows field strength.
    psi_bore = flux(np.array([0.43]), np.array([0.0]), fr, fz, fi)[0]
    pos = np.linspace(0, psi_bore, 15)[1:]
    neg_min = np.nanpercentile(psi, 0.5)
    neg = np.linspace(neg_min * 0.9, 0, 5)[:-1]
    levels = np.sort(np.concatenate([neg, pos]))

    fig, ax = plt.subplots()
    cs = ax.contour(zz, rr, psi, levels=levels)
    plt.close(fig)

    # ---- SVG export ----------------------------------------------------------
    W, H = 620, 400
    sx = W / (2 * zmax)
    sy = H / (2 * rmax)

    def to_svg(zp, rp):
        return (zp + zmax) * sx, (rmax - rp) * sy

    # Draw order mimics a current ramp: bore lines first, then outwards,
    # the shielding return flux last.
    order = sorted(range(len(levels)), key=lambda i: (levels[i] < 0, abs(levels[i])))
    rank = {lvl_idx: n for n, lvl_idx in enumerate(order)}
    paths = []  # (d, delay in s)
    for lvl_idx, seg_list in enumerate(cs.allsegs):
        delay = 0.35 + 0.07 * rank[lvl_idx]
        for seg in seg_list:
            if len(seg) < 8:
                continue
            for mirror in (1, -1):
                pts = simplify([to_svg(p[0], mirror * p[1]) for p in seg], 0.15)
                d = "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts)
                paths.append((d, delay))

    rects = []
    for (zc, hl, _), rad in [(b, MAIN_R) for b in MAIN_BLOCKS] + [
        (b, SHIELD_R) for b in SHIELD_BLOCKS
    ]:
        for sz in (1, -1):
            for sr in (1, -1):
                x0, y0 = to_svg(sz * zc - hl, sr * rad[1] if sr > 0 else -rad[0])
                w = 2 * hl * sx
                h = (rad[1] - rad[0]) * sy
                rects.append((x0, y0, w, h))

    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        'role="img" aria-labelledby="fl-title">',
        '<title id="fl-title">Field lines of an actively shielded '
        "superconducting solenoid, cross-section</title>",
        '<defs><radialGradient id="fl-fade" cx="50%" cy="50%" r="50%">'
        '<stop offset="0.72" stop-color="#fff"/><stop offset="1" stop-color="#000"/>'
        '</radialGradient><mask id="fl-mask"><rect width="100%" height="100%" '
        'fill="url(#fl-fade)"/></mask></defs>',
        "<style>"
        ".fl-lines path{stroke:#1E2228;stroke-width:1;stroke-opacity:.8;"
        "vector-effect:non-scaling-stroke}"
        ".fl-lines .axis{stroke-opacity:.35;stroke-dasharray:6 5}"
        ".fl-coils rect{fill:#2846A8}"
        "@media (prefers-reduced-motion:no-preference){"
        ".fl-lines path:not(.axis){stroke-dasharray:1;stroke-dashoffset:1;"
        "animation:fl-draw 1.6s cubic-bezier(.45,0,.2,1) forwards}"
        ".fl-coils{opacity:0;animation:fl-in .5s ease-out forwards}"
        "@keyframes fl-draw{to{stroke-dashoffset:0}}"
        "@keyframes fl-in{to{opacity:1}}}"
        "</style>",
        '<g class="fl-lines" fill="none" mask="url(#fl-mask)">',
        f'<path class="axis" d="M0 {H/2:.1f}L{W} {H/2:.1f}"/>',
    ]
    for d, delay in paths:
        svg.append(f'<path pathLength="1" style="animation-delay:{delay:.2f}s" d="{d}"/>')
    svg.append("</g>")
    svg.append('<g class="fl-coils">')
    for x0, y0, w, h in rects:
        svg.append(f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{w:.1f}" height="{h:.1f}"/>')
    svg.append("</g></svg>")
    OUT.write_text("\n".join(svg))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB, {len(paths)} paths)")


if __name__ == "__main__":
    main()
