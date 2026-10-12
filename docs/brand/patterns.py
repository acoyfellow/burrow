import math
from pathlib import Path

R = 60
CENTER_GAP = 150
THEMES = {"dark": ("#ECECEE", 0.05), "light": ("#18181B", 0.055)}


def num(value):
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text == "-0" else text


def tile(width, height, body, ink, alpha, stroke):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{num(width)}" height="{num(height)}" '
        f'viewBox="0 0 {num(width)} {num(height)}">'
        f'<g fill="none" stroke="{ink}" stroke-opacity="{alpha}" stroke-width="{num(stroke)}" '
        f'stroke-linecap="round" stroke-linejoin="round">{body}</g></svg>\n'
    )


def mark_centerline(x, y, scale):
    r = R * scale
    c1 = (x, y)
    c2 = (x + CENTER_GAP * scale, y)
    start = (c1[0] + r * math.cos(math.radians(30)), c1[1] - r * 0.5)
    enter = (c1[0] + r * 0.8, c1[1] + r * 0.6)
    leave = (c2[0] - r * 0.8, c2[1] - r * 0.6)
    end = (c2[0] - r * math.cos(math.radians(30)), c2[1] + r * 0.5)
    p = lambda point: f"{num(point[0])} {num(point[1])}"
    return (
        f'<path d="M{p(start)} A{num(r)} {num(r)} 0 1 0 {p(enter)} '
        f'L{p(leave)} A{num(r)} {num(r)} 0 1 1 {p(end)}"/>'
    )


def loops(ink, alpha):
    scale = 0.2
    width, height = 120, 72
    rows = [(18, 18), (78, 54), (-42, 54)]
    body = "".join(mark_centerline(x, y, scale) for x, y in rows)
    return tile(width, height, body, ink, alpha, 1)


def tangent(ink, alpha):
    return tile(30, 40, '<path d="M0 40 L30 0 M-15 20 L0 0 M30 40 L45 20"/>', ink, alpha, 1)


def dots(ink, alpha):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">'
        f'<circle cx="12" cy="12" r="1" fill="{ink}" fill-opacity="{alpha * 1.6}"/></svg>\n'
    )


def truchet(ink, alpha):
    cell, cells = 24, 8
    half = cell / 2
    arcs = []
    for row in range(cells):
        for col in range(cells):
            x, y = col * cell, row * cell
            flipped = (row * 7 + col * 13 + row * col * 5) % 3 == 0
            if flipped:
                arcs.append(f'<path d="M{num(x + half)} {num(y)} A{num(half)} {num(half)} 0 0 1 {num(x + cell)} {num(y + half)}"/>')
                arcs.append(f'<path d="M{num(x)} {num(y + half)} A{num(half)} {num(half)} 0 0 0 {num(x + half)} {num(y + cell)}"/>')
            else:
                arcs.append(f'<path d="M{num(x + half)} {num(y)} A{num(half)} {num(half)} 0 0 0 {num(x)} {num(y + half)}"/>')
                arcs.append(f'<path d="M{num(x + cell)} {num(y + half)} A{num(half)} {num(half)} 0 0 0 {num(x + half)} {num(y + cell)}"/>')
    return tile(cell * cells, cell * cells, "".join(arcs), ink, alpha, 1)


PATTERNS = {"loops": loops, "tangent": tangent, "dots": dots, "truchet": truchet}


def write(out_dir):
    folder = Path(out_dir) / "patterns"
    folder.mkdir(exist_ok=True)
    for name, build in PATTERNS.items():
        for theme, (ink, alpha) in THEMES.items():
            (folder / f"{name}-{theme}.svg").write_text(build(ink, alpha))
    return len(PATTERNS) * len(THEMES)


if __name__ == "__main__":
    print(f"patterns: {write(Path(__file__).parent)} tiles")
