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
import { openaiAvailable, openaiModel, openaiStructured, openaiWebSearch } from './openai.js';

const MODEL = process.env.WASGIBTS_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.WASGIBTS_EFFORT || 'medium';
// Server-side refusal fallback: if the model declines, the API reroutes to a
// recommended fallback model inside the same call. Set WASGIBTS_FALLBACKS=off to disable.
const USE_FALLBACKS = process.env.WASGIBTS_FALLBACKS !== 'off';

// Provider: AI_PROVIDER=anthropic|openai. Unset: Anthropic if its key is set,
// otherwise OpenAI if OPENAI_API_KEY is set.
const anthropicKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
export function provider() {
  const p = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (p === 'openai' || p === 'anthropic') return p;
  return !anthropicKey() && openaiAvailable() ? 'openai' : 'anthropic';
}

let client = null;
export function aiAvailable() {
  return provider() === 'openai' ? openaiAvailable() : anthropicKey();
}
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export class AIError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

async function structured({ name, system, content, schema, maxTokens = 32000 }) {
  if (provider() === 'openai') return openaiStructured({ name, system, content, schema, maxTokens, effort: EFFORT, AIError });
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

export async function extractMenu({ parts, translateTo = 'English', glossLanguages = [], homeCity = '', context = '' }) {
  const lines = [
    context,
    `Translate dish names into ${translateTo} and write every explanation, flavour, texture, preparation and note in ${translateTo}. Keep originalName exactly as printed.`,
    glossLanguages.length ? `Glosses wanted, where useful: ${glossLanguages.join(', ')}.` : 'No glosses wanted; return empty glosses lists.',
    homeCity ? `The diner lives in ${homeCity}; explain what would be unfamiliar to someone living there.` : '',
    `Allowed attributes: ${ATTRIBUTES.join(', ')}.`,
  ];
  const content = [...parts, { type: 'text', text: lines.filter(Boolean).join('\n') }];
  return structured({ name: 'menu', system: EXTRACT_SYSTEM, content, schema: MENU_SCHEMA });
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
  const out = await structured({ name: 'recommendation', system: RECOMMEND_SYSTEM, content: [{ type: 'text', text }], schema: RECOMMENDATION_SCHEMA, maxTokens: 16000 });
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
    name: 'profile_import',
    system: PROFILE_SYSTEM,
    content: [{ type: 'text', text: `<description>\n${text}\n</description>` }],
    schema: PROFILE_IMPORT_SCHEMA,
    maxTokens: 16000,
  });
}

export const aiInfo = () => ({ available: aiAvailable(), provider: aiAvailable() ? provider() : null, model: aiAvailable() ? (provider() === 'openai' ? openaiModel() : MODEL) : null });

// --- Finding a menu online (Google Maps links, blocked delivery pages) ---------

const FIND_SYSTEM = `You find where a specific restaurant publishes its menu online, so another program can read it.

- Use web search to identify the exact restaurant (match name and location; chains have many branches) and find its menu: ideally a page or PDF on the restaurant's own website, otherwise a reliable listing that shows the full menu as text.
- Prefer the restaurant's own site over aggregators. Delivery platforms (Lieferando, Wolt, Uber Eats…) usually block automated reading; list them only as a last resort.
- Only return URLs you actually saw in search results. Never guess or construct URLs.
- If you cannot identify the restaurant with confidence, say so instead of picking a similar one.

Finish your reply with a single <result> block containing JSON:
<result>{"restaurant": string|null, "address": string|null, "website": string|null, "menuUrls": string[], "confidence": "high"|"medium"|"low", "notes": string}</result>
menuUrls: up to 3, best first. notes: one short sentence for the diner (e.g. "Menu from the restaurant's website; it may differ from what is served today").`;

/** Search the web for a restaurant's menu. Returns null if search is unavailable or nothing reliable is found. */
export async function findMenuOnline({ name, address = null, lat = null, lng = null, platform = null, homeCity = '' }) {
  const where = [address, lat != null ? `coordinates ${lat.toFixed(5)}, ${lng.toFixed(5)}` : null, homeCity && !address && lat == null ? `probably near ${homeCity}` : null].filter(Boolean).join('; ');
  const question = `Find the menu of the restaurant "${name}"${where ? ` (${where})` : ''}.${platform ? ` The diner found it on ${platform}, which could not be read directly.` : ''}`;
  if (provider() === 'openai') {
    return parseFindResult(await openaiWebSearch({ system: FIND_SYSTEM, question, AIError }), { name, address });
  }
  const messages = [{ role: 'user', content: question }];
  const params = {
    model: MODEL,
    max_tokens: 8000,
    system: FIND_SYSTEM,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
    output_config: { effort: 'low' },
    ...(USE_FALLBACKS ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
  };
  let msg;
  try {
    for (let i = 0; i < 4; i++) {
      msg = await getClient().beta.messages.stream({ ...params, messages }).finalMessage();
      if (msg.stop_reason !== 'pause_turn') break;
      // Server-side search loop paused; resend so it resumes where it stopped.
      // Consecutive assistant turns are merged by the API, so earlier blocks are kept.
      messages.push({ role: 'assistant', content: msg.content });
    }
  } catch (err) {
    if (err instanceof Anthropic.APIError) return null; // e.g. web search disabled for the org
    throw err;
  }
  if (!msg || msg.stop_reason === 'refusal') return null;
  return parseFindResult(msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(''), { name, address });
}

/** The <result> JSON block both providers end their search answer with. */
export function parseFindResult(text, { name, address = null }) {
  if (!text) return null;
  const m = text.match(/<result>([\s\S]*?)<\/result>/);
  if (!m) return null;
  try {
    const r = JSON.parse(m[1]);
    const urls = (Array.isArray(r.menuUrls) ? r.menuUrls : []).filter((u) => /^https?:\/\//.test(u)).slice(0, 3);
    if (r.website && /^https?:\/\//.test(r.website) && !urls.includes(r.website)) urls.push(r.website);
    return { restaurant: r.restaurant ?? name, address: r.address ?? address, urls, confidence: r.confidence ?? 'low', notes: String(r.notes ?? '') };
  } catch {
    return null;
  }
}
