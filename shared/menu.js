// The menu model: what the extraction step produces and the rest of the app
// reads. The key idea is provenance. Anything printed on the menu is marked
// `menu`; anything the AI knows about a dish in general is marked `typical`.
// The UI renders those differently so estimates are never mistaken for facts.

/** Controlled vocabulary so matching and occasion logic are predictable. */
export const ATTRIBUTES = [
  'rich', 'light', 'spicy', 'mild', 'fried', 'grilled', 'raw', 'braised', 'soup', 'fermented',
  'vegetable-forward', 'meat-heavy', 'seafood', 'sweet', 'sour', 'smoky', 'creamy', 'crunchy',
  'shareable', 'travels-well', 'messy', 'quick', 'filling', 'unusual',
];

export const SOURCES = ['menu', 'typical'];

const str = (v) => (v == null ? null : String(v).trim() || null);
const arr = (v) => (Array.isArray(v) ? v : []);
const strs = (v) => arr(v).map((x) => String(x).trim()).filter(Boolean);
const tagged = (v, key) => arr(v)
  .map((x) => (typeof x === 'string' ? { [key]: x, source: 'typical' } : x))
  .filter((x) => x && str(x[key]))
  .map((x) => ({ [key]: str(x[key]), source: x.source === 'menu' ? 'menu' : 'typical' }));

export function normalizeDish(d, i) {
  const price = d.price ?? {};
  return {
    id: str(d.id) ?? `d${i + 1}`,
    section: str(d.section),
    originalName: str(d.originalName) ?? `Dish ${i + 1}`,
    translatedName: str(d.translatedName),
    menuDescription: str(d.menuDescription),
    price: {
      amount: Number.isFinite(Number(price.amount)) && price.amount !== null ? Number(price.amount) : null,
      currency: str(price.currency),
      display: str(price.display),
    },
    explanation: str(d.explanation) ?? '',
    ingredients: tagged(d.ingredients, 'name'),
    preparation: tagged(d.preparation, 'method'),
    flavours: strs(d.flavours),
    textures: strs(d.textures),
    cuisine: str(d.cuisine),
    region: str(d.region),
    culturalNote: str(d.culturalNote),
    attributes: strs(d.attributes).filter((a) => ATTRIBUTES.includes(a)),
    dietary: { menuStated: strs(d.dietary?.menuStated), likely: strs(d.dietary?.likely) },
    uncertainty: str(d.uncertainty),
  };
}

export function normalizeMenu(m) {
  if (!m || typeof m !== 'object') throw new Error('Not a menu');
  const dishes = arr(m.dishes).map(normalizeDish);
  // Ids must be unique; the recommender refers to dishes by id.
  const seen = new Set();
  for (const d of dishes) {
    let id = d.id; let n = 2;
    while (seen.has(id)) id = `${d.id}-${n++}`;
    d.id = id; seen.add(id);
  }
  return {
    restaurant: {
      name: str(m.restaurant?.name),
      cuisine: str(m.restaurant?.cuisine),
      menuLanguage: str(m.restaurant?.menuLanguage),
      currency: str(m.restaurant?.currency),
    },
    source: { kind: str(m.source?.kind) ?? 'unknown', label: str(m.source?.label), url: str(m.source?.url) },
    dishes,
    notes: strs(m.notes),
    extractedAt: m.extractedAt ?? new Date().toISOString(),
  };
}

/** Everything about a dish the matcher may search, lower-cased. */
export function dishText(d) {
  return [
    d.originalName, d.translatedName, d.menuDescription, d.explanation, d.cuisine, d.region,
    ...d.ingredients.map((x) => x.name), ...d.preparation.map((x) => x.method),
    ...d.flavours, ...d.textures, ...d.attributes,
  ].filter(Boolean).join(' · ').toLowerCase();
}

export function priceLabel(d) {
  if (d.price.display) return d.price.display;
  if (d.price.amount == null) return null;
  return d.price.currency ? `${d.price.amount.toFixed(2)} ${d.price.currency}` : d.price.amount.toFixed(2);
}

/** History-friendly snapshot of a dish. Only menu-verified ingredients are kept. */
export function dishSnapshot(d) {
  const menuIngredients = d.ingredients.filter((x) => x.source === 'menu').map((x) => x.name);
  return {
    originalName: d.originalName,
    translatedName: d.translatedName,
    cuisine: d.cuisine,
    ingredients: menuIngredients.length ? menuIngredients : d.ingredients.map((x) => x.name).slice(0, 3),
    attributes: d.attributes.filter((a) => !['shareable', 'travels-well', 'quick', 'messy'].includes(a)),
    price: priceLabel(d),
  };
}
