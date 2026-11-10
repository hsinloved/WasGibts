# Design: Quiet Provenance

WasGibts looks like a page of field notes: things observed are kept visibly apart from things assumed. That is the same rule the data model follows.

| element | means | where |
|---|---|---|
| **● solid dot** | stated on the menu (`source: menu`) | ingredients and preparation (`.stated`) |
| **○ hollow dot**, italic | typical, assumed (`source: typical`) | ingredients, preparation, "probably" dietary notes (`.typical`) |
| **dashed line at 0.70** | the ceiling for patterns you haven't confirmed (`INFERRED_CAP`) | confidence line under each preference (`.meter`) |
| **terracotta ring** | a choice: a pick, the open dish, the selected chip | `.pick-num`, `.chip.on`, focus |

## Materials

- **Paper** `#f1ece2` with a faint, even SVG grain. **Ink** `#22201e` in two strengths. **Accent** terracotta `#a84b31`, used to mark choices and never to fill an area. Dark mode keeps the same roles.
- **Type:** *Instrument Serif* italic for the few large gestures (wordmark, page titles, headline). *Newsreader* for reading. *DM Mono* for labels, buttons, chips, prices and dates. *Inter* for running interface text.
- Corners are square and dividers are hairline rules. No shadows.

## Confidence line

The width comes from a 5 % bucket class (`.meter-fill.w0` … `.w100`) because the Content-Security-Policy forbids inline styles. Unconfirmed patterns are drawn in light ink and can never cross the dashed line. Stated and confirmed preferences are drawn in full ink and may go past it.

## Icons

`public/favicon.svg` and `icon-192/512.png` show the "chosen" mark: a terracotta ring around a solid ink dot. It sits inside the 80 % maskable safe zone.
