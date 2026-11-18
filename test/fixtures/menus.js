// Fictional restaurant menus for the behavioural scenarios. Any resemblance to
// real restaurants is coincidental; dishes are written as an extracted menu.
import { normalizeMenu } from '../../shared/menu.js';

let n = 0;
function dish(section, originalName, translatedName, menuDescription, price, attributes, ingredients = [], menuStated = []) {
  n += 1;
  return {
    id: `m${n}`, section, originalName, translatedName, menuDescription,
    price: { amount: price, currency: 'EUR', display: `${price.toFixed(2).replace('.', ',')} €` },
    explanation: translatedName, ingredients: ingredients.map((name) => ({ name, source: 'menu' })), preparation: [],
    flavours: [], textures: [], cuisine: null, region: null, culturalNote: null, attributes,
    dietary: { menuStated, likely: [] }, uncertainty: null, glosses: [],
  };
}
const menu = (name, cuisine, dishes) => normalizeMenu({ restaurant: { name, cuisine, menuLanguage: 'German', currency: 'EUR' }, source: { kind: 'test', label: name, url: null }, notes: [], dishes });

export const tavernaMelina = () => { n = 0; return menu('Taverna Melina', 'Greek', [
  dish('Mezedes', 'Tzatziki', 'Yoghurt and cucumber dip', 'Joghurt, Gurke, Knoblauch, mit Pita', 5.5, ['light', 'shareable', 'mild', 'quick'], ['yoghurt', 'cucumber', 'garlic', 'pita'], ['vegetarisch']),
  dish('Mezedes', 'Gigantes', 'Baked giant beans', 'Riesenbohnen in Tomatensauce, im Ofen gebacken', 6.9, ['vegetable-forward', 'shareable', 'braised'], ['giant beans', 'tomato'], ['vegan']),
  dish('Mezedes', 'Saganaki', 'Fried cheese', 'Gebratener Kefalograviera mit Zitrone', 7.5, ['fried', 'rich', 'shareable'], ['kefalograviera cheese', 'lemon'], ['vegetarisch']),
  dish('Mezedes', 'Oktapodi', 'Grilled octopus', 'Oktopus vom Holzkohlegrill, Olivenöl, Oregano', 14.9, ['seafood', 'grilled', 'shareable', 'smoky'], ['octopus', 'olive oil', 'oregano']),
  dish('Mezedes', 'Kalamarakia', 'Fried squid', 'Frittierte Calamari mit Zitrone', 11.5, ['seafood', 'fried', 'shareable', 'crunchy'], ['squid', 'lemon']),
  dish('Mezedes', 'Garides Saganaki', 'Prawns in tomato and feta', 'Garnelen in Tomaten-Feta-Sauce', 13.9, ['seafood', 'shareable', 'rich'], ['prawns', 'tomato', 'feta']),
  dish('Hauptgerichte', 'Lamm Kleftiko', 'Slow-baked lamb', 'Lammkeule im Pergament gegart, mit Kartoffeln', 21.5, ['meat-heavy', 'braised', 'filling', 'rich'], ['lamb', 'potatoes']),
  dish('Hauptgerichte', 'Dorade vom Grill', 'Grilled sea bream', 'Ganze Dorade vom Grill mit Gemüse', 19.9, ['seafood', 'grilled', 'light'], ['sea bream', 'vegetables']),
  dish('Hauptgerichte', 'Moussaka', 'Moussaka', 'Auberginen, Hackfleisch, Kartoffeln, Béchamel', 15.9, ['rich', 'filling', 'meat-heavy', 'creamy'], ['aubergine', 'minced beef', 'potatoes', 'béchamel']),
  dish('Hauptgerichte', 'Gemista', 'Stuffed vegetables', 'Mit Reis und Kräutern gefüllte Tomaten und Paprika', 14.5, ['vegetable-forward', 'mild'], ['tomatoes', 'peppers', 'rice', 'herbs'], ['vegan']),
  dish('Desserts', 'Baklava', 'Baklava', 'Blätterteig, Walnüsse, Honig', 5.9, ['sweet', 'crunchy'], ['filo', 'walnuts', 'honey']),
  dish('Desserts', 'Loukoumades', 'Honey doughnuts', 'Kleine Krapfen mit Honig und Zimt', 6.5, ['sweet', 'fried'], ['dough', 'honey', 'cinnamon']),
]); };

export const baumkirchners = () => { n = 0; return menu('Baumkirchners', 'Bavarian', [
  dish('Vorspeisen', 'Obatzda mit Brezn', 'Cheese spread with pretzel', 'Camembertcreme, Zwiebeln, frische Brezn', 8.5, ['rich', 'shareable', 'creamy'], ['camembert', 'onion', 'pretzel']),
  dish('Vorspeisen', 'Leberknödelsuppe', 'Liver dumpling soup', 'Rinderbrühe mit Leberknödel', 6.5, ['soup', 'light'], ['beef broth', 'liver dumpling']),
  dish('Hauptgerichte', 'Schweinebraten mit Knödel', 'Roast pork with dumpling', 'Dunkelbiersoße, Semmelknödel, Krautsalat', 18.9, ['meat-heavy', 'braised', 'filling', 'rich'], ['pork', 'dark beer sauce', 'bread dumpling', 'cabbage']),
  dish('Hauptgerichte', 'Käsespätzle', 'Cheese spätzle', 'Spätzle mit Bergkäse und Röstzwiebeln', 14.5, ['rich', 'filling', 'creamy'], ['spätzle', 'mountain cheese', 'fried onions'], ['vegetarisch']),
  dish('Hauptgerichte', 'Hähnchenbrust vom Grill', 'Grilled chicken breast', 'Mit Beilagensalat', 16.9, ['grilled', 'light'], ['chicken breast', 'side salad']),
  dish('Beilagen', 'Kartoffelsalat', 'Potato salad', 'Bayerischer Kartoffelsalat mit Brühe', 4.5, ['light', 'sour'], ['potatoes', 'broth', 'onion']),
  dish('Beilagen', 'Beilagensalat', 'Side salad', 'Gemischter Salat der Saison', 4.9, ['light', 'vegetable-forward', 'quick'], ['lettuce', 'tomato', 'cucumber'], ['vegan']),
  dish('Desserts', 'Apfelstrudel', 'Apple strudel', 'Mit Vanillesoße', 6.9, ['sweet'], ['apple', 'pastry', 'vanilla sauce']),
  dish('Desserts', 'Kaiserschmarrn', 'Shredded pancake', 'Mit Zwetschgenröster', 9.5, ['sweet', 'filling'], ['pancake', 'plum compote']),
  dish('Getränke', 'Weißbier 0,5 l', 'Wheat beer', null, 4.6, [], ['wheat beer']),
]); };

export const zumGoldenenCurry = () => { n = 0; return menu('Zum Goldenen Curry', 'Indian', [
  dish('Vorspeisen', 'Samosa', 'Samosa', 'Teigtaschen mit Kartoffeln und Erbsen', 5.5, ['fried', 'shareable', 'vegetable-forward'], ['pastry', 'potatoes', 'peas'], ['vegan']),
  dish('Currys', 'Goa Fisch-Curry', 'Goan fish curry', 'Kabeljau in Kokos-Tamarinden-Sauce', 17.9, ['seafood', 'spicy', 'sour'], ['cod', 'coconut', 'tamarind']),
  dish('Currys', 'Chana Masala', 'Chickpea curry', 'Kichererbsen, Tomaten, Garam Masala', 12.9, ['vegetable-forward', 'braised', 'filling'], ['chickpeas', 'tomatoes', 'garam masala'], ['vegan']),
  dish('Currys', 'Gemüse-Korma', 'Vegetable korma', 'Saisongemüse in Cashew-Sahne-Sauce', 13.9, ['vegetable-forward', 'creamy', 'mild', 'rich'], ['seasonal vegetables', 'cashew', 'cream'], ['vegetarisch']),
  dish('Currys', 'Butter Chicken', 'Butter chicken', 'Hähnchen in Tomaten-Butter-Sauce', 15.9, ['rich', 'creamy', 'meat-heavy'], ['chicken', 'tomato', 'butter']),
  dish('Beilagen', 'Knoblauch-Naan', 'Garlic naan', 'Aus dem Tandoor', 3.9, ['shareable'], ['flatbread', 'garlic']),
  dish('Beilagen', 'Gurken-Raita', 'Cucumber raita', 'Joghurt mit Gurke und Minze', 3.5, ['light', 'mild'], ['yoghurt', 'cucumber', 'mint'], ['vegetarisch']),
  dish('Desserts', 'Gulab Jamun', 'Gulab jamun', 'Milchbällchen in Rosensirup', 5.5, ['sweet'], ['milk dumplings', 'rose syrup']),
]); };
