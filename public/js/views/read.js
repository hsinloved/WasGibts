import { h, mount, toast, plural } from '../dom.js';
import { api, readFiles } from '../api.js';
import { session } from '../store.js';
import { OCCASIONS } from '/shared/model.js';
import { normalizeMenu, priceLabel, dishSnapshot } from '/shared/menu.js';
import { profileForAI } from '/shared/profile.js';
import { recommendLocally, screenRestrictions } from '/shared/recommend.js';

const state = {
  tab: 'url',
  url: '',
  files: null,
  occasion: null,
  request: '',
  busy: null,      // string while working
  error: null,
  ...session.get(), // menu, recs survive reloads
};
const persist = () => session.set({ menu: state.menu, recs: state.recs, occasion: state.occasion, request: state.request, url: state.url });

export function renderRead(root, ctx) {
  const { store } = ctx;
  state.occasion ??= store.profile.settings.defaultOccasion || 'solo';
  const rerender = () => renderRead(root, ctx);

  mount(root,
    h('section.intro', {},
      h('p.eyebrow', {}, 'Read a menu'),
      h('h1.display', {}, 'What’s good here, for you?'),
      h('p.lede', {}, 'Share a menu and I’ll translate it, explain what each dish actually is, and pick a few that suit your taste and the moment.'),
    ),
    sourceForm(ctx, rerender),
    state.busy && h('div.working', { role: 'status' }, h('span.dot'), state.busy),
    state.error && h('p.error', { role: 'alert' }, state.error),
    state.menu && !state.busy && results(ctx, rerender),
  );
}

function sourceForm(ctx, rerender) {
  const { ai } = ctx;
  const tabs = [['url', 'Website link'], ['file', 'Photo or PDF'], ['sample', 'Sample menu']];
  const disabled = !ai.available && state.tab !== 'sample';

  const input = state.tab === 'url'
    ? h('label.field', {}, h('span', {}, 'Restaurant or menu page'),
      h('input', { type: 'url', inputmode: 'url', placeholder: 'https://…', value: state.url, required: true, oninput: (e) => { state.url = e.target.value; } }))
    : state.tab === 'file'
      ? h('label.field', {}, h('span', {}, 'Menu photos (several pages are fine) or a PDF'),
        h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, onchange: (e) => { state.files = e.target.files; } }))
      : h('p.muted', {}, 'A fictional Sichuan restaurant in Berlin, bundled with the app. Works without an AI key.');

  return h('form.source', {
    onsubmit: async (e) => { e.preventDefault(); await readMenu(ctx, rerender); },
  },
  h('div.tabs', { role: 'tablist' }, tabs.map(([id, label]) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(state.tab === id), class: state.tab === id ? 'on' : '',
    onclick: () => { state.tab = id; state.error = null; rerender(); },
  }, label))),
  input,
  h('fieldset.occasions', {},
    h('legend', {}, 'The occasion'),
    h('div.chips', {}, Object.entries(OCCASIONS).map(([id, o]) => h('button', {
      type: 'button', class: `chip${state.occasion === id ? ' on' : ''}`, 'aria-pressed': String(state.occasion === id), title: o.blurb,
      onclick: () => { state.occasion = id; persist(); rerender(); },
    }, o.label))),
    h('p.hint', {}, OCCASIONS[state.occasion]?.blurb),
  ),
  h('label.field', {}, h('span', {}, 'Anything in particular today? ', h('em', {}, 'optional, not saved to your profile')),
    h('input', { type: 'text', maxlength: 300, placeholder: 'e.g. something light, no noodles, I’m starving', value: state.request, oninput: (e) => { state.request = e.target.value; } })),
  h('div.actions', {},
    h('button.primary', { type: 'submit', disabled: Boolean(state.busy) || disabled }, state.tab === 'sample' ? 'Open the sample menu' : 'Read the menu'),
    state.menu && h('button.ghost', { type: 'button', disabled: Boolean(state.busy), onclick: () => refreshPicks(ctx, rerender) }, 'Update picks for this occasion'),
  ),
  disabled && h('p.ai-note.muted', {}, 'Reading real menus needs an AI key on the server (ANTHROPIC_API_KEY). The sample menu and the built-in matcher work without one.'),
  );
}

async function readMenu(ctx, rerender) {
  state.error = null;
  try {
    if (state.tab === 'sample') {
      state.menu = normalizeMenu(await (await fetch('/shared/sample-menu.json')).json());
    } else {
      const translateTo = ctx.store.profile.settings.translateTo;
      let source;
      if (state.tab === 'url') {
        if (!state.url.trim()) throw new Error('Paste a link first.');
        source = { type: 'url', url: state.url.trim() };
        state.busy = 'Fetching the page and reading the menu…';
      } else {
        if (!state.files?.length) throw new Error('Choose a photo or PDF first.');
        state.busy = 'Preparing your files…'; rerender();
        source = { type: 'files', files: await readFiles(state.files) };
        state.busy = `Reading ${plural(state.files.length, 'page')}…`;
      }
      rerender();
      state.menu = normalizeMenu(await api.extract(source, translateTo));
    }
    state.recs = null;
    await refreshPicks(ctx, rerender);
  } catch (err) {
    state.busy = null;
    state.error = err.message;
    rerender();
  }
}

async function refreshPicks(ctx, rerender) {
  const { store, ai } = ctx;
  const profile = store.profile;
  state.error = null;
  const screen = profile.settings.shareRestrictionsWithAI
    ? [...screenRestrictions(state.menu, profile)].flatMap(([dishId, hits]) => hits.map((x) => ({ dishId, restriction: x.restriction.subject, type: x.restriction.type, verifiedOnMenu: x.verified })))
    : [];
  try {
    if (ai.available) {
      state.busy = 'Matching dishes to your taste…'; rerender();
      state.recs = await api.recommend({
        menu: state.menu, occasion: state.occasion, request: state.request, screen,
        profile: profileForAI(profile, { occasion: state.occasion }),
      });
    } else {
      state.recs = recommendLocally(state.menu, profile, { occasion: state.occasion });
    }
  } catch (err) {
    state.recs = recommendLocally(state.menu, profile, { occasion: state.occasion });
    state.recs.fallbackReason = err.message;
  }
  state.busy = null;
  persist();
  rerender();
  document.querySelector('.results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- Results -------------------------------------------------------------------

function results(ctx, rerender) {
  const { menu, recs } = state;
  const byId = new Map(menu.dishes.map((d) => [d.id, d]));
  const sections = groupBy(menu.dishes, (d) => d.section ?? 'Menu');

  return h('section.results', {},
    h('header.menu-head', {},
      h('p.eyebrow', {}, menu.source.kind === 'sample' ? 'Sample' : 'From', ' · ', menu.source.url ? h('a', { href: menu.source.url, target: '_blank', rel: 'noopener noreferrer' }, menu.source.label) : menu.source.label),
      h('h2.display-s', {}, menu.restaurant.name ?? 'This menu'),
      h('p.muted', {}, [menu.restaurant.cuisine, plural(menu.dishes.length, 'dish', 'dishes'), menu.restaurant.menuLanguage && `menu in ${menu.restaurant.menuLanguage}`].filter(Boolean).join(' · ')),
      menu.notes.length > 0 && h('ul.notes', {}, menu.notes.map((n) => h('li', {}, n))),
    ),

    recs && h('section.picks', {},
      h('div.picks-head', {},
        h('p.eyebrow', {}, `For you · ${OCCASIONS[state.occasion]?.label ?? ''}`),
        h('p.headline', {}, recs.headline),
        h('p.engine', {}, recs.engine === 'ai'
          ? 'Picked by the AI from your profile. Details marked “typical” are general knowledge, not from this menu.'
          : 'Picked by the built-in matcher, which only uses exact matches with your profile.'),
        recs.fallbackReason && h('p.error.small', {}, `The AI couldn’t help this time (${recs.fallbackReason}), so these come from the built-in matcher.`),
      ),
      h('ol.pick-list', {}, recs.picks.map((p, i) => {
        const d = byId.get(p.dishId);
        return d && pickCard(ctx, d, p, i);
      })),
      recs.orderingTip && h('p.tip', {}, h('strong', {}, 'Tip. '), recs.orderingTip),
      recs.cautions.length > 0 && h('aside.cautions', {},
        h('h3', {}, 'Check before ordering'),
        h('ul', {}, recs.cautions.map((c) => h('li', {}, h('strong', {}, byId.get(c.dishId)?.translatedName ?? byId.get(c.dishId)?.originalName ?? c.dishId), ' — ', c.reason))),
        h('p.small.muted', {}, 'Menus rarely list everything. For allergies, always ask the restaurant.'),
      ),
    ),

    h('section.full-menu', {},
      h('h2.section-title', {}, 'The whole menu'),
      [...sections].map(([name, dishes]) => h('div.menu-section', {},
        h('h3.menu-section-title', {}, name),
        dishes.map((d) => h('details.dish-row', {},
          h('summary', {},
            h('span.names', {}, h('span.orig', {}, d.originalName), d.translatedName && h('span.trans', {}, d.translatedName)),
            h('span.price', {}, priceLabel(d) ?? '')),
          h('div.dish-body', {}, dishDetail(d), dishActions(ctx, d, false)),
        )),
      )),
    ),
  );
}

function pickCard(ctx, d, p, i) {
  return h('li.pick', {},
    h('div.pick-num', { 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')),
    h('article', {},
      h('p.eyebrow.accent', {}, p.role),
      h('header.dish-head', {},
        h('div', {}, h('h3.dish-name', {}, d.originalName), d.translatedName && h('p.dish-trans', {}, d.translatedName)),
        priceLabel(d) && h('p.price', {}, priceLabel(d)),
      ),
      h('p.why', {}, p.whyYou),
      p.evidence.length > 0 && h('details.evidence', {},
        h('summary', {}, 'What this is based on'),
        h('ul', {}, p.evidence.map((e) => h('li', {}, h('span.tag', {}, evidenceLabel(e.type)), e.text))),
      ),
      p.concerns.length > 0 && h('div.concerns', {}, h('h4', {}, 'Worth knowing'), h('ul', {}, p.concerns.map((c) => h('li', {}, c)))),
      dishDetail(d),
      dishActions(ctx, d, true),
    ),
  );
}

const evidenceLabel = (t) => ({ preference: 'Your taste', history: 'Past order', restriction: 'Restriction', menu: 'Menu', occasion: 'Occasion' }[t] ?? t);

export function dishDetail(d) {
  const ing = d.ingredients;
  const prep = d.preparation;
  const hasTypical = ing.some((x) => x.source === 'typical') || prep.some((x) => x.source === 'typical');
  return h('div.dish-detail', {},
    d.explanation && h('p.explain', {}, d.explanation),
    d.menuDescription && h('p.menu-quote', {}, h('span.label', {}, 'On the menu'), ` “${d.menuDescription}”`),
    ing.length > 0 && h('p.facts', {}, h('span.label', {}, 'Ingredients'), ' ', provenanceList(ing, 'name')),
    prep.length > 0 && h('p.facts', {}, h('span.label', {}, 'Preparation'), ' ', provenanceList(prep, 'method')),
    (d.flavours.length || d.textures.length) ? h('p.facts', {}, h('span.label', {}, 'Eats like'), ' ', [...d.flavours, ...d.textures].join(', ')) : null,
    (d.dietary.menuStated.length || d.dietary.likely.length) ? h('p.facts', {}, h('span.label', {}, 'Dietary'), ' ',
      d.dietary.menuStated.length ? `menu says ${d.dietary.menuStated.join(', ')}` : '',
      d.dietary.menuStated.length && d.dietary.likely.length ? '; ' : '',
      d.dietary.likely.length ? h('span.typical', {}, `probably: ${d.dietary.likely.join(', ')}`) : '') : null,
    d.uncertainty && h('p.facts.unsure', {}, h('span.label', {}, 'Not sure'), ' ', d.uncertainty),
    hasTypical && h('p.legend', {}, h('span.typical', {}, 'Italic'), ' = typical for this dish, not stated on the menu.'),
    d.culturalNote && h('aside.culture', {}, d.culturalNote),
  );
}

function provenanceList(items, key) {
  return items.flatMap((x, i) => [
    i ? ', ' : '',
    x.source === 'menu' ? h('span', {}, x[key]) : h('span.typical', { title: 'Typical for this dish; not on the menu' }, x[key]),
  ]);
}

function dishActions(ctx, d, recommended) {
  const { store } = ctx;
  const inJournal = (action) => store.profile.history.some((x) => x.action === action && x.dish.originalName === d.originalName && x.restaurant.name === (state.menu.restaurant.name ?? null) && !x.feedbackAt && Date.now() - Date.parse(x.at) < 864e5);
  const add = async (action, e) => {
    await store.do('recordHistory', {
      action, occasion: state.occasion, recommended,
      restaurant: { name: state.menu.restaurant.name, url: state.menu.source.url },
      dish: dishSnapshot(d),
    });
    e.target.disabled = true;
    e.target.textContent = action === 'ordered' ? 'Ordered ✓' : 'Saved ✓';
    toast(action === 'ordered' ? 'In your journal. Tell me how it was afterwards.' : 'Saved to your journal.', { href: '#/journal', label: 'Open journal' });
  };
  return h('div.dish-actions', {},
    h('button.small', { type: 'button', disabled: inJournal('ordered'), onclick: (e) => add('ordered', e) }, inJournal('ordered') ? 'Ordered ✓' : 'I’m ordering this'),
    h('button.small.ghost', { type: 'button', disabled: inJournal('saved'), onclick: (e) => add('saved', e) }, inJournal('saved') ? 'Saved ✓' : 'Save for later'),
  );
}

function groupBy(list, fn) {
  const m = new Map();
  for (const x of list) { const k = fn(x); m.set(k, [...(m.get(k) ?? []), x]); }
  return m;
}
