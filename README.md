# WasGibts?

A personal menu companion. Give it a restaurant's website, a photo of the menu or a PDF. It extracts the actual dishes, translates them while keeping the original names, and explains what each dish is and how it is made. It then recommends 3–5 dishes for **you** and the occasion, explaining each pick with evidence from your own taste profile.

It is not a calorie tracker and not a restaurant finder. Its job is to read a menu through your taste.

- **Your profile stays with you.** It is stored in the browser, separate from the AI. You can inspect, correct, export or delete it at any time.
- **Facts are kept apart from assumptions.** Ingredients printed on the menu are shown plainly. Typical ingredients are shown in italics. Prices are never estimated, and there are no generated images or nutrition figures.
- **It learns only from feedback.** "I loved this", "Too rich", "I wanted more vegetables", "I'd order it again", "Not today"… Patterns stay suggestions until you confirm them.

See [docs/DATA_MODEL.md](docs/DATA_MODEL.md) for the data model, inference rules and user flows.

## Run

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY
npm start                 # http://127.0.0.1:8890
npm test
```

Without an API key, the app still runs: the sample menu and the built-in matcher work, but reading real menus and importing a profile from prose need the key.

| env | default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | enables menu reading, AI recommendations and profile import |
| `WASGIBTS_MODEL` | `claude-opus-5-5` | |
| `WASGIBTS_EFFORT` | `medium` | `low` is cheaper and faster; `high` is more careful |
| `WASGIBTS_FALLBACKS` | on | server-side refusal fallback; set `off` to disable |
| `WASGIBTS_RATE_LIMIT` | `40` | AI calls per IP per 10 minutes |
| `PORT` / `HOST` | `8890` / `127.0.0.1` | |

## Your starting profile

`shared/seed-profile.json` holds your food profile and is loaded the first time the app opens. **Taste profile → Reset to starting profile** reloads it.

| your profile section | in the app |
|---|---|
| Confirmed or strongly supported | explicit preferences under *You enjoy* / *You'd rather avoid* |
| Likely, verify through feedback | *To be confirmed*: used, but phrased as "you listed this as likely, not confirmed yet" until feedback or **That's me** confirms them |
| Does not drink alcohol | a *flexible* restriction: dishes where alcohol is a main component are flagged but not excluded |
| Do not assume / recommendation behaviour | *Ground rules*, sent with every recommendation request |
| Language, Munich | settings: explanations in Traditional Chinese, names also in English/German, home city Munich |
| Solo vs sharing | the occasion starts unset; the app asks when the answer would change its picks |
| One adventurous option | setting: always reserve one adventurous or regional pick |

The app's own interface is in English; menu translations, explanations and recommendations follow the language setting. The built-in matcher, used when no AI key is configured, writes in English.

## Architecture

```
public/          vanilla ES-module front end (no build step)
  js/store.js    Repository interface → LocalRepository (localStorage)
  js/views/      read · journal · profile
shared/          pure logic, used unchanged by browser and server
  model.js       types, vocabularies, normalisation
  profile.js     preference operations, feedback → inference, AI view
  menu.js        menu shape with menu/typical provenance
  recommend.js   deterministic matcher (fallback + restriction screen)
lib/
  ai.js          Claude calls with structured outputs: extract · recommend · parse profile
  schemas.js     output JSON schemas
  sources.js     URL fetch (private-network guard), HTML → text, PDF/photo blocks
server.js        stateless HTTP server; no user data on the server
```

The server stores nothing about users. Each AI request carries only `profileForAI(profile)`, a compact view without dismissed items, early signals or (if you choose) restrictions.

To add accounts later, add a `RemoteRepository` and `/api/profile` routes. See the end of the data-model doc.

## Limitations (MVP)

- Websites that render their menu with JavaScript, or show it only as images, yield little text. The app then suggests uploading a photo or the PDF instead.
- Photos are downscaled in the browser to 2000 px. HEIC files may need converting first.
- The URL fetcher checks the resolved address before connecting but does not pin it, so DNS-rebinding protection is basic. Put it behind an egress proxy if you expose it publicly.
- Allergy handling is advisory. Menus are incomplete, and the app says so wherever it matters.
