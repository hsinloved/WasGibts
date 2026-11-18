// Recipe ideas for weekend meal prep: checks applied after the AI answers.
//
// Food safety follows ordinary home-kitchen guidance, without alarm:
// cooked dishes keep up to 4 days in the fridge; fish, seafood and cooked
// rice are best within 2 days; everything is reheated until steaming hot
// all the way through. The model's numbers are capped to that, never raised.
// Recipes that run into a strict restriction of anyone in the household are
// dropped; others are flagged.

import { restrictionHits } from './recommend.js';

export const CUISINES = ['Taiwanese', 'Japanese', 'Korean', 'Italian', 'Mediterranean'];

const SHORT_KEEP = /\b(fish|salmon|tuna|cod|mackerel|trout|sea ?bream|seafood|shrimp|prawn|squid|octopus|mussel|clam|scallop|crab|rice|risotto|onigiri|bibimbap|fried rice|donburi|kimbap|gimbap)\b|飯|鮭|魚|蝦|밥|생선|새우/iu;
const STEAMING = 'Reheat until steaming hot all the way through.';

const text = (r) => [r.title, r.titleOriginal, ...(r.ingredients ?? []).map((i) => `${i.item} ${i.amount ?? ''}`)].join(' · ');

/** Keep-days within the standard limits; reheat advice always ends with the steaming-hot rule. */
export function safeStorage(r) {
  const short = SHORT_KEEP.test(text(r));
  const cap = short ? 2 : 4;
  const keepsDays = Math.max(1, Math.min(cap, Math.round(Number(r.keepsDays) || cap)));
  const reheat = String(r.reheat ?? '').trim();
  return {
    keepsDays,
    storage: String(r.storage ?? '').trim() || 'Cool quickly, then keep covered in the fridge.',
    reheat: /steaming|piping hot|dampfend|durcherhitz/i.test(reheat) ? reheat : [reheat, STEAMING].filter(Boolean).join(' '),
    shortKeep: short,
  };
}

/**
 * @param ideas         recipe ideas from the AI
 * @param restrictions  everyone's shared restrictions [{type, subject, severity}]
 * @param dislikes      everyone's shared dislikes ["coriander", …]
 * @returns { ideas, removed: [{title, reason}] }
 */
export function checkRecipeIdeas(ideas = [], { restrictions = [], dislikes = [] } = {}) {
  const removed = [];
  const out = [];
  for (const r of ideas) {
    if (!r?.title) continue;
    const t = text(r);
    const hits = restrictionHits(t, restrictions);
    const strict = hits.filter((h) => h.severity === 'strict');
    if (strict.length) { removed.push({ title: r.title, reason: `contains ${strict.map((h) => h.subject).join(', ')}` }); continue; }
    const disliked = dislikes.filter((d) => restrictionHits(t, [{ subject: d }]).length);
    out.push({
      ...r,
      ...safeStorage(r),
      ingredients: (r.ingredients ?? []).slice(0, 30),
      steps: (r.steps ?? []).slice(0, 15),
      allergens: [...new Set([...(r.allergens ?? []), ...hits.map((h) => h.subject)])],
      flags: [...hits.map((h) => `Has ${h.subject} (${h.type ?? 'restriction'}, flexible)`), ...disliked.map((d) => `Has ${d}, which someone would rather avoid`)],
    });
  }
  return { ideas: out, removed };
}
