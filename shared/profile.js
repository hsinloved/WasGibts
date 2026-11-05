// Pure operations on a taste profile. Every function mutates the profile it is
// given and returns something useful; callers (the store) persist afterwards.
//
// Ground rules this file enforces:
//  1. Explicit preferences only come from the user.
//  2. Inferred preferences only come from feedback on dishes the user actually
//     ordered. Seeing, or being recommended, a dish changes nothing.
//  3. Inferred preferences stay "suggested", with capped confidence, until the
//     user confirms them. Dismissed ones are never resurrected.
//  4. Every change leaves an entry in the preference's history.

import {
  FEEDBACK, OCCASIONS, makeHistoryEntry, makePreference, makeRestriction,
  now, subjectKey, confidenceLabel,
} from './model.js';

/** Confidence ceiling for anything the user has not confirmed. */
export const INFERRED_CAP = 0.7;
const CONFIRMED_FLOOR = 0.85;

const touch = (profile) => { profile.updatedAt = now(); return profile; };
const log = (item, action, detail, by = 'user') => {
  item.history.push({ at: now(), by, action, ...(detail ? { detail } : {}) });
  item.updatedAt = now();
};

export function findPreference(profile, { subject, polarity }) {
  const key = subjectKey(subject);
  return profile.preferences.find((p) => subjectKey(p.subject) === key && p.polarity === polarity);
}

// --- Explicit preferences ---------------------------------------------------

export function addPreference(profile, fields) {
  if (!String(fields.subject ?? '').trim()) throw new Error('A preference needs a subject');
  const existing = findPreference(profile, { subject: fields.subject, polarity: fields.polarity ?? 'like' });
  if (existing) {
    // Stating something we had only inferred promotes it.
    if (existing.origin === 'inferred' || existing.status !== 'active') {
      existing.origin = 'explicit';
      existing.status = 'active';
      existing.confidence = Math.max(existing.confidence, 0.9);
      existing.evidence.push({ source: 'user_stated', note: 'You added this yourself', at: now() });
      log(existing, 'stated', 'You added this directly');
    }
    if (fields.note) existing.note = fields.note;
    if (fields.contexts) existing.contexts = fields.contexts.filter((c) => c in OCCASIONS);
    touch(profile);
    return existing;
  }
  const pref = makePreference({ ...fields, origin: 'explicit' });
  profile.preferences.push(pref);
  touch(profile);
  return pref;
}

const EDITABLE = ['subject', 'polarity', 'category', 'note', 'contexts', 'confidence'];

export function updatePreference(profile, id, patch) {
  const pref = profile.preferences.find((p) => p.id === id);
  if (!pref) throw new Error('Preference not found');
  const changes = [];
  for (const k of EDITABLE) {
    if (!(k in patch)) continue;
    const before = JSON.stringify(pref[k]);
    const after = JSON.stringify(patch[k]);
    if (before === after) continue;
    pref[k] = k === 'contexts' ? patch[k].filter((c) => c in OCCASIONS) : patch[k];
    changes.push(`${k}: ${fmt(JSON.parse(before))} → ${fmt(patch[k])}`);
  }
  if (changes.length) {
    // A user correcting an inferred preference is the user speaking.
    if (pref.origin === 'inferred') {
      pref.origin = 'explicit';
      pref.status = 'active';
      pref.confidence = Math.max(pref.confidence, CONFIRMED_FLOOR);
    }
    log(pref, 'corrected', changes.join('; '));
    touch(profile);
  }
  return pref;
}

const fmt = (v) => (Array.isArray(v) ? (v.join(', ') || 'none') : typeof v === 'number' ? confidenceLabel(v) : String(v));

/** The user says an inferred pattern is right. */
export function confirmPreference(profile, id) {
  const pref = profile.preferences.find((p) => p.id === id);
  if (!pref) throw new Error('Preference not found');
  pref.status = 'active';
  pref.confidence = Math.max(pref.confidence, CONFIRMED_FLOOR);
  pref.evidence.push({ source: 'user_confirmed', note: 'You confirmed this', at: now() });
  log(pref, 'confirmed', 'You confirmed this pattern');
  touch(profile);
  return pref;
}

/** The user says "that's not me". Kept, so the same pattern is not suggested again. */
export function dismissPreference(profile, id) {
  const pref = profile.preferences.find((p) => p.id === id);
  if (!pref) throw new Error('Preference not found');
  pref.status = 'dismissed';
  log(pref, 'dismissed', 'You said this is not right');
  touch(profile);
  return pref;
}

export function restorePreference(profile, id) {
  const pref = profile.preferences.find((p) => p.id === id);
  if (!pref) throw new Error('Preference not found');
  pref.status = pref.origin === 'explicit' ? 'active' : 'suggested';
  log(pref, 'restored');
  touch(profile);
  return pref;
}

export function removePreference(profile, id) {
  const before = profile.preferences.length;
  profile.preferences = profile.preferences.filter((p) => p.id !== id);
  if (profile.preferences.length !== before) touch(profile);
}

// --- Restrictions (allergies etc. — not taste) -------------------------------

export function addRestriction(profile, fields) {
  if (!String(fields.subject ?? '').trim()) throw new Error('A restriction needs a subject');
  const r = makeRestriction(fields);
  profile.restrictions.push(r);
  touch(profile);
  return r;
}

export function updateRestriction(profile, id, patch) {
  const r = profile.restrictions.find((x) => x.id === id);
  if (!r) throw new Error('Restriction not found');
  const changes = [];
  for (const k of ['subject', 'type', 'severity', 'note']) {
    if (k in patch && patch[k] !== r[k]) { changes.push(`${k}: ${r[k]} → ${patch[k]}`); r[k] = patch[k]; }
  }
  if (changes.length) { log(r, 'corrected', changes.join('; ')); touch(profile); }
  return r;
}

export function removeRestriction(profile, id) {
  profile.restrictions = profile.restrictions.filter((r) => r.id !== id);
  touch(profile);
}

// --- Food history and feedback -----------------------------------------------

/**
 * Record that a dish was ordered, saved or skipped. This alone never changes
 * any preference — only feedback does.
 */
export function recordHistory(profile, fields) {
  const entry = makeHistoryEntry(fields);
  if (!entry.dish.originalName) throw new Error('A history entry needs a dish name');
  profile.history.unshift(entry);
  touch(profile);
  return entry;
}

/**
 * Turn a feedback tag on a dish into the signals it implies. Exported for
 * tests and for the UI ("this will teach WasGibts that...").
 */
export function signalsFor(tag, dish) {
  const def = FEEDBACK[tag];
  if (!def) return [];
  const out = [];
  const dishName = dish.translatedName || dish.originalName;
  for (const e of def.effects) {
    if (e.target === 'dish') {
      out.push({ category: 'dish', subject: dishName, polarity: e.polarity, weight: e.weight });
    } else if (e.target === 'dish-attributes') {
      // Spread the weight: one dish is weak evidence about any single ingredient.
      const parts = [
        ...dish.ingredients.slice(0, 3).map((s) => ({ category: 'ingredient', subject: s })),
        ...(dish.cuisine ? [{ category: 'cuisine', subject: dish.cuisine }] : []),
        ...dish.attributes.slice(0, 3).map((s) => ({ category: 'style', subject: s })),
      ];
      for (const p of parts) out.push({ ...p, polarity: e.polarity, weight: e.weight * 0.5 });
    } else {
      out.push({ category: e.target, subject: e.subject, polarity: e.polarity, weight: e.weight });
    }
  }
  return out;
}

/**
 * Set the feedback tags for a history entry, replacing any earlier feedback on
 * it (so re-rating is idempotent), and update inferred preferences.
 */
export function applyFeedback(profile, historyId, tags, note = '') {
  const entry = profile.history.find((h) => h.id === historyId);
  if (!entry) throw new Error('History entry not found');
  if (entry.action !== 'ordered') entry.action = 'ordered'; // feedback implies they had it

  withdrawEvidence(profile, historyId);
  entry.feedback = tags.filter((t) => t in FEEDBACK);
  entry.note = note;
  entry.feedbackAt = now();

  const label = entry.dish.translatedName || entry.dish.originalName;
  const touched = [];
  for (const tag of entry.feedback) {
    for (const sig of signalsFor(tag, entry.dish)) {
      const evidence = {
        source: 'feedback', ref: historyId, weight: sig.weight, at: now(),
        note: `${FEEDBACK[tag].label} — ${label}${entry.restaurant.name ? ` at ${entry.restaurant.name}` : ''}`,
      };
      let pref = findPreference(profile, sig);
      if (!pref) {
        pref = makePreference(
          { origin: 'inferred', status: 'suggested', category: sig.category, subject: sig.subject, polarity: sig.polarity, confidence: 0, evidence: [] },
          { by: 'system' },
        );
        pref.history = [{ at: now(), by: 'system', action: 'noticed', detail: `From your feedback on ${label}` }];
        profile.preferences.push(pref);
      }
      pref.evidence.push(evidence);
      touched.push(pref);
    }
  }
  for (const p of new Set(touched)) rescore(p, `Feedback on ${label}`);
  touch(profile);
  return { entry, touched: [...new Set(touched)] };
}

/** Delete a history entry and everything it taught the profile. */
export function removeHistory(profile, historyId) {
  withdrawEvidence(profile, historyId);
  profile.history = profile.history.filter((h) => h.id !== historyId);
  touch(profile);
}

function withdrawEvidence(profile, historyId) {
  for (const pref of profile.preferences) {
    const before = pref.evidence.length;
    pref.evidence = pref.evidence.filter((e) => e.ref !== historyId);
    if (pref.evidence.length !== before) rescore(pref, 'Feedback withdrawn or changed');
  }
  // An inferred suggestion with nothing left behind it should disappear.
  profile.preferences = profile.preferences.filter(
    (p) => !(p.origin === 'inferred' && p.status === 'suggested' && p.evidence.length === 0),
  );
}

export function feedbackScore(pref) {
  return pref.evidence.filter((e) => e.source === 'feedback').reduce((s, e) => s + (e.weight ?? 1), 0);
}

function rescore(pref, reason) {
  if (pref.origin !== 'inferred' || pref.status === 'active') {
    log(pref, 'evidence', reason, 'system');
    return;
  }
  const before = pref.confidence;
  pref.confidence = Math.min(INFERRED_CAP, 0.15 + 0.15 * feedbackScore(pref));
  if (confidenceLabel(before) !== confidenceLabel(pref.confidence)) {
    log(pref, 'confidence', `${confidenceLabel(before)} → ${confidenceLabel(pref.confidence)} (${reason})`, 'system');
  } else {
    log(pref, 'evidence', reason, 'system');
  }
}

/**
 * An inferred preference is worth surfacing once it rests on more than one
 * light signal. Below this it is still stored, just not shown as a pattern.
 */
export const isEmerging = (pref) => pref.origin === 'inferred' && feedbackScore(pref) < 1;

// --- Views --------------------------------------------------------------------

/**
 * The compact view of a profile that is sent to the AI layer. The profile
 * itself never leaves the device except through this function.
 */
export function profileForAI(profile, { occasion } = {}) {
  const prefs = profile.preferences
    .filter((p) => p.status !== 'dismissed')
    .filter((p) => !isEmerging(p))
    .filter((p) => !p.contexts.length || !occasion || p.contexts.includes(occasion))
    .map((p) => ({
      id: p.id,
      [p.polarity]: p.subject,
      category: p.category,
      source: p.origin === 'explicit' ? 'stated by user' : (p.status === 'active' ? 'confirmed pattern' : 'unconfirmed pattern from feedback'),
      confidence: confidenceLabel(p.confidence),
      ...(p.contexts.length ? { onlyFor: p.contexts } : {}),
      ...(p.note ? { note: p.note } : {}),
    }));

  const restrictions = profile.settings.shareRestrictionsWithAI
    ? profile.restrictions.map((r) => ({ id: r.id, type: r.type, subject: r.subject, severity: r.severity, ...(r.note ? { note: r.note } : {}) }))
    : null;

  const recent = profile.history
    .filter((h) => h.action === 'ordered')
    .slice(0, 15)
    .map((h) => ({
      dish: h.dish.translatedName ? `${h.dish.originalName} (${h.dish.translatedName})` : h.dish.originalName,
      ...(h.restaurant.name ? { at: h.restaurant.name } : {}),
      feedback: h.feedback.map((t) => FEEDBACK[t].label),
      ...(h.note ? { note: h.note } : {}),
    }));

  return {
    about: profile.about.notes || undefined,
    preferences: prefs,
    restrictions,
    restrictionsWithheld: !profile.settings.shareRestrictionsWithAI && profile.restrictions.length > 0,
    recentOrders: recent,
  };
}

export function exportProfile(profile) {
  return { ...structuredClone(profile), exportedAt: now(), format: 'wasgibts-profile' };
}
