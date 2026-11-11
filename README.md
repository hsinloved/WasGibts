# WasGibts?

A personal menu companion. Give it a restaurant's website, a photo of the menu or a PDF. It extracts the actual dishes, translates them while keeping the original names, and explains what each dish is and how it is made. It then recommends 3–5 dishes for **you** and the occasion, explaining each pick with evidence from your own taste profile.

It is not a calorie tracker and not a restaurant finder. Its job is to read a menu through your taste.

- **Your profile stays with you.** It is stored in the browser, separate from the AI. You can inspect, correct, export or delete it at any time.
- **Facts are kept apart from assumptions.** Ingredients printed on the menu are shown plainly. Typical ingredients are shown in italics. Prices are never estimated, and there are no generated images or nutrition figures.
- **It learns only from feedback.** "I loved this", "Too rich", "I wanted more vegetables", "I'd order it again", "Not today"… Patterns stay suggestions until you confirm them.

## Three ways in

| situation | what to do | what happens |
|---|---|---|
| **At the restaurant** | *Photos & screenshots* → **Take a photo** for each page | Pages are read together. Add dishes to **Your order**, then use **Show to staff** for a full-screen list of original dish names to point at. |
| **Office: a Google Maps link in the chat** | Paste it under *Link*, or on Android **Share → WasGibts** from Google Maps | The place name and location are taken from the link, the restaurant's own menu (website or PDF) is found with web search and read. If none is found, it tells you to screenshot the menu photos in Maps, which always works. **Copy for chat** gives a ready-to-paste order with prices and total. |
| **Ordering online** (Lieferando, Wolt, Uber Eats, Deliveroo, foodora…) | Paste or share the restaurant's page, or screenshots from the app | It tries the platform page, including the menu data the page embeds. If the platform blocks it, it reads the restaurant's own menu instead and warns that platform prices may differ. Screenshots always work. Pick *Office delivery* or *Delivery at home* so it favours dishes that travel well. |

**Install it** (Android Chrome: menu → *Install app*; iPhone Safari: Share → *Add to Home Screen*) to get a home-screen icon. On Android the installed app also appears in the system **Share** sheet for links and screenshots. iOS does not let web apps receive shares, so on iPhone use copy-paste or *Choose photos* instead. Installing requires the app to be served over HTTPS.

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
| `APP_PASSCODE` | none | if set, the app asks for this passcode once per device before it uses the AI |
| `WASGIBTS_MODEL` | `claude-opus-5-5` | |
| `WASGIBTS_EFFORT` | `medium` | `low` is cheaper and faster; `high` is more careful |
| `WASGIBTS_FALLBACKS` | on | server-side refusal fallback; set `off` to disable |
| `WASGIBTS_RATE_LIMIT` | `40` | AI calls per IP per 10 minutes |
| `PORT` / `HOST` | `8890` / `127.0.0.1` | |

## Deploy on Vercel

The repo is ready for Vercel as is. `vercel.json` serves `public/` as static files and runs `server.js` as one function under `/api`.

1. On vercel.com, choose **Add New → Project** and import **hsinloved/WasGibts**. Vercel reads the settings from `vercel.json`, so leave framework, build and output settings as they are.
2. Under **Environment Variables**, add `ANTHROPIC_API_KEY`, and `APP_PASSCODE` so that only people you give the passcode to can spend your key. Optional: `WASGIBTS_MODEL`, `WASGIBTS_EFFORT`, `WASGIBTS_RATE_LIMIT`. After changing a variable, redeploy.
3. Click **Deploy**, then open the `*.vercel.app` URL on your phone and install it (see *Three ways in*).

Notes:
- Vercel accepts at most about 4.5 MB per request. Photos are shrunk in the browser to fit, and the app warns before sending something too big. Up to about 8 pages work in one go; large PDFs may need splitting.
- Reading a long menu can take a minute or more. The function is allowed 300 s, which needs Vercel's default *Fluid compute*; if your plan rejects that, lower `maxDuration` in `vercel.json` to 60.
- Without `APP_PASSCODE`, anyone with the URL can use your API key through the app. With it, reading menus, AI picks and profile import need the passcode, which each phone enters once (it is kept in that browser's storage). Wrong guesses are limited to 10 per IP per 10 minutes. The built-in limit of 40 AI calls per IP per 10 minutes is held in memory, so on Vercel it resets often; also set a monthly spend limit in the Anthropic console.

GitHub Pages is not an option: it only hosts static files, so there would be nowhere to keep the API key, and only the sample menu would work.

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
- Google Maps menu photos can't be read from a link (Google offers no open access to them). The app searches for the restaurant's own menu instead, using Claude's web search tool, which must be enabled for your Anthropic organization. Menus found this way may be out of date.
- Delivery platforms often block automated reading, and their page formats change. Expect screenshots to be the dependable route there.
- Photos are downscaled in the browser to 2000 px. HEIC files may need converting first.
- The URL fetcher checks the resolved address before connecting but does not pin it, so DNS-rebinding protection is basic. Put it behind an egress proxy if you expose it publicly.
- Allergy handling is advisory. Menus are incomplete, and the app says so wherever it matters.
