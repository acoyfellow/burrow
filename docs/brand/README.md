# coil brand

Everything here comes from `build.py`. Run `node scripts/build-brand.mjs` from the repo root. It regenerates the SVGs, renders the PNGs into `public/icons/`, and writes the social card. `guidelines.html` shows the whole kit.

## The mark

The mark is the C and the O drawn as one line. The C is open at the top right. The line crosses diagonally into the O and finishes at the O's bottom left. The I and L use the same stroke. The three lines have the same weight and round ends, and every letter sits between the same top and bottom lines.

Geometry, in wordmark units:

- Both circles have radius 60, with centres 150 apart.
- The stroke is 24 wide.
- The diagonal meets each circle at a tangent of 36.87°.
- The C opens at −30°, and the O ends at 150°.

## Files

| File | Use |
| --- | --- |
| `coil-wordmark.svg` | The default logo: orange "coil" |
| `coil-wordmark-mono.svg` | `currentColor`, so it takes the surrounding text colour |
| `coil-mark.svg`, `coil-mark-mono.svg` | The C and O alone, for square or tight spaces |
| `coil-lockup-dark.svg`, `coil-lockup-light.svg` | Wordmark and tagline, for headers and slides |
| `coil-icon.svg` | App icon on the dark tile |
| `coil-icon-light.svg` | App icon on a white tile |
| `coil-icon-maskable.svg` | Full-bleed tile with the mark inside the Android safe zone |
| `coil-icon-apple.svg` | Square tile for iOS, which rounds the corners itself |
| `coil-favicon.svg` | The mark with no tile, for browser tabs |
| `coil-social.svg`, `coil-social.png` | 1200×630 link preview |
| `patterns/*.svg` | Very faint tiling backgrounds (loops, tangent, dots, truchet), dark and light |
| `tokens.json` | Colours and type, copied from `src/ui/style.ts` |
| `stroke-reference.svg` | The stroke version, used to check the outlines |

Rendered into `public/icons/`: `icon-192.png`, `icon-512.png`, `maskable-192.png`, `maskable-512.png`, `apple-touch-icon.png` (180), `favicon-32.png`, `favicon-16.png`, `coil.svg`, `favicon.svg` and `coil-mark.svg`.

## Colour

Orange `#F38020` on the tile `#141416`. The app's other colours are in `tokens.json`. On dark backgrounds the UI uses a lighter orange, `#f6913e`, for small text. The logo always uses `#F38020`.

## Type

The UI uses Google Sans Flex, and code uses Google Sans Code, both from Google Fonts. Body and controls are 14px. Text is 400, emphasis is 500 and headings are 600. Headings are in sentence case, with no bold and no letter-spacing.

## Patterns

The patterns are made from the mark's own parts: the centre line, the 36.87° diagonal, round ends and quarter arcs. They are drawn at about 5% opacity. Use them only on large empty areas. In CSS: `background: #141416 url(patterns/loops-dark.svg)`.

## Do not

- Do not stretch, rotate, outline or add effects to the logo.
- Do not draw the C and O as two separate shapes.
- Do not set "coil" in a font in place of the wordmark.
- Never put the mark next to "coil" typed in a font. That was the old logo. The wordmark already spells "coil" with the mark as its C and O. Use the wordmark on its own, or the mark on its own.
- Do not put the orange mark on a background that is close to orange.
- Do not use the mark smaller than 16px. Below 24px, use `favicon.svg`.
