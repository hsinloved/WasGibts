// One path from "menu + profile + what the diner said" to the picks shown,
// used by the browser (and by tests): ask the AI if there is one, fall back to
// the local matcher if not or if it fails, then always run the deterministic
// checks with the full profile.

import { profileForAI } from './profile.js';
import { recommendLocally } from './recommend.js';
import { guardRecommendation, allowedRefsFrom } from './guard.js';
import { enforceSession, normalizeSession } from './session.js';
import { dishText } from './menu.js';

/**
 * @param opts.ai  async (profileView) => recommendation, or null when no AI is available
 * @returns the finished recommendation; `fallbackReason` is set when the AI failed
 */
export async function choosePicks({ menu, profile, occasion = null, session = null, ai = null }) {
  const s = normalizeSession(session);
  const view = profileForAI(profile, { occasion });
  let recs;
  let fallbackReason = null;
  if (ai) {
    try { recs = await ai(view); } catch (err) { fallbackReason = err?.message || 'unknown error'; }
  }
  if (!recs) recs = recommendLocally(menu, profile, { occasion, session: s });
  // Whatever produced the picks: enforce every restriction (including ones
  // kept private from the AI), drop evidence the profile can't back, and
  // honour "not today".
  const out = enforceSession(guardRecommendation(recs, menu, {
    restrictions: profile.restrictions,
    allowedRefs: allowedRefsFrom(view, profile.restrictions),
    session: s,
  }), menu, s, dishText);
  if (fallbackReason) out.fallbackReason = fallbackReason;
  return out;
}
