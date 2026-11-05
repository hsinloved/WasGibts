# Data model and user flows

WasGibts reads menus through a personal taste profile. The profile belongs to the user and is kept apart from the language model. The model gets a compact, per-request view of it and stores nothing.

## Principles

1. **Provenance everywhere.** Each preference records where it came from. Each dish detail is marked as either printed on the menu (`menu`) or general knowledge (`typical`).
2. **Only feedback teaches.** Seeing a dish, being recommended it, or ordering it changes nothing. Only explicit feedback creates evidence.
3. **Inferred ≠ confirmed.** Patterns found in feedback stay `suggested`, with confidence capped at 0.7, until the user confirms them.
4. **Dislikes ≠ restrictions.** A dislike is taste and can be outweighed. A restriction (allergy, intolerance, dietary or religious rule) is a hard constraint. It is never recommended against and is always flagged.
5. **Health data is optional.** Restrictions can be kept on the device without being sent to the AI.

## Profile

```
Profile
├─ schemaVersion, id, ownerId (null until accounts exist), createdAt, updatedAt
├─ about        { name, notes }
├─ settings     { translateTo, glossLanguages, homeCity, shareRestrictionsWithAI,
│                defaultOccasion ('ask' | occasion), includeAdventurousPick }
├─ guidance     string[]        ← standing ground rules in the user's words
├─ preferences  Preference[]   ← explicit, inferred and contextual preferences
├─ restrictions Restriction[]  ← allergies & hard rules
└─ history      HistoryEntry[] ← food history
```

### Preference

| field | meaning |
|---|---|
| `origin` | `explicit` (the user stated it) or `inferred` (derived from feedback) |
| `status` | `active` (stated or confirmed), `suggested` (inferred, unconfirmed), `dismissed` ("not me", kept so it is never suggested again) |
| `polarity` | `like` / `dislike` |
| `category` | ingredient · cuisine · dish · flavour · texture · technique · style · other |
| `subject` | free text, e.g. "coriander", "rich, heavy dishes" |
| `contexts` | occasions it applies to (`[]` = always). This is how **contextual preferences** are stored, e.g. "vegetable-forward, but only at lunch". |
| `confidence` | 0–1. Shown as words only: *a hunch*, *fairly sure*, *sure*. |
| `evidence[]` | `{ source: user_stated · user_confirmed · feedback · import · seed, note, at, ref?, weight? }`. `ref` points at the history entry that produced it. |
| `history[]` | `{ at, by: user · system, action, detail }`: created, noticed, evidence, confidence, confirmed, corrected, dismissed, restored |

The four kinds of preference the brief describes are all held in this one structure:

- **Explicit:** `origin: explicit`
- **Inferred:** `origin: inferred`, `status: suggested` until confirmed
- **Dislikes:** `polarity: dislike`. Restrictions live in their own list.
- **Contextual:** non-empty `contexts`. One-off requests ("something light today") go with the request and are never saved.

### Restriction

`{ type: allergy · intolerance · dietary · religious · avoid, subject, severity: strict · flexible, note, evidence[], history[] }`

### HistoryEntry (food history)

`{ action: ordered · saved · skipped, at, occasion, restaurant {name,url}, dish {originalName, translatedName, cuisine, ingredients, attributes, price}, recommended, feedback[], note, feedbackAt }`

The dish snapshot keeps menu-verified ingredients where they exist, so later inference rests on facts rather than on what the AI assumed.

### Feedback → evidence

| tag | teaches |
|---|---|
| I loved this | weak *like* for the dish's top ingredients, cuisine and style (weight 0.5 each) |
| It was good | the same at half weight |
| I'd order it again | *like* for the dish itself (1.5) |
| Didn't enjoy it | *dislike* for the dish itself only. It does not condemn its ingredients. |
| Too rich | *dislike* "rich, heavy dishes" |
| I wanted more vegetables | *like* "vegetable-forward dishes" |
| Too spicy / Wanted more heat / Too salty | the matching flavour signal |
| Not today | **nothing**. It is recorded on the entry only. |

Rules (see `shared/profile.js`):

- Inferred confidence is `min(0.7, 0.15 + 0.15 × Σweights)`. The weights come from feedback, plus a *prior* when the user listed the item as "likely" in a starting profile or import (`source: seed | import` with a `weight`). Such an item is used, but it is labelled "listed as likely, not yet verified" until feedback arrives.
- Anything under weight 1 is an *early signal*: stored, but not used and not sent to the AI.
- Rating an entry again replaces its earlier evidence, so nothing is counted twice. Deleting an entry withdraws everything it taught.
- Feedback that matches an explicit preference adds evidence to it and does not create a duplicate.
- When the user corrects an inferred preference, it becomes explicit. Each change is logged.

## Menu

```
Menu { restaurant {name, cuisine, menuLanguage, currency}, source {kind, label, url}, dishes: Dish[], notes[] }

Dish {
  id, section, originalName, translatedName, glosses [{language, name}],
  menuDescription (verbatim | null),
  price { amount | null, currency, display },      ← never estimated
  explanation, ingredients [{name, source}], preparation [{method, source}],
  flavours[], textures[], cuisine, region, culturalNote,
  attributes[] (controlled vocabulary), dietary { menuStated[], likely[] }, uncertainty
}
```

`source` is `menu` or `typical`. The UI shows typical details in italics, with a legend. There are no images and no nutrition data.

## Recommendation

```
{ engine: ai | local, headline, picks: Pick[3..5], cautions[], orderingTip, occasionQuestion }
Pick { dishId, role, whyYou, evidence [{type, ref, text}], concerns[], occasionFit }
```

Every personal claim must point to a preference, restriction, past order, menu fact or occasion. If the model returns a `dishId` that does not exist, it is dropped.

## Main user flows

1. **Read a menu.** Choose a source (link, photos/PDF or the sample) → pick an occasion → optionally add today's wish → *Read the menu*.
   Server: fetch/convert → AI extraction → normalise. Client: pre-screen restrictions → AI recommendation (falling back to the local matcher) → render picks, then the whole menu.
2. **Order.** On any dish, choose *I'm ordering this* or *Save for later*. This adds a journal entry. The profile does not change.
3. **Give feedback.** In the journal, pick feedback chips and optionally add a note. A live preview shows what each choice will teach before it is saved.
4. **Review patterns.** In the profile, *Patterns I've noticed* shows each suggestion with *That's me / Not me / Edit* and its full evidence and history.
5. **Manage the profile.** Add or edit likes, dislikes and restrictions. Describe yourself in your own words: the AI proposes entries, each with the quote it came from, and you tick which to keep. Export, import, reset to the starting profile, or delete everything.

## Where things live

| concern | file |
|---|---|
| types, vocabularies, factories, migration | `shared/model.js` |
| profile operations, inference, AI view | `shared/profile.js` |
| menu shape & normalisation | `shared/menu.js` |
| deterministic matcher / restriction screen | `shared/recommend.js` |
| storage (repository interface) | `public/js/store.js` |
| AI prompts & calls | `lib/ai.js`, `lib/schemas.js` |
| menu sources (URL/PDF/photo) | `lib/sources.js` |

`shared/` runs unchanged in both the browser and Node.

## Adding accounts and a database later

- Add a `RemoteRepository` with `load / save / clear` in `public/js/store.js`. Nothing else in the client changes.
- Add `GET/PUT/DELETE /api/profile` in `server.js`, keyed by `ownerId`. Validate with `normalizeProfile`, which already handles migration.
- For a relational store, `preferences`, `restrictions`, `history` and their `evidence`/`history` arrays map directly to tables. `evidence.ref → history.id` becomes a foreign key.
- On first sign-in, upload the local profile and set `ownerId`.
