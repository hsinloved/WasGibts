// The AI layer. Three narrow jobs, each with a fixed output schema:
//   extractMenu   — menu source → structured dishes with provenance
//   recommend     — menu + compact profile view + occasion → picks
//   parseProfile  — the user's own words → proposed profile entries
//
// The model never stores anything. The profile lives on the user's device and
// is sent per request via shared/profile.js → profileForAI().

import Anthropic from '@anthropic-ai/sdk';
import { MENU_SCHEMA, RECOMMENDATION_SCHEMA, PROFILE_IMPORT_SCHEMA } from './schemas.js';
import { ATTRIBUTES } from '../shared/menu.js';
import { OCCASIONS } from '../shared/model.js';

const MODEL = process.env.WASGIBTS_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.WASGIBTS_EFFORT || 'medium';
// Server-side refusal fallback: if the model declines, the API reroutes to a
// recommended fallback model inside the same call. Set WASGIBTS_FALLBACKS=off to disable.
const USE_FALLBACKS = process.env.WASGIBTS_FALLBACKS !== 'off';

let client = null;
export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export class AIError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

async function structured({ system, content, schema, maxTokens = 32000 }) {
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema } },
    ...(USE_FALLBACKS ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
  };
  let msg;
  try {
    msg = await getClient().beta.messages.stream(params).finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AIError('The AI key was rejected. Check ANTHROPIC_API_KEY.', 500);
    if (err instanceof Anthropic.RateLimitError) throw new AIError('The AI service is busy. Try again in a moment.', 429);
    if (err instanceof Anthropic.BadRequestError) throw new AIError(`The AI service rejected the request: ${err.message}`, 400);
    if (err instanceof Anthropic.APIError) throw new AIError(`AI service error (${err.status ?? 'network'}).`, 502);
    throw err;
  }
  if (msg.stop_reason === 'refusal') throw new AIError('The AI declined to process this input.', 422);
  if (msg.stop_reason === 'max_tokens') throw new AIError('This menu is too long to read in one go. Try a single page or section.', 413);
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new AIError('The AI returned something unreadable. Please try again.');
  }
}

// --- Menu extraction ---------------------------------------------------------

const EXTRACT_SYSTEM = `You read restaurant menus for a diner and turn them into structured data.

Accuracy rules — these matter more than completeness:
- Only include dishes that actually appear on this menu. Never add dishes.
- originalName: exactly as printed, in the original language and script.
- menuDescription: the printed description, verbatim, or null if there is none.
- price: copy only what is printed. If no price is visible, amount and display are null. Never estimate a price.
- ingredients and preparation: mark source "menu" ONLY when the menu text states it. You may add what the dish typically contains or how it is typically made, marked source "typical". Keep "typical" entries to the defining ones; do not pad.
- dietary.menuStated: only labels or symbols printed on the menu (e.g. "V", "vegan", "gluten-free"). dietary.likely: cautious inferences, e.g. "likely contains fish sauce". Never claim something is allergen-free.
- If you are unsure what a dish is, say so plainly in "uncertainty" and keep the explanation hedged.

Interpretation:
- translatedName: a natural, plain translation into the diner's language, or null when the name is already in that language and self-explanatory.
- glosses: short translations of the dish name into the extra languages the diner asks for, only when they help (skip a language the menu is already in, and skip names that are identical in that language). Empty list otherwise.
- explanation: one or two plain sentences on what the dish is — what arrives at the table. No hype.
- flavours / textures: a few honest words each.
- culturalNote: one short, specific line of regional or cultural context when it genuinely helps; otherwise null.
- attributes: choose only from the allowed list and only when clearly applicable. "shareable" = suited to passing around a table; "travels-well" = survives delivery; "quick" = fast to eat; "unusual" = likely unfamiliar to most diners.
- id: short stable ids like "d1", "d2" in menu order. section: the menu heading it sits under, or null.
- Skip drinks unless the menu has no food. Mention skipped sections, illegible parts or anything odd in "notes".
- If the input is not a menu at all, return an empty dishes list and explain in notes.`;

export async function extractMenu({ parts, translateTo = 'English', glossLanguages = [], homeCity = '' }) {
  const lines = [
    `Translate dish names into ${translateTo} and write every explanation, flavour, texture, preparation and note in ${translateTo}. Keep originalName exactly as printed.`,
    glossLanguages.length ? `Glosses wanted, where useful: ${glossLanguages.join(', ')}.` : 'No glosses wanted; return empty glosses lists.',
    homeCity ? `The diner lives in ${homeCity}; explain what would be unfamiliar to someone living there.` : '',
    `Allowed attributes: ${ATTRIBUTES.join(', ')}.`,
  ];
  const content = [...parts, { type: 'text', text: lines.filter(Boolean).join('\n') }];
  return structured({ system: EXTRACT_SYSTEM, content, schema: MENU_SCHEMA });
}

// --- Recommendation ----------------------------------------------------------

const RECOMMEND_SYSTEM = `You help one person decide what to order, like a friend who knows food well and knows their taste.

You get a menu (already extracted), their taste profile, the occasion, and safety pre-screen hints.

How to choose:
- Recommend 3 to 5 dishes, ordered by how much this person is likely to enjoy them. Fewer is fine if the menu is small.
- The diner's own guidance (in <profile>.guidance) overrides your defaults. Follow it.
- Respect restrictions first. Never recommend a dish that conflicts with a strict restriction (allergy, intolerance, religious, dietary). Put every possible conflict in "cautions", and say "may contain" unless the menu states it. Never call anything safe or allergen-free.
- Then match taste. Stated preferences outweigh patterns. "Unconfirmed pattern" preferences are hunches drawn from feedback — lean on them gently and phrase them that way ("you seemed to enjoy…", not "you love…").
- Preferences marked onlyFor apply only on those occasions.
- "Likely, not yet verified" preferences are the diner's own guesses about themselves: use them, but say they are still to be confirmed.
- Never infer medical or dietary needs the diner has not stated, and never assume lighter is better unless they asked for it.
- Fit the occasion. A short, specific nod to it is enough.
- If the occasion is unknown and knowing it (solo, sharing, delivery) would change your picks, set occasionQuestion to one short question explaining why; otherwise null. Still give your best picks.
- Variety helps: avoid five versions of the same thing.

How to write:
- Conversational and brief. No scores, percentages or star ratings. No superlatives you cannot back up.
- whyYou: one to three sentences on why this suits *them*. Do not re-explain what the dish is; the diner already sees that.
- Every personal claim in whyYou must be backed by an item in evidence. evidence.ref is the preference or restriction id when citing one, otherwise null. Use type "menu" for facts from the menu and "occasion" for occasion fit.
- concerns: honest trade-offs (rich, large, spicy, conflicts with a mild dislike, unclear ingredients). Empty if none.
- role: a two-to-four word label such as "Start here", "Safe bet", "A little stretch", "To share".
- Name the preparation style when it matters to the choice (grilled, fried, raw, creamy, rich).
- headline: one sentence about this menu for this person.
- orderingTip: an optional practical tip (portion sizes, what to pair, what to ask staff), or null.
- Only use dishIds that exist in the menu.`;

export async function recommend({ menu, profileView, occasion, request = '', screen = [], language = 'English', includeAdventurous = false }) {
  const dishes = menu.dishes.map((d) => ({
    id: d.id, section: d.section, name: d.originalName, translated: d.translatedName,
    menuDescription: d.menuDescription, price: d.price.display ?? d.price.amount,
    ingredients: d.ingredients.map((x) => `${x.name}${x.source === 'typical' ? ' (typical)' : ''}`),
    preparation: d.preparation.map((x) => `${x.method}${x.source === 'typical' ? ' (typical)' : ''}`),
    flavours: d.flavours, textures: d.textures, cuisine: d.cuisine, attributes: d.attributes,
    dietary: d.dietary, uncertainty: d.uncertainty,
  }));
  const occ = OCCASIONS[occasion];
  const text = [
    occ ? `<occasion>${occ.label}: ${occ.blurb}</occasion>` : '<occasion>Unknown — the diner has not said whether they are eating solo, sharing or ordering delivery.</occasion>',
    `<language>Write headline, role, whyYou, evidence text, concerns, occasionFit, cautions, orderingTip and occasionQuestion in ${language}. Keep dish names as they appear on the menu.</language>`,
    includeAdventurous ? '<adventurous>Make one of the picks an adventurous or regional option that stretches the diner a little, and give it the role label for that (in the output language). If nothing on the menu qualifies, say so in orderingTip.</adventurous>' : '',
    request ? `<today>${request}</today>` : '',
    `<profile>${JSON.stringify(profileView)}</profile>`,
    profileView.restrictionsWithheld ? '<note>The diner keeps restrictions private. Mention in orderingTip that they should check their own restrictions.</note>' : '',
    screen.length ? `<prescreen>${JSON.stringify(screen)}</prescreen>` : '',
    `<restaurant>${JSON.stringify(menu.restaurant)}</restaurant>`,
    `<menu>${JSON.stringify(dishes)}</menu>`,
  ].filter(Boolean).join('\n');
  const out = await structured({ system: RECOMMEND_SYSTEM, content: [{ type: 'text', text }], schema: RECOMMENDATION_SCHEMA, maxTokens: 16000 });
  const ids = new Set(menu.dishes.map((d) => d.id));
  out.picks = out.picks.filter((p) => ids.has(p.dishId)).slice(0, 5);
  out.cautions = out.cautions.filter((c) => ids.has(c.dishId));
  return { engine: 'ai', ...out };
}

// --- Profile import ----------------------------------------------------------

const PROFILE_SYSTEM = `You turn a person's own description of their eating habits into structured profile entries for them to review.

- Record only what they actually said. Do not generalise beyond it or add likely preferences.
- For every entry, quote the phrase that supports it in "quote".
- Dislikes are taste. Restrictions are allergies, intolerances, dietary rules (vegetarian, halal…) or things they must avoid. Do not turn a dislike into a restriction or the reverse. If an allergy's severity is unclear, use "strict".
- Prefer specific subjects ("coriander", "Sichuan peppercorn", "crispy textures") over vague ones.
- contexts: only when they tied a preference to an occasion (lunch → quick, work → office, with friends → sharing, trying new things → adventurous).
- history: specific dishes they mention having eaten, with how they felt.
- about: one short neutral sentence summarising them as an eater, or an empty string.`;

export async function parseProfile({ text }) {
  return structured({
    system: PROFILE_SYSTEM,
    content: [{ type: 'text', text: `<description>\n${text}\n</description>` }],
    schema: PROFILE_IMPORT_SCHEMA,
    maxTokens: 16000,
  });
}

export const aiInfo = () => ({ available: aiAvailable(), model: aiAvailable() ? MODEL : null });
