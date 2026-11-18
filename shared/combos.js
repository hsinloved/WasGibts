// Ways to put an order together, not just single dishes: a vegetable dish plus
// a bite of a partner's meat, a main with a small side, a few small plates to
// share, or just dessert after dinner.
//
// Combinations come from the situation (session + occasion) and from what the
// menu shows: dish attributes and section names. They never optimise calories
// or protein; hunger and sharing decide the shape, taste decides the dishes.
// Pure; shared by the browser and the server.

import { dishText } from './menu.js';

const SECTION = {
  side: /beilage|side|salat|salad|kleine|small|extra|zum dazu/iu,
  starter: /vorspeise|starter|appeti[sz]er|mezze|meze|meza|tapas|antipast|kalte|small plates/iu,
  main: /haupt|main|curry|currys|grill|vom grill|pfanne|braten|teller|gerichte|entrées?/iu,
  dessert: /dessert|nachspeise|nachtisch|süß|sweet|kuchen|eis\b/iu,
  drink: /getränk|drink|bier|wein|wine|beer|softdrink|kaffee|coffee|tee\b|tea\b/iu,
};

const is = {
  drink: (d) => SECTION.drink.test(d.section ?? ''),
  dessert: (d) => SECTION.dessert.test(d.section ?? '') || (d.attributes.includes('sweet') && /dessert|kuchen|cake|eis|ice cream|baklava|pudding|halva|loukoumades|kaiserschmarrn|strudel|kulfi|gulab/iu.test(dishText(d))),
  plate: (d) => SECTION.starter.test(d.section ?? '') || (d.attributes.includes('shareable') && d.attributes.includes('light')),
  side: (d) => SECTION.side.test(d.section ?? '') || (d.attributes.includes('light') && !d.attributes.includes('filling')),
  // The menu's own section wins; attributes only decide for unsectioned dishes.
  main: (d) => !is.dessert(d) && (SECTION.main.test(d.section ?? '')
    || (!SECTION.starter.test(d.section ?? '') && !SECTION.side.test(d.section ?? '') && d.attributes.some((a) => a === 'filling' || a === 'meat-heavy' || a === 'braised'))),
  veg: (d) => d.attributes.includes('vegetable-forward') || /vegetar|vegan|gemüse|vegetable|\bveg\b/iu.test([...d.dietary.menuStated, d.section ?? ''].join(' ')),
  meatOrFish: (d) => d.attributes.some((a) => a === 'meat-heavy' || a === 'seafood') || /fleisch|meat|fisch|fish|lamm|lamb|huhn|chicken|rind|beef|schwein|pork|garnele|shrimp|prawn|octopus|oktopus|calamar|souvlaki|gyros|kebab|keftedes/iu.test(dishText(d)),
};

const name = (d) => d.translatedName || d.originalName;

/**
 * @param ranked   eligible dishes, best first: [{ d, score }]; already free of
 *                 strict restrictions and "not today" dishes
 * @param session  normalised session context
 * @param occasion occasion key or null
 * @returns up to three combos: [{ title, dishIds, why }]
 */
export function suggestCombos(ranked, { session = {}, occasion = null } = {}) {
  const pool = ranked.filter((s) => !is.drink(s.d));
  const first = (pred, not = []) => pool.find((s) => pred(s.d) && !not.includes(s.d.id))?.d;
  const combos = [];
  const add = (title, dishes, why) => {
    const ds = dishes.filter(Boolean);
    const key = ds.map((d) => d.id).sort().join();
    if (!ds.length || combos.some((c) => [...c.dishIds].sort().join() === key)) return;
    combos.push({ title, dishIds: ds.map((d) => d.id), why });
  };

  // Already eaten: dessert, or one small thing; nothing more.
  if (session.hunger === 'ate') {
    const sweet = first(is.dessert);
    if (sweet) add('Just something sweet', [sweet], `You’ve already eaten: ${name(sweet)} is enough on its own.`);
    const small = first((d) => (is.plate(d) || is.side(d)) && !is.main(d) && !is.dessert(d));
    if (small) add('One small plate', [small], `A small plate to keep the others company without a second dinner.`);
    return combos.slice(0, 2);
  }

  // Sharing with a partner: a dish for you plus a bite of theirs.
  if (session.sharing === 'partner') {
    const mine = first(is.veg) ?? pool[0]?.d;
    // Prefer dishes labelled meat or seafood; text matches can be a typical pinch of pork.
    const labelled = (d) => d.attributes.some((a) => a === 'meat-heavy' || a === 'seafood');
    const theirs = first((d) => labelled(d) && d.attributes.includes('shareable'), [mine?.id]) ?? first(labelled, [mine?.id])
      ?? first((d) => is.meatOrFish(d) && !is.veg(d), [mine?.id]);
    if (mine && theirs) add('Your plate + a bite of theirs', [mine, theirs], `${name(mine)} for you; if your partner orders ${name(theirs)}, it is easy to share a few bites.`);
  }

  // Sharing at the table (or office lunch together): several small plates.
  if (session.sharing === 'group' || occasion === 'sharing') {
    const plates = pool.filter((s) => is.plate(s.d) || s.d.attributes.includes('shareable')).filter((s) => !is.dessert(s.d)).slice(0, 4).map((s) => s.d);
    if (plates.length >= 3) add('A few plates for the table', plates.slice(0, plates.length >= 4 ? 4 : 3), 'Small plates go further shared: everyone gets a taste of each.');
  }

  // Otherwise (not light, not a shared table): a main with a small side.
  if (session.hunger !== 'light' && session.sharing !== 'group' && occasion !== 'sharing') {
    const main = first(is.main);
    const side = first((d) => (is.side(d) || is.plate(d)) && !is.main(d) && !is.dessert(d), [main?.id]);
    if (main && side) add('Main + a small side', [main, side], `${name(main)} as the main, with ${name(side)} on the side.`);
  }

  // A sweet craving: dessert after the meal.
  if (session.cravings?.includes('sweet')) {
    const sweet = first(is.dessert);
    const main = first((d) => is.main(d) && !is.dessert(d));
    if (sweet) add('Save room for dessert', [main, sweet], `${main ? `${name(main)}, then ` : ''}${name(sweet)} for the sweet tooth you mentioned.`);
  }
  return combos.slice(0, 3);
}
