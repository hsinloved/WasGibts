// Session context: what the diner wants *right now*, for this menu only.
//
// "I've already eaten", "something starchy", "actually, no fish today"… are
// read into a small structure that the recommenders use. It lives in the
// browser session with the menu, resets with a new menu, and never writes to
// the profile. Statements that sound permanent ("I never eat coriander")
// become *suggestions* the diner can tap to save; nothing is saved for them.
//
// Each statement is classified as one of:
//   context     new information about the situation (hunger, sharing, novelty)
//   craving     a temporary want or a temporary "not today"
//   correction  overrides something said earlier in the session
//   durable     sounds like a lasting taste fact → offered as a profile update
//   unclear     nothing recognised; passed to the AI as written
//
// Pure and shared by browser and server; English and German phrasings.

import { subjectKey } from './model.js';

// --- Vocabulary ----------------------------------------------------------------

/** Food groups a craving or "not today" can name, with the words that identify a dish. */
export const FOOD_GROUPS = {
  starchy: { noun: 'starchy food', label: 'something starchy', words: ['noodle', 'nudel', 'rice', 'reis', 'bread', 'brot', 'pita', 'naan', 'fladenbrot', 'dumpling', 'knödel', 'kloß', 'klöße', 'potato', 'kartoffel', 'pommes', 'fries', 'pasta', 'spätzle', 'spaetzle', 'pancake', 'pfannkuchen', 'semmel', 'bun', 'wrap', 'couscous', 'bulgur', 'polenta', 'gnocchi', 'risotto', 'mian', 'baozi', 'jiaozi', 'udon', 'ramen', 'pide', 'lasagne', 'lasagna'], attributes: ['filling'] },
  protein: { noun: 'protein', label: 'more protein', words: ['chicken', 'huhn', 'hähnchen', 'hühn', 'beef', 'rind', 'pork', 'schwein', 'lamb', 'lamm', 'duck', 'ente', 'tofu', 'egg', ' ei ', 'eier', 'fish', 'fisch', 'salmon', 'lachs', 'shrimp', 'prawn', 'garnele', 'octopus', 'oktopus', 'squid', 'calamari', 'halloumi', 'feta', 'lentil', 'linsen', 'chickpea', 'kichererbse', 'bean', 'bohne', 'steak', 'schnitzel', 'braten', 'souvlaki', 'gyros', 'kebab', 'kofta', 'meat', 'fleisch', 'sausage', 'wurst', 'paneer'], attributes: ['meat-heavy', 'seafood'] },
  vegetables: { noun: 'vegetables', label: 'vegetables', words: ['vegetable', 'veggie', 'gemüse', 'salad', 'salat', 'greens', 'spinach', 'spinat', 'aubergine', 'eggplant', 'zucchini', 'courgette', 'cucumber', 'gurke', 'bean', 'bohne', 'okra', 'cauliflower', 'blumenkohl', 'broccoli', 'brokkoli', 'pepper', 'paprika', 'tomato', 'tomate', 'mushroom', 'pilz'], attributes: ['vegetable-forward'] },
  warm: { noun: 'warm dishes', label: 'something warm', words: ['soup', 'suppe', 'stew', 'eintopf', 'curry', 'braised', 'geschmort', 'baked', 'überbacken', 'grilled', 'gegrillt', 'roast', 'braten', 'hot pot', 'casserole', 'auflauf'], attributes: ['soup', 'braised', 'grilled', 'fried'] },
  sweet: { noun: 'sweets', label: 'something sweet', words: ['dessert', 'nachtisch', 'cake', 'kuchen', 'torte', 'ice cream', 'eis', 'chocolate', 'schoko', 'baklava', 'pudding', 'strudel', 'kaiserschmarrn', 'crêpe', 'crepe', 'waffle', 'waffel', 'sweet'], attributes: ['sweet'] },
  spicy: { noun: 'spicy food', label: 'something spicy', words: ['spicy', 'scharf', 'chilli', 'chili', 'hot sauce'], attributes: ['spicy'] },
  fish: { noun: 'fish', label: 'fish', words: ['fish', 'fisch', 'salmon', 'lachs', 'tuna', 'thunfisch', 'cod', 'kabeljau', 'trout', 'forelle', 'sea bream', 'dorade', 'bream', 'bass', 'barsch', 'zander', 'pangasius', 'sardine', 'mackerel', 'makrele', 'herring', 'hering', 'swordfish', 'schwertfisch', 'fillet of', 'filet vom'], attributes: [] },
  seafood: { noun: 'seafood', label: 'seafood', words: ['seafood', 'meeresfrüchte', 'shrimp', 'prawn', 'garnele', 'scampi', 'octopus', 'oktopus', 'squid', 'calamari', 'tintenfisch', 'mussel', 'muschel', 'clam', 'crab', 'krabbe', 'lobster', 'hummer', 'oyster', 'auster'], attributes: ['seafood'] },
  meat: { noun: 'meat', label: 'meat', words: ['meat', 'fleisch', 'beef', 'rind', 'pork', 'schwein', 'lamb', 'lamm', 'chicken', 'huhn', 'hähnchen', 'duck', 'ente', 'veal', 'kalb', 'sausage', 'wurst', 'bacon', 'speck', 'ham', 'schinken', 'steak', 'schnitzel', 'gyros', 'souvlaki', 'kebab'], attributes: ['meat-heavy'] },
  rich: { noun: 'rich food', label: 'something rich', words: ['creamy', 'cream', 'sahne', 'rahm', 'cheese', 'käse', 'butter'], attributes: ['rich', 'creamy'] },
  fried: { noun: 'fried food', label: 'fried food', words: ['fried', 'frittiert', 'gebacken', 'paniert', 'crispy', 'knusprig', 'tempura'], attributes: ['fried'] },
};

/**
 * Words that name a whole food group in what people say. Specific foods
 * ("noodles", "rice", "coriander") are not groups: they are matched as
 * themselves, so "no noodles" does not also rule out bread and potatoes.
 */
const GROUP_WORDS = [
  ['starchy', /\b(starch\w*|carbs?|carbohydrates?|kohlenhydrat\w*|stärke\w*|sättigungsbeilage|beilage)\b/u],
  ['protein', /\b(protein\w*|eiweiß|eiweiss)\b/u],
  ['vegetables', /\b(vegetables?|veggies?|veg|gemüse|greens)\b/u],
  ['warm', /\b(warm|hot meal|comfort(?:ing)? food|something hot|wärmend\w*)\b/u],
  ['sweet', /\b(dessert|sweets?|nachtisch|süß\w*|suess\w*)\b/u],
  ['spicy', /\b(spicy|scharf\w*)\b/u],
  ['fish', /\b(fish|fisch)\b/u],
  ['seafood', /\b(seafood|meeresfrüchte|shellfish)\b/u],
  ['meat', /\b(meat|fleisch)\b/u],
  ['rich', /\b(rich|heavy|creamy|schwer\w*|deftig\w*)\b/u],
  ['fried', /\b(fried|frittiert\w*|deep[- ]fried)\b/u],
];

const NEGATION = /\b(no|not|don'?t|do not|never|without|skip|nothing|none|less|kein\w*|nicht|ohne|keine lust)\b/u;
const LEAD = /^\s*(?:oh,?\s+)?(?:actually|eigentlich|instead|scratch that|forget (?:that|it)|never ?mind|no wait|doch|lieber doch|stattdessen|ach nee|change of plan|ok(?:ay)?|hmm+|also|so|well|na ja)\b[,\s]*/u;
const CORRECTION = /^\s*(actually|eigentlich|instead|scratch that|forget (?:that|it)|never ?mind|no wait|oh,? and actually|doch|lieber doch|stattdessen|ach nee|change of plan)\b/u;
const DURABLE = /\b(never eat|i never|i hate|i love|i don'?t eat|i can'?t stand|i hate|i'?m allergic|allergic to|from now on|always|in general|generally|i'?ve stopped eating|i no longer eat|ich esse (?:nie|kein\w*)|ich vertrage kein\w*|grundsätzlich|ab (?:jetzt|sofort)|immer|nie wieder)\b/u;
const ALLERGY = /\b(allerg\w*|intoleran\w*|vertrage)\b/u;
const TEMPORARY = /\b(today|tonight|right now|this time|at the moment|heute|gerade|jetzt|diesmal)\b/u;

const SITUATIONS = [
  { dim: 'hunger', value: 'ate', re: /\b(already (?:ate|eaten|had (?:dinner|lunch|food|something))|had (?:dinner|lunch) already|(?:schon|bereits) (?:gegessen|was gegessen)|just (?:a|for a) (?:snack|nibble)|nur (?:eine )?kleinigkeit|only a little)\b/u },
  { dim: 'hunger', value: 'light', re: /\b(not (?:very|that|so|too) hungry|a bit hungry|something (?:light|small)|light (?:meal|lunch)|nicht (?:so|sehr) hungrig|leicht\w*|etwas kleines)\b/u },
  { dim: 'hunger', value: 'hungry', re: /\b(starving|really hungry|very hungry|so hungry|ravenous|big appetite|großen hunger|riesenhunger|sehr hungrig|bärenhunger)\b/u },
  { dim: 'sharing', value: 'partner', re: /\b(share (?:some of )?(?:my |his |her )?(?:partner|friend|husband|wife|boyfriend|girlfriend|date)'?s?|(?:partner|friend|husband|wife|boyfriend|girlfriend)'?s? (?:food|plate|dish)|probier\w* bei|vom teller)\b/u },
  { dim: 'sharing', value: 'group', re: /\b(we(?:'re| are) sharing|for the table|sharing (?:with|for) (?:the )?(?:group|everyone|friends|colleagues)|for (?:two|three|four|2|3|4) (?:people|of us)|zum teilen|wir teilen|zu (?:zweit|dritt|viert))\b/u },
  { dim: 'sharing', value: 'solo', re: /\b(just (?:me|for me)|only for me|not sharing|alone|allein|nur für mich)\b/u },
  { dim: 'novelty', value: 'adventurous', re: /\b(something (?:new|different|unusual)|surprise me|adventurous|try something|überrasch\w*|was neues|etwas neues|abenteuer\w*)\b/u },
  { dim: 'novelty', value: 'familiar', re: /\b(something (?:familiar|safe|simple|classic)|nothing (?:weird|too adventurous|fancy)|comfort zone|vertraut\w*|klassisch\w*|nichts ausgefallenes)\b/u },
];

const LABELS = {
  hunger: { ate: 'already eaten', light: 'not very hungry', hungry: 'very hungry' },
  sharing: { partner: 'can share a partner’s food', group: 'sharing at the table', solo: 'just for me' },
  novelty: { adventurous: 'something new', familiar: 'something familiar' },
};

// --- State -----------------------------------------------------------------------

export function emptySession() {
  return { hunger: null, sharing: null, novelty: null, cravings: [], avoid: [], log: [] };
}

/** Accept anything session-shaped (from storage or the network) and return a clean one. */
export function normalizeSession(raw) {
  const s = emptySession();
  if (!raw || typeof raw !== 'object') return s;
  if (LABELS.hunger[raw.hunger]) s.hunger = raw.hunger;
  if (LABELS.sharing[raw.sharing]) s.sharing = raw.sharing;
  if (LABELS.novelty[raw.novelty]) s.novelty = raw.novelty;
  const keys = (v) => [...new Set((Array.isArray(v) ? v : []).map((k) => String(k)).filter((k) => k in FOOD_GROUPS || /^[\p{L} -]{2,30}$/u.test(k)))].slice(0, 8);
  s.cravings = keys(raw.cravings);
  s.avoid = keys(raw.avoid);
  s.log = (Array.isArray(raw.log) ? raw.log : []).slice(-12).map((e) => ({
    text: String(e?.text ?? '').slice(0, 300), kind: String(e?.kind ?? 'unclear'), changes: Array.isArray(e?.changes) ? e.changes.slice(0, 10) : [], unparsed: Array.isArray(e?.unparsed) ? e.unparsed.slice(0, 5).map(String) : [],
  }));
  return s;
}

const clauses = (text) => String(text).toLowerCase().replace(/[’]/g, "'")
  .split(/[.;!?\n]+|,(?![^(]*\))|\b(?:and|but|also|plus|aber|und|außerdem)\b/u)
  .map((c) => c.trim()).filter(Boolean);

/** Free-text foods named after "no/without/want/never eat …", for things outside the groups (e.g. "coriander"). */
const NAMED = /\b(?:no|without|skip|not|kein\w*|ohne|keine lust auf|craving|want|fancy|feel like|in the mood for|i'?d like|i like|i love|i hate|never eat|don'?t eat|can'?t stand|lust auf|hätte gern|hätte lieber|esse (?:nie|kein\w*)|mag kein\w*|allergic to|vertrage kein\w*)\s+(?:any\s+|some\s+|more\s+|eine?n?\s+)?([\p{L}][\p{L} -]{1,30})$/u;
const FILLER = /^(?:something|anything|etwas|was|a|an|the)\s+(?:with\s+|mit\s+)?|\s+(?:today|tonight|right now|this time|heute|gerade|bitte|please|anymore|any more|at all|mehr)$/gu;
const NOT_FOOD = /\b(hungry|hunger|sharing|share|idea|sure|much|thanks|danke|sure|that|this|it|so|very|too|really)\b/u;
const singular = (w) => (w.length > 4 ? w.replace(/(?<=[^s])(?:e?s)$/u, '').replace(/(?<=nudel|knödel|kartoffel)n$/u, '') : w);

/**
 * Read one statement into changes. Pure: does not touch any session.
 * @returns {{ changes: Array<{dim:string, op:'set'|'add'|'remove', value:string}>, unparsed: string[], durable: Array<{polarity:'like'|'dislike', subject:string}>, correction: boolean, temporary: boolean }}
 */
export function parseStatement(text) {
  const out = { changes: [], unparsed: [], durable: [], correction: CORRECTION.test(String(text).toLowerCase()), temporary: TEMPORARY.test(String(text).toLowerCase()) };
  for (const raw of clauses(text)) {
    const c = raw.replace(LEAD, '').trim();
    if (!c) continue;
    let hit = false;
    for (const s of SITUATIONS) {
      if (s.re.test(c)) { out.changes.push({ dim: s.dim, op: 'set', value: s.value }); hit = true; }
    }
    // "not very hungry" also contains "hungry": keep only the most specific hunger
    const hungers = out.changes.filter((x) => x.dim === 'hunger');
    if (hungers.length > 1) out.changes = out.changes.filter((x) => x.dim !== 'hunger').concat(hungers.find((x) => x.value !== 'hungry') ?? hungers[0]);

    const negated = NEGATION.test(c) && !/\bnot (?:very|that|so|too) hungry\b/u.test(c);
    const more = /\b(more|extra|mehr|lots of|plenty of)\b/u.test(c);
    const groups = GROUP_WORDS.filter(([, re]) => re.test(c)).map(([g]) => g);
    const durable = DURABLE.test(c) && !TEMPORARY.test(c);
    for (const g of groups) {
      if (g === 'warm' && /\bhungry\b/.test(c) && groups.length === 1) continue;
      out.changes.push({ dim: negated && !more ? 'avoid' : 'craving', op: 'add', value: g });
      if (durable) out.durable.push({ polarity: negated ? 'dislike' : 'like', subject: FOOD_GROUPS[g].noun, restriction: ALLERGY.test(c) });
      hit = true;
    }
    if (!groups.length) {
      const m = c.match(NAMED);
      let word = m?.[1]?.trim() ?? '';
      for (let i = 0; i < 3; i++) word = word.replace(FILLER, '').trim();
      if (word && word.split(' ').length <= 3 && !NOT_FOOD.test(word)) {
        const neg = NEGATION.test(c.slice(0, c.lastIndexOf(word))) || /\b(hate|never eat|can'?t stand|esse (?:nie|kein)|mag kein|allergic|vertrage)/u.test(c);
        const key = subjectKey(word);
        out.changes.push({ dim: neg ? 'avoid' : 'craving', op: 'add', value: key });
        if (durable) out.durable.push({ polarity: neg ? 'dislike' : 'like', subject: key, restriction: ALLERGY.test(c) });
        hit = true;
      }
    }
    if (!hit && c.length > 2) out.unparsed.push(c);
  }
  return out;
}

const clone = (s) => ({ ...s, cravings: [...s.cravings], avoid: [...s.avoid], log: [...s.log] });

/**
 * Apply a statement to the session. Later statements win: a correction (or any
 * statement on the same point) replaces what was said before.
 * @returns {{ session, entry: { text, kind, changes, overridden: string[], unparsed: string[], suggestions } }}
 */
export function applyStatement(session, text) {
  const s = clone(normalizeSession(session));
  const parsed = parseStatement(text);
  const overridden = [];
  for (const ch of parsed.changes) {
    if (ch.dim === 'hunger' || ch.dim === 'sharing' || ch.dim === 'novelty') {
      if (s[ch.dim] && s[ch.dim] !== ch.value) overridden.push(LABELS[ch.dim][s[ch.dim]]);
      s[ch.dim] = ch.value;
    } else if (ch.dim === 'craving') {
      if (s.avoid.includes(ch.value)) { s.avoid = s.avoid.filter((x) => x !== ch.value); overridden.push(`no ${nounOf(ch.value)}`); }
      if (!s.cravings.includes(ch.value)) s.cravings.push(ch.value);
    } else if (ch.dim === 'avoid') {
      if (s.cravings.includes(ch.value)) { s.cravings = s.cravings.filter((x) => x !== ch.value); overridden.push(labelOf(ch.value)); }
      if (!s.avoid.includes(ch.value)) s.avoid.push(ch.value);
    }
  }
  const kind = parsed.durable.length ? 'durable'
    : (parsed.correction || overridden.length) && parsed.changes.length ? 'correction'
      : parsed.changes.some((c) => c.dim === 'craving' || c.dim === 'avoid') ? 'craving'
        : parsed.changes.length ? 'context' : 'unclear';
  const entry = { text: String(text).slice(0, 300), kind, changes: parsed.changes, overridden, unparsed: parsed.unparsed, suggestions: parsed.durable };
  s.log.push({ text: entry.text, kind, changes: entry.changes, unparsed: entry.unparsed });
  return { session: s, entry };
}

/** Remove one piece of context (the × on a chip). */
export function removeFromSession(session, dim, value) {
  const s = clone(normalizeSession(session));
  if (dim === 'cravings' || dim === 'avoid') s[dim] = s[dim].filter((x) => x !== value);
  else s[dim] = null;
  return s;
}

/** The words for a hunger / sharing / novelty value, e.g. contextLabel('hunger', 'ate') → 'already eaten'. */
export const contextLabel = (dim, value) => LABELS[dim]?.[value] ?? null;
export const labelOf = (key) => FOOD_GROUPS[key]?.label ?? key;
const nounOf = (key) => FOOD_GROUPS[key]?.noun ?? key;

/** Chips describing the current context. */
export function describeSession(session) {
  const s = normalizeSession(session);
  return [
    ...['hunger', 'sharing', 'novelty'].filter((d) => s[d]).map((d) => ({ dim: d, value: s[d], label: LABELS[d][s[d]] })),
    ...s.cravings.map((v) => ({ dim: 'cravings', value: v, label: labelOf(v) })),
    ...s.avoid.map((v) => ({ dim: 'avoid', value: v, label: `no ${nounOf(v)} today` })),
  ];
}

export const isEmptySession = (session) => describeSession(session).length === 0 && !normalizeSession(session).log.some((e) => e.unparsed.length);

/** The compact view the AI gets. */
export function sessionForAI(session) {
  const s = normalizeSession(session);
  return {
    hunger: s.hunger && LABELS.hunger[s.hunger],
    sharing: s.sharing && LABELS.sharing[s.sharing],
    novelty: s.novelty && LABELS.novelty[s.novelty],
    cravings: s.cravings.map(labelOf),
    avoidToday: s.avoid.map(nounOf),
    saidInOrder: s.log.map((e) => e.text),
  };
}

// --- Matching dishes ----------------------------------------------------------------

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Is a food word in a dish's text? Long words also match inside compounds
 * ("fisch" in "Fischsuppe"); short ones only as whole words, plurals allowed,
 * so "egg" skips "eggplant" and "fish" skips "fish-fragrant" (a seasoning).
 */
function wordIn(text, w) {
  if (w.startsWith(' ')) return ` ${text} `.includes(w);
  if (w.length >= 5) return new RegExp(`${esc(w)}(?!-)`, 'u').test(text);
  return new RegExp(`(^|[^\\p{L}-])${esc(w)}(s|es)?(?![\\p{L}-])`, 'u').test(text);
}

/** Which word of a group (or a free subject) a dish shows, or null. */
export function groupMatch(key, d, text) {
  const g = FOOD_GROUPS[key];
  if (!g) return wordIn(text, singular(subjectKey(key))) ? subjectKey(key) : null;
  // A named food ("noodles") says more than a label ("filling"), so try words first.
  const word = g.words.find((w) => wordIn(text, w));
  if (word) return word.trim();
  const attr = g.attributes.find((a) => d.attributes.includes(a));
  return attr ? attr.replace('-', ' ') : null;
}

// --- After generation ------------------------------------------------------------

/**
 * A "not today" is the diner's explicit word for this meal, so it is enforced
 * after the AI answers too: matching picks are set aside, with the reason.
 */
export function enforceSession(recs, menu, session, textOf) {
  const s = normalizeSession(session);
  if (!s.avoid.length) return recs;
  const byId = new Map(menu.dishes.map((d) => [d.id, d]));
  const setAside = [...(recs.setAside ?? [])];
  const picks = (recs.picks ?? []).filter((p) => {
    const d = byId.get(p.dishId);
    if (!d) return true;
    const key = s.avoid.find((k) => groupMatch(k, d, textOf(d)));
    if (!key) return true;
    if (!setAside.some((x) => x.dishId === d.id)) setAside.push({ dishId: d.id, reason: `no ${nounOf(key)} today` });
    return false;
  });
  return { ...recs, picks, setAside };
}

/**
 * What changed between two shortlists, in plain words, so the diner sees why.
 * Deterministic: built from the picks and their session evidence, not from the AI.
 */
export function explainChange(prev, next, menu) {
  if (!prev?.picks?.length) return [];
  const name = (id) => { const d = menu.dishes.find((x) => x.id === id); return d ? (d.translatedName || d.originalName) : id; };
  const before = prev.picks.map((p) => p.dishId);
  const after = (next.picks ?? []).map((p) => p.dishId);
  const aside = new Map((next.setAside ?? []).map((x) => [x.dishId, x.reason]));
  const lines = [];
  for (const p of next.picks ?? []) {
    if (before.includes(p.dishId)) continue;
    const why = (p.evidence ?? []).find((e) => e.type === 'session')?.text;
    lines.push({ kind: 'in', dishId: p.dishId, text: `In: ${name(p.dishId)}${why ? ` — ${why.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}` : ''}.` });
  }
  for (const id of before) {
    if (after.includes(id)) continue;
    lines.push({ kind: 'out', dishId: id, text: `Out: ${name(id)} — ${aside.get(id) ?? 'other dishes fit what you said better'}.` });
  }
  if (after[0] && after[0] !== before[0] && before.includes(after[0])) lines.push({ kind: 'up', dishId: after[0], text: `${name(after[0])} moved to the top.` });
  if (!lines.length) lines.push({ kind: 'same', dishId: null, text: 'Same shortlist: what you said already fits these picks.' });
  return lines;
}
