// Post-generation guard for recommendations, from the AI or the local matcher.
//
// The prompt asks the model to respect restrictions and cite its evidence, but
// a prompt is not a guarantee. This runs after generation, deterministically:
//
//  1. Strict restrictions: a pick that the restriction screen flags for a
//     strict allergy, intolerance or rule is removed and listed in cautions.
//     In the browser this uses the full profile, so restrictions the diner
//     keeps private from the AI are enforced too.
//  2. Evidence: a preference or restriction cited by id must exist in what
//     was submitted; "menu" evidence must name something actually on the
//     dish. Anything else is dropped.
//  3. Claims: sentences that state a price the menu doesn't show, or a dietary
//     assurance ("gluten-free", "vegan", "safe for…") the menu doesn't print,
//     are removed. Never invent prices, ingredients or dietary assurances.
//
// Shared verbatim by the browser and the server; no I/O.

import { screenRestrictions } from './recommend.js';
import { dishText } from './menu.js';

// Latin sentences end at punctuation followed by a space (so 12.90 € stays whole); CJK ones need no space.
const SENTENCE = /(?<=[.!?])\s+|(?<=[。！？])\s*/u;

/** Dietary assurances, in English, German and Chinese, with the word the menu must print to back them. */
const DIET_CLAIMS = [
  { re: /\b(gluten[- ]?free|glutenfrei|ohne gluten)\b|無麩質|无麸质|不含麩質|不含麸质/iu, needs: /gluten|glutenfrei|無麩質|无麸质/iu },
  { re: /\b(lactose[- ]?free|laktosefrei|dairy[- ]?free|milk[- ]?free)\b|無乳糖|无乳糖/iu, needs: /lactose|laktose|dairy|milk|無乳糖|无乳糖/iu },
  { re: /\b(nut[- ]?free|peanut[- ]?free|nussfrei)\b|無堅果|无坚果|不含花生/iu, needs: /nut|nuss|堅果|坚果|花生/iu },
  { re: /\b(vegan)\b|全素|純素|纯素/iu, needs: /vegan|全素|純素|纯素/iu },
  { re: /\b(vegetarian|vegetarisch|meat[- ]?free|fleischlos)\b|素食|蛋奶素/iu, needs: /vegetar|vegan|veggie|\bv\b|素/iu },
  { re: /\b(halal|kosher|koscher)\b|清真/iu, needs: /halal|kosher|koscher|清真/iu },
  // Always unbacked: nothing on a menu can promise safety.
  { re: /\b(allergen[- ]?free|allergenfrei|safe (for|to eat|with)|completely safe|no allergens|unbedenklich)\b|無過敏原|无过敏原|安全/iu, needs: null },
];

const PRICE = /(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:€|eur\b|euro)|€\s?(\d{1,4}(?:[.,]\d{1,2})?)/giu;
const num = (s) => Number(String(s).replace(',', '.'));

/** Prices a dish legitimately has: its amount and any number in its printed price. */
function dishPrices(d) {
  const out = new Set();
  if (d?.price?.amount != null) out.add(d.price.amount);
  for (const m of String(d?.price?.display ?? '').matchAll(/\d+(?:[.,]\d+)?/g)) out.add(num(m[0]));
  return out;
}

/** Is a sentence free of invented prices and unbacked dietary assurances for this dish (or no dish)? */
function sentenceOk(sentence, d) {
  for (const m of sentence.matchAll(PRICE)) {
    const value = num(m[1] ?? m[2]);
    if (!d || !dishPrices(d).has(value)) return false;
  }
  const printed = d ? d.dietary.menuStated.join(' ') + ' ' + (d.menuDescription ?? '') + ' ' + d.originalName : '';
  for (const c of DIET_CLAIMS) {
    if (c.re.test(sentence) && (!c.needs || !c.needs.test(printed))) return false;
  }
  return true;
}

/** Remove the offending sentences from a text. Returns [text, removedCount]. */
export function scrub(text, d) {
  if (!text) return [text, 0];
  const parts = String(text).split(SENTENCE).filter((x) => x.trim());
  const kept = parts.filter((p) => sentenceOk(p, d));
  return [kept.join(' ').trim(), parts.length - kept.length];
}

/** Sentences that claim something about the diner's taste. */
const PERSONAL = /\byou(?:'ve| have)? (?:like|love|enjoy|prefer|adore|told|said|mentioned|listed|confirmed|seemed|usually|always|often)|\byour (?:taste|favourite|favorite|preference)|\bdu (?:magst|liebst|isst gern)|你(?:喜歡|喜欢|愛|爱|偏好|說過|说过)/iu;

/** Without backing evidence, drop personal-taste sentences from a text. */
function unbacked(text) {
  if (!text) return [text, 0];
  const parts = String(text).split(SENTENCE).filter((x) => x.trim());
  const kept = parts.filter((x) => !PERSONAL.test(x));
  return [kept.join(' ').trim(), parts.length - kept.length];
}

const STOP = new Set(['this', 'that', 'with', 'from', 'menu', 'says', 'listed', 'lists', 'dish', 'served', 'comes', 'made', 'here', 'very', 'also', 'which', 'their', 'there', 'about', 'suits', 'mit', 'und', 'oder', 'auf', 'der', 'die', 'das', 'ein', 'eine']);
/** Does "menu" evidence name at least one thing the dish actually has? */
function grounded(text, d) {
  const hay = [dishText(d), d.culturalNote, d.section, ...d.dietary.menuStated].filter(Boolean).join(' · ').toLowerCase();
  const words = String(text).toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter((w) => w.length >= 4 && !STOP.has(w));
  // CJK has no spaces: accept a match on any 2-character run.
  const cjk = [...String(text).matchAll(/[㐀-鿿]{2,}/gu)].flatMap((m) => [...m[0]].slice(0, -1).map((_, i) => m[0].slice(i, i + 2)));
  return words.some((w) => hay.includes(w)) || cjk.some((w) => hay.includes(w));
}

/**
 * @param recs       the recommendation (AI or local shape)
 * @param menu       the normalised menu the picks refer to
 * @param opts.restrictions  restrictions to enforce (full list in the browser)
 * @param opts.allowedRefs   ids that evidence may cite (preferences + restrictions); null skips the check
 * @returns a new recommendation with a `guard` report: { removed: [{dishId, reason}], droppedEvidence, strippedClaims }
 */
export function guardRecommendation(recs, menu, { restrictions = [], allowedRefs = null } = {}) {
  const byId = new Map(menu.dishes.map((d) => [d.id, d]));
  const flagged = screenRestrictions(menu, { restrictions });
  const report = { removed: [], droppedEvidence: 0, strippedClaims: 0 };
  const cautions = [...(recs.cautions ?? [])].filter((c) => byId.has(c.dishId));

  const picks = [];
  for (const p of recs.picks ?? []) {
    const d = byId.get(p.dishId);
    if (!d) { report.removed.push({ dishId: p.dishId, kind: 'unknown-dish', reason: 'not on this menu' }); continue; }
    const strict = (flagged.get(d.id) ?? []).filter((h) => h.restriction.severity === 'strict');
    if (strict.length) {
      const what = strict.map((h) => `${h.restriction.subject} (${h.restriction.type})`).join(', ');
      report.removed.push({ dishId: d.id, kind: 'restriction', reason: `${strict[0].verified ? 'the menu lists' : 'may contain'} ${what}` });
      if (!cautions.some((c) => c.dishId === d.id)) {
        cautions.push({ dishId: d.id, reason: `${strict[0].verified ? 'Menu lists' : 'May contain'} ${what}`, restrictionId: strict[0].restriction.id ?? null });
      }
      continue;
    }
    const evidence = [];
    for (const e of p.evidence ?? []) {
      const cites = e.type === 'preference' || e.type === 'restriction';
      if (cites && (!e.ref || (allowedRefs && !allowedRefs.has(e.ref)))) { report.droppedEvidence++; continue; }
      if (e.type === 'menu' && !grounded(e.text, d)) { report.droppedEvidence++; continue; }
      const [text, n] = scrub(e.text, d); report.strippedClaims += n;
      if (text) evidence.push({ ...e, text }); else report.droppedEvidence++;
    }
    let [whyYou, n1] = scrub(p.whyYou, d);
    // A claim about the diner's taste needs a surviving preference or history item.
    if (!evidence.some((e) => e.type === 'preference' || e.type === 'history')) {
      const [w, n] = unbacked(whyYou); whyYou = w; n1 += n;
    }
    const [occasionFit, n2] = scrub(p.occasionFit, d);
    const concerns = (p.concerns ?? []).map((c) => scrub(c, d)).filter(([t, n]) => { report.strippedClaims += n; return t; }).map(([t]) => t);
    report.strippedClaims += n1 + n2;
    picks.push({
      ...p,
      whyYou: whyYou || (evidence.length ? evidence.map((e) => e.text).join(' ') : 'On the shortlist from the menu itself; no personal reason could be verified.'),
      occasionFit: occasionFit ?? '',
      evidence,
      concerns,
    });
  }

  const [orderingTip, n3] = scrub(recs.orderingTip, null);
  const [headline, n4] = scrub(recs.headline, null);
  report.strippedClaims += n3 + n4;
  return { ...recs, headline: headline ?? '', picks, cautions, orderingTip: orderingTip || null, guard: report };
}

/** The ids evidence may cite, from what was actually submitted. */
export function allowedRefsFrom(profileView, restrictions = []) {
  return new Set([
    ...(profileView?.preferences ?? []).map((p) => p.id),
    ...(profileView?.restrictions ?? []).map((r) => r.id),
    ...restrictions.map((r) => r.id),
  ].filter(Boolean));
}
