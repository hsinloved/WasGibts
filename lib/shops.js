// Restaurant online-shop platforms whose pages are empty shells: the menu is
// loaded by JavaScript from the platform's public API. For these, reading the
// page gives nothing, so we ask the platform's API for the menu directly and
// turn it into plain text for the AI to read.
//
// Each adapter: detect(html, url) → boolean; read(url, fetchJson) → { text, name }.
// fetchJson is passed in by lib/sources.js so every request goes through the
// same public-address check, timeout and size limit as page fetches.

const FOODAMIGOS_API = 'https://app.foodamigos.io/api';

/** Allergen codes FoodAmigos uses, in plain words. */
const ALLERGENS = {
  GLUTEN: 'gluten', KREBSTIERE: 'crustaceans', KRUSTENTIERE: 'crustaceans', EIER: 'eggs', FISCH: 'fish', ERDNUESSE: 'peanuts', ERDNÜSSE: 'peanuts',
  SOJA: 'soy', MILCH: 'milk', SCHALENFRUECHTE: 'tree nuts', SCHALENFRÜCHTE: 'tree nuts', NUESSE: 'tree nuts', SELLERIE: 'celery',
  SENF: 'mustard', SESAM: 'sesame', SULFITE: 'sulphites', SCHWEFELDIOXID: 'sulphites', LUPINEN: 'lupin', WEICHTIERE: 'molluscs',
};
const allergenWord = (a) => ALLERGENS[String(a).toUpperCase()] ?? String(a).toLowerCase().replace(/_/g, ' ');

const money = (n, currency) => (typeof n === 'number' ? (currency === 'EUR' || !currency ? `${n.toFixed(2).replace('.', ',')} €` : `${n.toFixed(2)} ${currency}`) : null);

/**
 * FoodAmigos /companies/{id}/menus response → readable menu text.
 * Pure, so it is unit-tested with a fixture.
 */
export function foodamigosMenuText(menusResponse, { name = null, currency = 'EUR' } = {}) {
  const d = menusResponse?.data ?? {};
  const categories = Object.values(d.categories ?? {});
  const products = d.products ?? {};
  const menus = Array.isArray(d.menus) ? d.menus : [];
  // Categories that belong to some menu, in menu order, without the
  // "most popular" shelf that repeats dishes from elsewhere.
  const inMenus = new Set(menus.flatMap((m) => m.category_ids ?? []));
  const cats = categories
    .filter((c) => c.type !== 'most_popular' && (inMenus.size === 0 || inMenus.has(c.id)))
    .sort((a, b) => (a.sorting_order ?? 0) - (b.sorting_order ?? 0));

  const lines = [];
  if (name) lines.push(`Restaurant: ${name}`);
  let dishes = 0;
  const seen = new Set();
  for (const c of cats) {
    const items = (c.product_ids ?? []).map((id) => products[id]).filter((p) => p && p.type !== 'modifier');
    if (!items.length) continue;
    lines.push('', `## ${c.name}`);
    if (c.description) lines.push(c.description);
    for (const p of items) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      dishes += 1;
      const ni = p.nutrition_info ?? {};
      const bits = [
        `- ${p.name}`,
        money(p.base_price, currency),
        p.description && p.description.trim(),
        ni.ingredients_text && `ingredients: ${ni.ingredients_text.trim()}`,
        ni.allergens_list?.length && `allergens: ${ni.allergens_list.map(allergenWord).join(', ')}`,
        p.is_available === false && '(currently unavailable)',
      ].filter(Boolean);
      lines.push(bits.join(' — '));
    }
  }
  return { text: lines.join('\n').trim(), dishes };
}

const foodamigos = {
  name: 'FoodAmigos',
  detect: (html) => /foodamigos/i.test(html),
  async read(pageUrl, fetchJson) {
    const hostname = new URL(pageUrl).hostname;
    const fr = await fetchJson(`${FOODAMIGOS_API}/franchises?hostname=${encodeURIComponent(hostname)}`);
    const franchise = fr?.data ?? {};
    const companies = Array.isArray(franchise.companies) ? franchise.companies : [];
    // A path like /annamgrill on the shared shop domain names the branch.
    const slug = new URL(pageUrl).pathname.split('/').filter(Boolean)[0];
    const company = companies.find((c) => c.slug && c.slug === slug) ?? companies[0];
    if (!company?.id) return null;
    const menus = await fetchJson(`${FOODAMIGOS_API}/companies/${encodeURIComponent(company.id)}/menus`);
    const name = company.name ?? franchise.name ?? null;
    const { text, dishes } = foodamigosMenuText(menus, { name, currency: company.currency ?? 'EUR' });
    if (!dishes) return null;
    return {
      name,
      text,
      note: companies.length > 1 ? `This restaurant has ${companies.length} branches on its online shop; this is the menu of ${name}.` : null,
    };
  },
};

export const SHOP_PLATFORMS = [foodamigos];

/** The online-shop platform a page belongs to, or null. */
export const shopFor = (html, url) => SHOP_PLATFORMS.find((s) => s.detect(html, url)) ?? null;
