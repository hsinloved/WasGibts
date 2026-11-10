// Deterministic recommender. It runs in the browser when no AI key is
// configured or the AI call fails, and it is also used to pre-screen
// restrictions before the AI sees the menu. It returns the same shape as the
// AI layer (see lib/schemas.js → RECOMMENDATION_SCHEMA).
//
// It can only say things it can point at: a stated preference, a confirmed or
// suggested pattern, a past order, or a word on the menu.

import { FEEDBACK, OCCASIONS, subjectKey, confidenceLabel } from './model.js';
import { isEmerging, isUnverifiedPrior } from './profile.js';
import { dishText } from './menu.js';

const OCCASION_RULES = {
  solo: { plus: [], minus: [] },
  sharing: { plus: ['shareable'], minus: ['soup', 'messy'] },
  office: { plus: ['travels-well'], minus: ['soup', 'raw', 'fried', 'messy'] },
  delivery: { plus: ['travels-well'], minus: ['fried', 'raw'] },
  adventurous: { plus: ['unusual', 'fermented'], minus: [] },
  quick: { plus: ['quick', 'light'], minus: ['filling', 'rich', 'braised'] },
};

/** Only what the menu itself says. */
function menuText(d) {
  return [d.originalName, d.translatedName, d.menuDescription, ...d.ingredients.filter((x) => x.source === 'menu').map((x) => x.name),
    ...d.preparation.filter((x) => x.source === 'menu').map((x) => x.method), ...d.dietary.menuStated].filter(Boolean).join(' · ').toLowerCase();
}

const STOP = new Set(['and', 'with', 'the', 'other', 'another', 'dishes', 'dish', 'food', 'options', 'meals', 'places', 'some', 'any', 'for']);
const words = (s) => subjectKey(s).split(/[^\p{L}\p{N}%-]+/u).filter((w) => w.length > 2 && !STOP.has(w));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Whole-word match, plurals allowed: "fish" matches "fish" and "fishes" but not
 * "shellfish" or "fish-fragrant" (a seasoning style with no fish in it).
 */
const has = (text, w) => new RegExp(`(^|[^\\p{L}-])${escape(w)}(s|es)?(?![\\p{L}-])`, 'u').test(text);

/** Does this preference's subject show up in the dish? Returns the matched words. */
// Specific things (a dish, an ingredient, a cuisine) must be named; only broad
// descriptions ("rich, heavy dishes", "spicy food") may match a dish's labels.
const SPECIFIC = new Set(['dish', 'ingredient', 'cuisine']);

export function matches(subject, text, attributes = [], category = null) {
  const key = subjectKey(subject);
  if (!key) return null;
  if (has(text, key)) return key;
  // Phrases from feedback ("rich, heavy dishes") match on attribute words.
  const attr = SPECIFIC.has(category) ? null : attributes.find((a) => key.split(/[^a-z-]+/).includes(a));
  if (attr) return attr;
  // Multi-word subjects: every significant word must appear.
  const ws = words(key);
  if (ws.length > 1 && ws.every((w) => has(text, w))) return key;
  return null;
}

/**
 * Words menus actually use for common restrictions (English and German).
 * Matched as substrings, so compounds like "Dunkelbiersoße" are caught.
 * This is a coarse safety net; the AI layer reads menus with more nuance.
 */
export const RESTRICTION_TERMS = {
  alcohol: ['alcohol', 'alkohol', 'beer', 'bier', 'wine', 'wein', 'sekt', 'prosecco', 'champagne', 'rum', 'brandy', 'cognac', 'liqueur', 'likör', 'schnaps', 'vodka', 'whisky', 'grappa', 'marsala', 'sherry', 'sake', 'radler', 'weißbier', 'weissbier'],
  peanuts: ['peanut', 'erdnuss'],
  nuts: ['nut', 'nuss', 'almond', 'mandel', 'hazelnut', 'haselnuss', 'walnut', 'walnuss', 'cashew', 'pistachio', 'pistazie', 'pecan'],
  shellfish: ['shellfish', 'shrimp', 'prawn', 'garnele', 'crab', 'krabbe', 'lobster', 'hummer', 'scampi', 'mussel', 'muschel', 'oyster', 'auster', 'scallop', 'jakobsmuschel'],
  gluten: ['gluten', 'wheat', 'weizen', 'flour', 'mehl', 'bread', 'brot', 'breadcrumb', 'paniert', 'semmel', 'noodle', 'nudel', 'pasta', 'spätzle', 'knödel', 'barley', 'gerste', 'rye', 'roggen'],
  lactose: ['lactose', 'laktose', 'milk', 'milch', 'cream', 'sahne', 'rahm', 'butter', 'cheese', 'käse', 'yoghurt', 'joghurt', 'quark'],
  pork: ['pork', 'schwein', 'bacon', 'speck', 'ham', 'schinken', 'leberkäs', 'weißwurst', 'weisswurst', 'bratwurst'],
};

const termsFor = (subject) => {
  const key = subjectKey(subject);
  const list = RESTRICTION_TERMS[key] ?? RESTRICTION_TERMS[key.replace(/s$/, '')] ?? RESTRICTION_TERMS[`${key}s`] ?? [];
  return [key, ...list];
};

// Long terms match inside compounds (Dunkelbiersoße); short ones must be whole
// words so "rum" skips "Rumpsteak" and "ham" skips "Champignons".
const termIn = (text, t) => (t.length >= 5 ? text.includes(t)
  : new RegExp(`(^|[^\\p{L}])${escape(t)}(s|e|es)?([^\\p{L}]|$)`, 'u').test(text));

export function screenRestrictions(menu, profile) {
  const out = new Map();
  for (const d of menu.dishes) {
    const text = dishText(d);
    const printed = [d.originalName, d.menuDescription, ...d.ingredients.filter((x) => x.source === 'menu').map((x) => x.name)].filter(Boolean).join(' ').toLowerCase();
    for (const r of profile.restrictions) {
      const terms = termsFor(r.subject);
      const hit = matches(r.subject, text, d.attributes) || terms.find((t) => termIn(text, t));
      if (hit) {
        const verified = terms.some((t) => termIn(printed, t));
        out.set(d.id, [...(out.get(d.id) ?? []), { restriction: r, verified }]);
      }
    }
  }
  return out;
}

export function recommendLocally(menu, profile, context = {}) {
  const occasion = context.occasion in OCCASIONS ? context.occasion : null;
  const rules = OCCASION_RULES[occasion] ?? { plus: [], minus: [] };
  const prefs = profile.preferences.filter(
    (p) => p.status !== 'dismissed' && !isEmerging(p) && (!p.contexts.length || (occasion && p.contexts.includes(occasion))),
  );
  const flagged = screenRestrictions(menu, profile);
  const orderedAgain = new Map(
    profile.history.filter((h) => h.feedback.length).map((h) => [subjectKey(h.dish.originalName), h]),
  );

  // A preference that matches most of the menu ("Sichuan" on a Sichuan menu)
  // says something about the restaurant, not about which dish to pick.
  const texts = new Map(menu.dishes.map((d) => [d.id, { all: dishText(d), menu: menuText(d) }]));
  const broad = new Set(prefs.filter((p) => menu.dishes.length >= 4
    && menu.dishes.filter((d) => matches(p.subject, texts.get(d.id).all, d.attributes, p.category)).length / menu.dishes.length > 0.6).map((p) => p.id));

  const scored = menu.dishes.map((d) => {
    const { all: text, menu: verifiedText } = texts.get(d.id);
    const evidence = [];
    const concerns = [];
    let score = 0;

    for (const p of prefs) {
      if (broad.has(p.id)) continue;
      const hit = matches(p.subject, text, d.attributes, p.category);
      if (!hit) continue;
      const onMenu = Boolean(matches(p.subject, verifiedText, d.attributes, p.category));
      const w = (p.origin === 'explicit' ? 1 : 0.6) * (0.4 + p.confidence) * (onMenu ? 1 : 0.6);
      const how = p.origin === 'explicit' ? 'you told me' : p.status === 'active' ? 'you confirmed'
        : isUnverifiedPrior(p) ? 'you listed this as likely; not confirmed yet' : `a pattern from your feedback, ${confidenceLabel(p.confidence)}`;
      const where = onMenu ? (hit === subjectKey(p.subject) ? '' : ` — this one is ${hit}`) : ` — it usually has ${hit}, though the menu doesn’t say`;
      if (p.polarity === 'like') {
        score += w;
        evidence.push({ type: 'preference', ref: p.id, text: `You like ${p.subject} (${how})${where}.` });
      } else {
        score -= w * 1.2;
        concerns.push(`${onMenu ? 'Has' : 'Probably has'} ${hit}, and you’d rather avoid ${p.subject} (${how}).`);
      }
    }

    const past = orderedAgain.get(subjectKey(d.originalName));
    if (past) {
      const tags = past.feedback.map((t) => FEEDBACK[t].label.toLowerCase());
      const positive = past.feedback.some((t) => FEEDBACK[t].tone === 'positive');
      score += positive ? 0.8 : -0.8;
      (positive ? evidence : concerns).push(
        positive
          ? `You've had this before and said "${tags.join('", "')}".`
          : `Last time you said "${tags.join('", "')}".`,
      );
    }

    for (const a of rules.plus) if (d.attributes.includes(a)) { score += 0.5; evidence.push({ type: 'menu', ref: null, text: `Suits ${OCCASIONS[occasion].label.toLowerCase()}: ${a.replace('-', ' ')}.` }); }
    for (const a of rules.minus) if (d.attributes.includes(a)) { score -= 1; concerns.push(`Less ideal for ${OCCASIONS[occasion].label.toLowerCase()}: ${a.replace('-', ' ')}.`); }

    const hits = flagged.get(d.id) ?? [];
    const blocked = hits.some((h) => h.restriction.severity === 'strict');
    for (const h of hits) {
      concerns.unshift(`${h.verified ? 'The menu lists' : 'May contain'} ${h.restriction.subject} — your ${h.restriction.type}. Check with the staff.`);
    }

    return { d, score, evidence, concerns, blocked, hits };
  });

  const eligible = scored.filter((s) => !s.blocked).sort((a, b) => b.score - a.score);
  const withSignal = eligible.filter((s) => s.evidence.length && s.score > 0);
  const pool = (withSignal.length >= 3 ? withSignal : eligible).slice(0, 5);
  const picks = pool.slice(0, Math.max(3, Math.min(5, withSignal.length))).map((s, i) => ({
    dishId: s.d.id,
    role: i === 0 ? 'Start here' : s.concerns.length ? 'Worth considering' : 'Also a good fit',
    whyYou: s.evidence.length
      ? s.evidence.map((e) => e.text).join(' ')
      : 'Nothing in your profile points at this one yet; it is here to round out the shortlist.',
    evidence: s.evidence,
    concerns: s.concerns,
    occasionFit: occasion ? OCCASIONS[occasion].blurb : '',
  }));

  // One pick reserved for something regional or adventurous, if wanted.
  if (profile.settings?.includeAdventurousPick) {
    const chosen = new Set(picks.map((p) => p.dishId));
    const daring = eligible.find((s) => !chosen.has(s.d.id) && s.d.attributes.some((a) => a === 'unusual' || a === 'fermented'))
      ?? eligible.find((s) => !chosen.has(s.d.id) && s.d.culturalNote);
    const already = picks.find((p) => { const d = menu.dishes.find((x) => x.id === p.dishId); return d.attributes.includes('unusual'); });
    if (daring && !already) {
      const pick = {
        dishId: daring.d.id,
        role: 'A little adventure',
        whyYou: [daring.d.culturalNote ? 'Something more distinctive to try.' : 'A less familiar choice to stretch the order a little.', ...daring.evidence.map((e) => e.text)].join(' '),
        evidence: [...daring.evidence, { type: 'menu', ref: null, text: daring.d.culturalNote ?? 'Marked as unusual or fermented.' }],
        concerns: daring.concerns,
        occasionFit: occasion ? OCCASIONS[occasion].blurb : '',
      };
      if (picks.length >= 5) picks[picks.length - 1] = pick; else picks.push(pick);
    }
  }

  const cautions = scored.filter((s) => s.hits.length).map((s) => ({
    dishId: s.d.id,
    reason: s.hits.map((h) => `${h.verified ? 'Menu lists' : 'May contain'} ${h.restriction.subject} (${h.restriction.type})`).join('; '),
    restrictionId: s.hits[0].restriction.id,
  }));

  const broadLikes = prefs.filter((p) => broad.has(p.id) && p.polarity === 'like').map((p) => p.subject);
  const broadDislikes = prefs.filter((p) => broad.has(p.id) && p.polarity === 'dislike').map((p) => p.subject);
  const overall = [
    broadLikes.length && `Most of this menu fits your taste for ${broadLikes.join(' and ')}.`,
    broadDislikes.length && `Heads up: much of this menu leans on ${broadDislikes.join(' and ')}, which you’d rather avoid.`,
  ].filter(Boolean).join(' ');
  return {
    engine: 'local',
    headline: [overall, withSignal.length
      ? `${withSignal.length === 1 ? 'One dish stands' : `${withSignal.length} dishes stand`} out for you specifically.`
      : 'Nothing stands out against your profile yet, so treat these as starting points.'].filter(Boolean).join(' '),
    picks,
    cautions,
    orderingTip: null,
    occasionQuestion: occasion ? null : 'Eating solo, sharing, or ordering in? It changes which dishes travel and share well.',
  };
}
