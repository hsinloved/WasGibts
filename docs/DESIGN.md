# Design: Loud Appetite

*Replaces "Quiet Provenance". The meanings below (●/○ provenance marks, the 0.70 confidence ceiling, the mobile-first rules) are unchanged; only the look is new.*

The menu board as a shout: fat rounded letters, one ink outline weight, flat colour served straight from the tin, dish names wrapped on a diagonal, and sticker circles. Inspired by the energy of playful retro food-brand identities, with its own palette, emblem and type, not copied from any one brand.

- **Palette:** rice-paper cream `#fff4dc`, ink `#171412`, paprika `#e94a2b` (fills; text uses `--accent` `#b8331a`, 5.4:1 on cream), egg yolk `#ffc72c`, deep green `#185c54`. Dark mode swaps the surfaces to ink and keeps yolk and paprika.
- **Type:** *Bagel Fat One* for the wordmark and page titles, *Titan One* for headings, dish names, buttons and chips, *Inter* for reading, *DM Mono* for small labels.
- **Chinese and Japanese in headings and dish names:** *Mantou Sans* (饅頭黑體, OFL, based on Dela Gothic One), self-hosted in `public/fonts/` and served **unmodified**, because its licence reserves the name for unmodified copies (so no subsetting). Its `unicode-range` means the 2.7 MB file only downloads on screens that show those characters, and it is cached for a year. It covers Traditional Chinese fully. Simplified characters it lacks (鱼 鸡 锅 …) fall back to *Noto Sans SC Black* from Google Fonts, which is served in small slices. Reading text stays in the system font.
- **Shapes:** one outline weight (`--outline`, 3px). Buttons and chips are pills. Pick cards and the order tray are cream cards with an ink outline and a 4px ink drop. Pick numbers are yolk stickers tilted −8°. Menu sections sit between two heavy rules.
- **Brand moments:** the green header with the diagonal wrapper of dish names (`public/band.png`), the yolk tab pill, the yolk order bar, the yolk staff view. The app icon is the "?" bowl (see Icons).

## Meaning marks (unchanged)

| element | means | where |
|---|---|---|
| **● solid dot** | stated on the menu (`source: menu`) | ingredients and preparation (`.stated`) |
| **○ hollow dot**, italic | typical, assumed (`source: typical`) | ingredients, preparation, "probably" dietary notes (`.typical`) |
| **dashed line at 0.70** | the ceiling for patterns you haven't confirmed (`INFERRED_CAP`) | confidence line under each preference (`.meter`) |
| **yolk sticker / pill** | a choice: a pick number, the selected chip, the active tab | `.pick-num`, `.chip.on`, `nav a[aria-current]` |

## Contrast floors (WCAG)

Body and muted text at least 4.5:1 on every surface (`--muted` `#655a4e`, `--accent` `#b8331a`). Bright paprika (`--paprika`) is only a fill under ink text (4.8:1). Anything you can tap is outlined in ink or `--control-line` (3:1 or more); `--rule` is decorative only.

## Mobile first

Base rules are the phone layout; the two `min-width: 40rem` blocks at the very end of `styles.css` add the wide-screen layout and **must stay last**, so add new rules above them. Touch targets get their 44px from `min-height: var(--tap)`, not padding. The bottom tab bar's height is `--nav-h`; the active tab is a yolk pill via `aria-current`. The full-bleed green behind the header is a `::before` at `z-index: -1` (not `clip-path`, which would clip the fixed tab bar inside the header), and nothing sets a stacking context on the page shell, so the tab bar stays above content. No text below 12px (`.75rem`).

- **Progress** while a menu is read is a short list of steps in the same marks: ● done, a ringed paprika dot for the current step, ○ still to come (`.steps`, announced through `role="status"`).
- **Order bar:** once you order a dish, a bar fixed above the tab bar shows how many dishes, the total, *View* and *Show to staff*. Its height is `--order-h`; the page padding and the toast stack above it via `body:has(.order-bar:not(:empty))`. It steps aside (`.tucked`) while the full order tray is on screen.
- **Profile rows** are their own disclosure: the name, meta and confidence line are the `<summary>` (marked `+` / `−`). Edit, Delete and the evidence sit inside. Only the call to action stays outside: *That's me / Not me* on suggestions, *Restore* on dismissed items.

## Confidence line

The width comes from a 5 % bucket class (`.meter-fill.w0` … `.w100`) because the Content-Security-Policy forbids inline styles. Unconfirmed patterns are drawn in light ink and can never cross the dashed line. Stated and confirmed preferences are drawn in full ink and may go past it.

## Icons

**The "?" bowl:** a fat yolk question mark on WasGibts green whose dot is a paprika bowl, with chopsticks reaching up into the hook. "Was gibts?" in one shape. The master is `design/app-icon-1024.png`; every size is a straight downscale of it:

| file | use |
|---|---|
| `public/icon-192.png`, `icon-512.png` | home-screen icon (`purpose: any`) |
| `public/icon-maskable-512.png` | Android adaptive icon: the art scaled into the 80 % safe circle on a full green square (`purpose: maskable`) |
| `public/apple-touch-icon.png` | iPhone home screen (180 px) |
| `public/favicon-48.png`, `favicon-32.png` | browser tab |

## Results first

- Once a menu is read, the intro and the form fold away. The results header carries the restaurant, a **Change** button and the occasion chips, which re-pick in place.
- **Pick cards** hold only what you need to decide: role, name, translation, price, why it suits you, the first "worth knowing" line and **+ Order this / Save**. Ingredients, preparation, flavours, the cultural note and the evidence open under **What it is**.
- Rows of chips (occasions, menu sections) are one **swipeable row** on phones (`.scroll-row`), with the right edge faded to show there is more. They wrap again on wide screens.
- The main action on the input page sits in a **sticky bar** above the tab bar (`.submit-bar`). The whole menu has **sticky section chips** for jumping between sections.
- **Journal:** only the next dish waiting for feedback has its form open; the rest are one line with *Give feedback*. The five main reactions show first; the specific ones sit under *More specific*, and the note under *Add a note*. *Later* folds a form away.
- Disclosures laid out with flex lose the browser's triangle, so they carry the same `+` / `−` mark as profile rows.
