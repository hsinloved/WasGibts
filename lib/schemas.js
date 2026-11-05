// JSON Schemas for structured outputs from the AI layer. The model is
// constrained to these shapes; results are then passed through the shared
// normalisers so the client never sees anything else.

import { ATTRIBUTES } from '../shared/menu.js';
import { CATEGORIES, RESTRICTION_TYPES, OCCASIONS } from '../shared/model.js';

const S = { type: 'string' };
const NS = { type: ['string', 'null'] };
const strList = { type: 'array', items: S };
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const provenance = (key) => ({ type: 'array', items: obj({ [key]: S, source: { type: 'string', enum: ['menu', 'typical'] } }) });

export const MENU_SCHEMA = obj({
  restaurant: obj({ name: NS, cuisine: NS, menuLanguage: NS, currency: NS }),
  dishes: {
    type: 'array',
    items: obj({
      id: S,
      section: NS,
      originalName: S,
      translatedName: NS,
      glosses: { type: 'array', items: obj({ language: S, name: S }) },
      menuDescription: NS,
      price: obj({ amount: { type: ['number', 'null'] }, currency: NS, display: NS }),
      explanation: S,
      ingredients: provenance('name'),
      preparation: provenance('method'),
      flavours: strList,
      textures: strList,
      cuisine: NS,
      region: NS,
      culturalNote: NS,
      attributes: { type: 'array', items: { type: 'string', enum: ATTRIBUTES } },
      dietary: obj({ menuStated: strList, likely: strList }),
      uncertainty: NS,
    }),
  },
  notes: strList,
});

export const RECOMMENDATION_SCHEMA = obj({
  headline: S,
  picks: {
    type: 'array',
    items: obj({
      dishId: S,
      role: S,
      whyYou: S,
      evidence: {
        type: 'array',
        items: obj({ type: { type: 'string', enum: ['preference', 'history', 'restriction', 'menu', 'occasion'] }, ref: NS, text: S }),
      },
      concerns: strList,
      occasionFit: S,
    }),
  },
  cautions: { type: 'array', items: obj({ dishId: S, reason: S, restrictionId: NS }) },
  orderingTip: NS,
  occasionQuestion: NS,
});

export const PROFILE_IMPORT_SCHEMA = obj({
  about: S,
  preferences: {
    type: 'array',
    items: obj({
      polarity: { type: 'string', enum: ['like', 'dislike'] },
      category: { type: 'string', enum: CATEGORIES },
      subject: S,
      note: S,
      contexts: { type: 'array', items: { type: 'string', enum: Object.keys(OCCASIONS) } },
      quote: S,
    }),
  },
  restrictions: {
    type: 'array',
    items: obj({
      type: { type: 'string', enum: RESTRICTION_TYPES },
      subject: S,
      severity: { type: 'string', enum: ['strict', 'flexible'] },
      note: S,
      quote: S,
    }),
  },
  history: {
    type: 'array',
    items: obj({
      dish: S,
      restaurant: NS,
      sentiment: { type: 'string', enum: ['loved', 'liked', 'disliked', 'neutral'] },
      quote: S,
    }),
  },
});
