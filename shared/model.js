// WasGibts data model.
//
// This module is shared verbatim between the browser (served at /shared/) and
// Node (server + tests). It has no dependencies and no I/O. Persistence lives
// behind the repository interface in public/js/store.js, so swapping
// localStorage for an authenticated API + database later only touches that file.
//
// See docs/DATA_MODEL.md for the reasoning behind each type.

export const SCHEMA_VERSION = 1;

/** How a preference came to exist. */
export const ORIGINS = /** @type {const} */ (['explicit', 'inferred']);

/**
 * Lifecycle of a preference.
 *  - active:    explicit preferences, and inferred ones the user has confirmed
 *  - suggested: inferred from feedback, awaiting the user's confirmation
 *  - dismissed: the user said "that's not me"; kept so it is not re-suggested
 */
export const STATUSES = /** @type {const} */ (['active', 'suggested', 'dismissed']);

export const POLARITIES = /** @type {const} */ (['like', 'dislike']);

export const CATEGORIES = /** @type {const} */ ([
  'ingredient', 'cuisine', 'dish', 'flavour', 'texture', 'technique', 'style', 'other',
]);

/** Restrictions are separate from dislikes: they are hard constraints, not taste. */
export const RESTRICTION_TYPES = /** @type {const} */ ([
  'allergy', 'intolerance', 'dietary', 'religious', 'avoid',
]);

export const OCCASIONS = /** @type {const} */ ({
  solo: { label: 'Solo dinner', blurb: 'Just you. Order exactly what you want.' },
  sharing: { label: 'Group sharing', blurb: 'Plates that travel well around a table.' },
  office: { label: 'Office delivery', blurb: 'Survives a commute, eats tidily at a desk.' },
  adventurous: { label: 'Adventurous', blurb: 'Stretch a little beyond the usual.' },
  quick: { label: 'Quick lunch', blurb: 'Fast, light enough for the afternoon.' },
});

/**
 * Structured feedback. `effects` is consumed by shared/profile.js; it describes
 * which inferred signals a tag produces. Tags with no effects (e.g. not_today)
 * are recorded in history but deliberately never change the profile.
 */
export const FEEDBACK = /** @type {const} */ ({
  loved:          { label: 'I loved this',             tone: 'positive', effects: [{ target: 'dish-attributes', polarity: 'like', weight: 1 }] },
  order_again:    { label: "I'd order it again",       tone: 'positive', effects: [{ target: 'dish', polarity: 'like', weight: 1.5 }] },
  liked:          { label: 'It was good',              tone: 'positive', effects: [{ target: 'dish-attributes', polarity: 'like', weight: 0.5 }] },
  too_rich:       { label: 'Too rich',                 tone: 'negative', effects: [{ target: 'style', subject: 'rich, heavy dishes', polarity: 'dislike', weight: 1 }] },
  too_spicy:      { label: 'Too spicy',                tone: 'negative', effects: [{ target: 'flavour', subject: 'strong chilli heat', polarity: 'dislike', weight: 1 }] },
  too_mild:       { label: 'Wanted more heat',         tone: 'negative', effects: [{ target: 'flavour', subject: 'chilli heat', polarity: 'like', weight: 1 }] },
  wanted_veg:     { label: 'I wanted more vegetables', tone: 'negative', effects: [{ target: 'style', subject: 'vegetable-forward dishes', polarity: 'like', weight: 1 }] },
  too_salty:      { label: 'Too salty',                tone: 'negative', effects: [{ target: 'flavour', subject: 'very salty food', polarity: 'dislike', weight: 1 }] },
  disliked:       { label: "Didn't enjoy it",          tone: 'negative', effects: [{ target: 'dish', polarity: 'dislike', weight: 1 }] },
  not_today:      { label: 'Not today',                tone: 'neutral',  effects: [] },
});

export const HISTORY_ACTIONS = /** @type {const} */ (['ordered', 'saved', 'skipped']);

// ---------------------------------------------------------------------------

export function uid(prefix = 'id') {
  const rnd = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${rnd.replace(/-/g, '').slice(0, 12)}`;
}

export const now = () => new Date().toISOString();

/** Normalise a subject so "Coriander " and "coriander" are one preference. */
export const subjectKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * @typedef {{ source: 'user_stated'|'user_confirmed'|'feedback'|'import'|'seed', note: string, at: string, ref?: string|null, weight?: number }} Evidence
 * @typedef {{ at: string, by: 'user'|'system', action: string, detail?: string }} Change
 * @typedef {{
 *   id: string, origin: 'explicit'|'inferred', status: 'active'|'suggested'|'dismissed',
 *   polarity: 'like'|'dislike', category: string, subject: string, note: string,
 *   contexts: string[], confidence: number, evidence: Evidence[], history: Change[],
 *   createdAt: string, updatedAt: string
 * }} Preference
 * @typedef {{
 *   id: string, type: string, subject: string, severity: 'strict'|'flexible', note: string,
 *   evidence: Evidence[], history: Change[], createdAt: string, updatedAt: string
 * }} Restriction
 * @typedef {{
 *   id: string, at: string, action: 'ordered'|'saved'|'skipped', occasion: string|null,
 *   restaurant: { name: string|null, url: string|null },
 *   dish: { originalName: string, translatedName: string|null, cuisine: string|null, ingredients: string[], attributes: string[], price: string|null },
 *   recommended: boolean, feedback: string[], note: string, feedbackAt: string|null
 * }} HistoryEntry
 */

/** @returns {Preference} */
export function makePreference(fields, { by = 'user', source = 'user_stated', note = 'Added by you' } = {}) {
  const t = now();
  const origin = fields.origin ?? 'explicit';
  return {
    id: fields.id ?? uid('pref'),
    origin,
    status: fields.status ?? (origin === 'explicit' ? 'active' : 'suggested'),
    polarity: fields.polarity === 'dislike' ? 'dislike' : 'like',
    category: CATEGORIES.includes(fields.category) ? fields.category : 'other',
    subject: String(fields.subject ?? '').trim(),
    note: String(fields.note ?? '').trim(),
    contexts: Array.isArray(fields.contexts) ? fields.contexts.filter((c) => c in OCCASIONS) : [],
    confidence: clamp01(fields.confidence ?? (origin === 'explicit' ? 0.9
      : Math.min(0.7, 0.15 + 0.15 * (fields.evidence ?? []).reduce((s, e) => s + (e.weight ?? 0), 0)))),
    evidence: (fields.evidence ?? [{ source, note, at: t }]).map((e) => ({ ...e, at: e.at ?? t })),
    history: fields.history ?? [{ at: t, by, action: 'created' }],
    createdAt: fields.createdAt ?? t,
    updatedAt: fields.updatedAt ?? t,
  };
}

/** @returns {Restriction} */
export function makeRestriction(fields, { by = 'user', source = 'user_stated', note = 'Added by you' } = {}) {
  const t = now();
  return {
    id: fields.id ?? uid('rst'),
    type: RESTRICTION_TYPES.includes(fields.type) ? fields.type : 'avoid',
    subject: String(fields.subject ?? '').trim(),
    severity: fields.severity === 'flexible' ? 'flexible' : 'strict',
    note: String(fields.note ?? '').trim(),
    evidence: fields.evidence ?? [{ source, note, at: t }],
    history: fields.history ?? [{ at: t, by, action: 'created' }],
    createdAt: fields.createdAt ?? t,
    updatedAt: fields.updatedAt ?? t,
  };
}

/** @returns {HistoryEntry} */
export function makeHistoryEntry(fields) {
  const d = fields.dish ?? {};
  return {
    id: fields.id ?? uid('hist'),
    at: fields.at ?? now(),
    action: HISTORY_ACTIONS.includes(fields.action) ? fields.action : 'ordered',
    occasion: fields.occasion in OCCASIONS ? fields.occasion : null,
    restaurant: { name: fields.restaurant?.name ?? null, url: fields.restaurant?.url ?? null },
    dish: {
      originalName: String(d.originalName ?? '').trim(),
      translatedName: d.translatedName ?? null,
      cuisine: d.cuisine ?? null,
      ingredients: Array.isArray(d.ingredients) ? d.ingredients.slice(0, 12) : [],
      attributes: Array.isArray(d.attributes) ? d.attributes.slice(0, 12) : [],
      price: d.price ?? null,
    },
    recommended: Boolean(fields.recommended),
    feedback: Array.isArray(fields.feedback) ? fields.feedback.filter((f) => f in FEEDBACK) : [],
    note: String(fields.note ?? ''),
    feedbackAt: fields.feedbackAt ?? null,
  };
}

export function emptyProfile() {
  const t = now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid('profile'),
    // Reserved for when accounts exist; null means "this device only".
    ownerId: null,
    createdAt: t,
    updatedAt: t,
    about: { name: '', notes: '' },
    settings: {
      // Language for translated dish names and all explanations.
      translateTo: 'English',
      // Extra short translations shown under each dish name, when useful.
      glossLanguages: [],
      // Where the user lives; frames what counts as "local" or "unfamiliar".
      homeCity: '',
      // Health-adjacent data is optional. When false, restrictions are kept on
      // this device but never sent to the AI layer.
      shareRestrictionsWithAI: true,
      // An occasion id, or 'ask' to start each menu without one and ask.
      defaultOccasion: 'solo',
      // Reserve one pick for something regional or adventurous.
      includeAdventurousPick: false,
    },
    // The user's standing instructions for recommendations, in their words
    // ("Don't assume lighter is always better"). Sent to the AI verbatim.
    guidance: /** @type {string[]} */ ([]),
    preferences: /** @type {Preference[]} */ ([]),
    restrictions: /** @type {Restriction[]} */ ([]),
    history: /** @type {HistoryEntry[]} */ ([]),
  };
}

/**
 * Accepts anything that looks like a profile (an export, a seed file, older
 * versions) and returns a well-formed one. Unknown fields are dropped.
 */
export function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a profile');
  const base = emptyProfile();
  const p = {
    ...base,
    id: raw.id ?? base.id,
    ownerId: raw.ownerId ?? null,
    createdAt: raw.createdAt ?? base.createdAt,
    updatedAt: raw.updatedAt ?? base.updatedAt,
    about: { ...base.about, ...(raw.about ?? {}) },
    settings: { ...base.settings, ...(raw.settings ?? {}) },
  };
  const seedOpts = { by: 'system', source: raw.$seed ? 'seed' : 'import', note: raw.$seed ? 'From your starting profile' : 'Imported' };
  p.preferences = (raw.preferences ?? []).map((x) => makePreference(x, seedOpts)).filter((x) => x.subject);
  p.restrictions = (raw.restrictions ?? []).map((x) => makeRestriction(x, seedOpts)).filter((x) => x.subject);
  p.history = (raw.history ?? []).map(makeHistoryEntry).filter((h) => h.dish.originalName);
  p.guidance = (Array.isArray(raw.guidance) ? raw.guidance : []).map((g) => String(g).trim()).filter(Boolean).slice(0, 40);
  if (!Array.isArray(p.settings.glossLanguages)) p.settings.glossLanguages = [];
  if (p.settings.defaultOccasion !== 'ask' && !(p.settings.defaultOccasion in OCCASIONS)) p.settings.defaultOccasion = 'solo';
  return p;
}

export function clamp01(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/** Plain-language confidence, used everywhere instead of raw numbers. */
export function confidenceLabel(c) {
  if (c >= 0.75) return 'sure';
  if (c >= 0.45) return 'fairly sure';
  return 'a hunch';
}
