import math
from pathlib import Path

import patterns

ORANGE = "#F38020"
TILE = "#141416"
PAPER = "#FFFFFF"
INK = "#18181B"
R = 60
H = 12
C1 = (100.0, 100.0)
C2 = (250.0, 100.0)
START = -30.0
END = 150.0
I_X = 370.0
L_X = 430.0
TOP = 40.0
BOTTOM = 160.0
FOOT = 60.0
SHIFT = R + H - C1[0] + 28.0
OFFSET = (C1[0] - R - H, C1[1] - R - H)
TAN = math.degrees(math.acos(2 * R / (C2[0] - C1[0])))


def num(value):
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text == "-0" else text


def at(center, radius, degrees):
    a = math.radians(degrees)
    return (center[0] + radius * math.cos(a) - OFFSET[0], center[1] + radius * math.sin(a) - OFFSET[1])


def p(point):
    return f"{num(point[0])} {num(point[1])}"


def arc(radius, large, sweep, point):
    return f"A{num(radius)} {num(radius)} 0 {large} {sweep} {p(point)}"


def co_outline():
    outer, inner = R + H, R - H
    return " ".join([
        f"M{p(at(C1, outer, START))}",
        arc(outer, 1, 0, at(C1, outer, TAN)),
        f"L{p(at(C2, inner, 180 + TAN))}",
        arc(inner, 1, 1, at(C2, inner, END)),
        arc(H, 0, 0, at(C2, outer, END)),
        arc(outer, 1, 0, at(C2, outer, 180 + TAN)),
        f"L{p(at(C1, inner, TAN))}",
        arc(inner, 1, 1, at(C1, inner, START)),
        arc(H, 0, 0, at(C1, outer, START)),
        "Z",
    ])


def shift(x, y):
    return (x - OFFSET[0], y - OFFSET[1])


def i_outline():
    return " ".join([
        f"M{p(shift(I_X - H, TOP))}",
        arc(H, 0, 1, shift(I_X + H, TOP)),
        f"V{num(BOTTOM - OFFSET[1])}",
        arc(H, 0, 1, shift(I_X - H, BOTTOM)),
        "Z",
    ])


def l_outline():
    return " ".join([
        f"M{p(shift(L_X - H, TOP))}",
        arc(H, 0, 1, shift(L_X + H, TOP)),
        f"V{num(BOTTOM - H - OFFSET[1])}",
        f"H{num(L_X + FOOT - OFFSET[0])}",
        arc(H, 0, 1, shift(L_X + FOOT, BOTTOM + H)),
        f"H{num(L_X - OFFSET[0])}",
        arc(H, 0, 1, shift(L_X - H, BOTTOM)),
        "Z",
    ])


WIDTH = L_X + FOOT + H - OFFSET[0]
HEIGHT = 2 * (R + H)
MARK_WIDTH = C2[0] + R + H - OFFSET[0]


def svg(view_box, body, label="coil"):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}" role="img" aria-label="{label}">{body}</svg>\n'


def wordmark(fill):
    paths = "".join(f'<path d="{d}"/>' for d in (co_outline(), i_outline(), l_outline()))
    return svg(f"0 0 {num(WIDTH)} {num(HEIGHT)}", f'<g fill="{fill}">{paths}</g>')


def mark(fill):
    return svg(f"0 0 {num(MARK_WIDTH)} {num(HEIGHT)}", f'<path fill="{fill}" d="{co_outline()}"/>')


def tile_icon(mark_share, corner, tile=TILE):
    size = 512
    scale = size * mark_share / MARK_WIDTH
    x = (size - MARK_WIDTH * scale) / 2
    y = (size - HEIGHT * scale) / 2
    rect = f'<rect width="{size}" height="{size}" rx="{num(size * corner)}" fill="{tile}"/>' if corner > 0 else f'<rect width="{size}" height="{size}" fill="{tile}"/>'
    body = rect + f'<path fill="{ORANGE}" transform="translate({num(x)} {num(y)}) scale({num(scale)})" d="{co_outline()}"/>'
    return svg(f"0 0 {size} {size}", body)


def icon():
    return tile_icon(0.72, 0.22)


def icon_light():
    return tile_icon(0.72, 0.22, PAPER)


def maskable():
    return tile_icon(0.56, 0)


def apple():
    return tile_icon(0.70, 0)


def favicon():
    size = 64
    scale = size * 0.94 / MARK_WIDTH
    x = (size - MARK_WIDTH * scale) / 2
    y = (size - HEIGHT * scale) / 2
    body = f'<path fill="{ORANGE}" transform="translate({num(x)} {num(y)}) scale({num(scale)})" d="{co_outline()}"/>'
    return svg(f"0 0 {size} {size}", body)


def lockup(text_fill):
    gap = 36
    tag_size = 30
    w = WIDTH + gap + 620
    paths = "".join(f'<path d="{d}"/>' for d in (co_outline(), i_outline(), l_outline()))
    body = (
        f'<g fill="{ORANGE}">{paths}</g>'
        f'<text x="{num(WIDTH + gap)}" y="{num(HEIGHT / 2 + tag_size * 0.35)}" fill="{text_fill}" '
        f'font-family="Google Sans Flex, Google Sans, system-ui, sans-serif" font-size="{tag_size}" font-weight="500">'
        f'agent threads with their own computer</text>'
    )
    return svg(f"0 0 {num(w)} {num(HEIGHT)}", body)


def social():
    w, h = 1200, 630
    scale = 560 / WIDTH
    x = (w - WIDTH * scale) / 2
    y = (h - HEIGHT * scale) / 2 - 40
    paths = "".join(f'<path d="{d}"/>' for d in (co_outline(), i_outline(), l_outline()))
    body = (
        f'<rect width="{w}" height="{h}" fill="{TILE}"/>'
        f'<g fill="{ORANGE}" transform="translate({num(x)} {num(y)}) scale({num(scale)})">{paths}</g>'
        f'<text x="{w // 2}" y="{num(y + HEIGHT * scale + 86)}" text-anchor="middle" fill="#ECECF0" '
        f'font-family="Google Sans Flex, Google Sans, system-ui, sans-serif" font-size="34" font-weight="500">'
        f'Every agent thread gets a real computer you share with it.</text>'
    )
    return svg(f"0 0 {w} {h}", body)


def stroke_reference():
    w = 2 * H
    body = (
        f'<g fill="none" stroke="{ORANGE}" stroke-width="{num(w)}" stroke-linecap="round" stroke-linejoin="round" '
        f'transform="translate({num(-OFFSET[0])} {num(-OFFSET[1])})">'
        f'<path d="M{p((C1[0] + R * math.cos(math.radians(START)), C1[1] + R * math.sin(math.radians(START))))} '
        f'A{R} {R} 0 1 0 {p((C1[0] + R * math.cos(math.radians(TAN)), C1[1] + R * math.sin(math.radians(TAN))))} '
        f'L{p((C2[0] + R * math.cos(math.radians(180 + TAN)), C2[1] + R * math.sin(math.radians(180 + TAN))))} '
        f'A{R} {R} 0 1 1 {p((C2[0] + R * math.cos(math.radians(END)), C2[1] + R * math.sin(math.radians(END))))}"/>'
        f'<path d="M{num(I_X)} {num(TOP)} V{num(BOTTOM)}"/>'
        f'<path d="M{num(L_X)} {num(TOP)} V{num(BOTTOM)} H{num(L_X + FOOT)}"/></g>'
    )
    return svg(f"0 0 {num(WIDTH)} {num(HEIGHT)}", body)


def construction():
    pad = 40
    w, h = WIDTH + 2 * pad, HEIGHT + 2 * pad
    blue = "#5B9CFF"
    c1 = (C1[0] - OFFSET[0] + pad, C1[1] - OFFSET[1] + pad)
    c2 = (C2[0] - OFFSET[0] + pad, C2[1] - OFFSET[1] + pad)
    guides = []
    for y in (pad, pad + H, pad + HEIGHT / 2, pad + HEIGHT - H, pad + HEIGHT):
        guides.append(f'<line x1="0" x2="{num(w)}" y1="{num(y)}" y2="{num(y)}"/>')
    for x in (c1[0], c2[0], I_X - OFFSET[0] + pad, L_X - OFFSET[0] + pad):
        guides.append(f'<line y1="0" y2="{num(h)}" x1="{num(x)}" x2="{num(x)}"/>')
    circles = "".join(f'<circle cx="{num(c[0])}" cy="{num(c[1])}" r="{R}"/>' for c in (c1, c2))
    paths = "".join(f'<path d="{d}"/>' for d in (co_outline(), i_outline(), l_outline()))
    label = f'font-family="Google Sans Code, ui-monospace, monospace" font-size="9" fill="{blue}"'
    body = (
        f'<g fill="{ORANGE}" fill-opacity="0.9" transform="translate({pad} {pad})">{paths}</g>'
        f'<g stroke="{blue}" stroke-width="0.6" stroke-dasharray="3 3" opacity="0.8">{"".join(guides)}</g>'
        f'<g fill="none" stroke="{blue}" stroke-width="0.8">{circles}</g>'
        f'<text x="{num(c1[0] + 4)}" y="{num(c1[1] - 4)}" {label}>r 60</text>'
        f'<text x="{num((c1[0] + c2[0]) / 2 - 58)}" y="{num(pad + HEIGHT + 16)}" {label}>150 apart · tangent 36.87°</text>'
        f'<text x="{num(I_X - OFFSET[0] + pad - H)}" y="{num(pad - 8)}" {label}>stroke 24</text>'
    )
    return svg(f"0 0 {num(w)} {num(h)}", body, "coil construction")


files = {
    "coil-wordmark.svg": wordmark(ORANGE),
    "coil-wordmark-mono.svg": wordmark("currentColor"),
    "coil-mark.svg": mark(ORANGE),
    "coil-mark-mono.svg": mark("currentColor"),
    "coil-icon.svg": icon(),
    "coil-icon-light.svg": icon_light(),
    "coil-icon-maskable.svg": maskable(),
    "coil-lockup-dark.svg": lockup("#ECECEE"),
    "coil-lockup-light.svg": lockup(INK),
    "coil-icon-apple.svg": apple(),
    "coil-favicon.svg": favicon(),
    "coil-social.svg": social(),
    "construction.svg": construction(),
}

for name, text in files.items():
    Path(name).write_text(text)

Path("stroke-reference.svg").write_text(stroke_reference())
print(f"wordmark {num(WIDTH)}x{num(HEIGHT)}, mark {num(MARK_WIDTH)}x{num(HEIGHT)}")

print(f"patterns: {patterns.write(Path(__file__).parent)} tiles")
