import { h, mount, toast, plural } from '../dom.js';
import { api, readFiles } from '../api.js';
import { session } from '../store.js';
import { OCCASIONS } from '/shared/model.js';
import { normalizeMenu, priceLabel, dishSnapshot, STYLE_ATTRIBUTES } from '/shared/menu.js';
import { profileForAI } from '/shared/profile.js';
import { recommendLocally, screenRestrictions } from '/shared/recommend.js';

const state = {
  tab: 'photos',
  pages: [],        // [{ file, url }] photos/screenshots/PDFs waiting to be read
  link: '',
  sharedText: '',   // text that came with a share (e.g. place name from Google Maps)
  occasion: undefined,
  request: '',
  busy: null,       // string while working
  error: null,
  autoStart: false,
  ...session.get(), // menu, recs survive reloads
};
const persist = () => session.set({ menu: state.menu, recs: state.recs, occasion: state.occasion, request: state.request, link: state.link });

const PLATFORM_RX = /(lieferando|thuisbezorgd|just-eat|takeaway\.com|wolt\.com|ubereats|deliveroo|foodora|foodpanda)/i;
const PLATFORM_NAMES = { lieferando: 'Lieferando', thuisbezorgd: 'Thuisbezorgd', 'just-eat': 'Just Eat', 'takeaway.com': 'Takeaway', 'wolt.com': 'Wolt', ubereats: 'Uber Eats', deliveroo: 'Deliveroo', foodora: 'foodora', foodpanda: 'foodpanda' };
export function linkKind(text) {
  const t = String(text || '');
  if (/(maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps|maps\.google\.)/i.test(t)) return { kind: 'maps' };
  const m = t.match(PLATFORM_RX);
  if (m) return { kind: 'platform', name: PLATFORM_NAMES[m[1].toLowerCase()] ?? m[1] };
  return { kind: /https?:\/\//i.test(t) || /\.[a-z]{2,}(\/|$)/i.test(t) ? 'website' : null };
}

/** Called by the app when the installed PWA receives a share (see /sw.js). */
export async function receiveShare() {
  const params = new URLSearchParams(location.search);
  if (!params.has('share')) return false;
  history.replaceState(null, '', '/#/');
  if (params.get('share') !== '1') {
    state.error = 'That share didn’t come through. Open WasGibts once, then try sharing again.';
    return true;
  }
  try {
    const cache = await caches.open('wasgibts-share');
    const metaRes = await cache.match('/__share/meta');
    if (!metaRes) return true;
    const meta = await metaRes.json();
    const files = [];
    for (const key of meta.files) {
      const r = await cache.match(key);
      if (!r) continue;
      const blob = await r.blob();
      files.push(new File([blob], decodeURIComponent(r.headers.get('X-Name') || 'page'), { type: blob.type }));
    }
    for (const key of await cache.keys()) await cache.delete(key);
    if (files.length) {
      state.tab = 'photos';
      state.pages = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    } else {
      state.tab = 'link';
      state.sharedText = [meta.title, meta.text].filter(Boolean).join('\n');
      state.link = meta.url || (state.sharedText.match(/https?:\/\/\S+/)?.[0] ?? '');
    }
    state.menu = null; state.recs = null;
    state.autoStart = Boolean(files.length || state.link);
  } catch {
    state.error = 'Couldn’t open what you shared. Try adding it here directly.';
  }
  return true;
}

export function renderRead(root, ctx) {
  const { store } = ctx;
  if (state.occasion === undefined) {
    const d = store.profile.settings.defaultOccasion;
    state.occasion = d in OCCASIONS ? d : null; // 'ask' starts unset
  }
  const rerender = () => renderRead(root, ctx);

  mount(root,
    h('section.intro', {},
      h('p.eyebrow', {}, 'Read a menu'),
      h('h1.display', {}, 'What’s good here, for you?'),
      h('p.lede', {}, 'Photograph a menu at the table, paste a Google Maps or delivery link from the office chat, or share screenshots. I’ll translate it, explain each dish, and pick a few for you.'),
    ),
    sourceForm(ctx, rerender),
    state.busy && h('div.working', { role: 'status' }, h('span.dot'), state.busy),
    state.error && h('p.error', { role: 'alert' }, state.error),
    state.menu && !state.busy && results(ctx, rerender),
  );
  if (state.autoStart && ctx.ai.available) {
    state.autoStart = false;
    readMenu(ctx, rerender);
  }
}

function sourceForm(ctx, rerender) {
  const { ai } = ctx;
  const tabs = [['photos', 'Photos & screenshots'], ['link', 'Link'], ['sample', 'Sample menu']];
  const disabled = !ai.available && state.tab !== 'sample';

  const addFiles = (list) => {
    for (const file of [...list]) {
      if (state.pages.length >= 8) { toast('Up to 8 pages at a time.'); break; }
      state.pages.push({ file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
    }
    state.error = null;
    rerender();
  };

  let input;
  if (state.tab === 'photos') {
    input = h('div.photos', {},
      h('p.hint.top', {}, 'At the table: photograph each page. From Google Maps or a delivery app: screenshot the menu and add the screenshots.'),
      state.pages.length > 0 && h('ol.pages', {}, state.pages.map((pg, i) => h('li.page', {},
        pg.url ? h('img', { src: pg.url, alt: `Page ${i + 1}` }) : h('span.pdf', {}, 'PDF'),
        h('span.page-n', {}, String(i + 1)),
        h('button.remove', {
          type: 'button', 'aria-label': `Remove page ${i + 1}`,
          onclick: () => { if (pg.url) URL.revokeObjectURL(pg.url); state.pages.splice(i, 1); rerender(); },
        }, '×')))),
      h('div.actions', {},
        h('label.button', {}, state.pages.length ? 'Take another photo' : 'Take a photo',
          h('input.visually-hidden', { type: 'file', accept: 'image/*', capture: 'environment', onchange: (e) => addFiles(e.target.files) })),
        h('label.button.ghost', {}, 'Choose photos, screenshots or a PDF',
          h('input.visually-hidden', { type: 'file', accept: 'image/*,application/pdf', multiple: true, onchange: (e) => addFiles(e.target.files) }))),
    );
  } else if (state.tab === 'link') {
    const k = linkKind(state.link);
    const hint = {
      maps: 'Google Maps link — I’ll find this restaurant’s own menu online. If I can’t, screenshots of its menu photos always work.',
      platform: `${k.name} — I’ll try to read it. If ${k.name} blocks me, I’ll look for the restaurant’s own menu and tell you.`,
      website: 'Restaurant website or PDF menu.',
    }[k.kind] ?? 'A restaurant website, a Google Maps link, or a Lieferando, Wolt or Uber Eats page.';
    input = h('label.field', {}, h('span', {}, 'Link'),
      h('input', {
        type: 'text', inputmode: 'url', autocomplete: 'off', placeholder: 'https://maps.app.goo.gl/… · lieferando.de/… · restaurant.de/speisekarte',
        value: state.link,
        oninput: (e) => {
          const before = linkKind(state.link).kind;
          state.link = e.target.value; state.sharedText = '';
          if (linkKind(state.link).kind !== before) { rerender(); document.querySelector('.source input[type=text]')?.focus(); }
        },
      }),
      h('span.hint', {}, hint),
      state.sharedText && h('span.hint', {}, `Shared: ${state.sharedText.split('\n')[0]}`));
  } else {
    input = h('p.muted', {}, 'A fictional Sichuan restaurant in Berlin, bundled with the app. Works without an AI key.');
  }

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
      onclick: () => { state.occasion = state.occasion === id ? null : id; persist(); rerender(); },
    }, o.label))),
    h('p.hint', {}, OCCASIONS[state.occasion]?.blurb ?? 'Not set — I’ll ask if it changes what I’d pick.'),
  ),
  h('label.field', {}, h('span', {}, 'Anything in particular today? ', h('em', {}, 'optional, not saved to your profile')),
    h('input', { type: 'text', maxlength: 300, placeholder: 'e.g. something light, no noodles, I’m starving', value: state.request, oninput: (e) => { state.request = e.target.value; } })),
  h('div.actions', {},
    h('button.primary', { type: 'submit', disabled: Boolean(state.busy) || disabled }, state.tab === 'sample' ? 'Open the sample menu' : 'Read the menu'),
    state.menu && h('button.ghost', { type: 'button', disabled: Boolean(state.busy), onclick: () => refreshPicks(ctx, rerender) }, 'Update picks'),
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
      const { translateTo, glossLanguages, homeCity } = ctx.store.profile.settings;
      let source;
      if (state.tab === 'link') {
        const text = [state.sharedText, state.link].filter(Boolean).join('\n').trim();
        const url = text.match(/https?:\/\/\S+/)?.[0] ?? (state.link.trim() ? `https://${state.link.trim().replace(/^\/+/, '')}` : '');
        if (!url) throw new Error('Paste a link first.');
        source = { type: 'url', url, text };
        state.busy = {
          maps: 'Finding this restaurant’s menu online… this can take half a minute.',
          platform: 'Reading the delivery menu…',
        }[linkKind(text).kind] ?? 'Fetching the page and reading the menu…';
      } else {
        if (!state.pages.length) throw new Error('Take a photo or add a screenshot first.');
        state.busy = 'Preparing your pages…'; rerender();
        source = { type: 'files', files: await readFiles(state.pages.map((p) => p.file)) };
        state.busy = `Reading ${plural(state.pages.length, 'page')}…`;
      }
      rerender();
      state.menu = normalizeMenu(await api.extract(source, { translateTo, glossLanguages, homeCity }));
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
        language: profile.settings.translateTo, includeAdventurous: profile.settings.includeAdventurousPick,
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
        h('p.eyebrow', {}, state.occasion ? `For you · ${OCCASIONS[state.occasion].label}` : 'For you'),
        h('p.headline', {}, recs.headline),
        h('p.engine', {}, recs.engine === 'ai'
          ? 'Picked by the AI from your profile. Details marked “typical” are general knowledge, not from this menu.'
          : 'Picked by the built-in matcher, which only uses exact matches with your profile.'),
        recs.fallbackReason && h('p.error.small', {}, `The AI couldn’t help this time (${recs.fallbackReason}), so these come from the built-in matcher.`),
      ),
      recs.occasionQuestion && !state.occasion && h('div.ask', {},
        h('p', {}, recs.occasionQuestion),
        h('div.chips', {}, ['solo', 'sharing', 'office'].map((id) => h('button.chip', {
          type: 'button', onclick: () => { state.occasion = id; refreshPicks(ctx, rerender); },
        }, OCCASIONS[id].label)))),
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

    h('section.order-tray', { id: 'order-tray' }, orderTray(ctx)),

    h('section.full-menu', {},
      h('h2.section-title', {}, 'The whole menu'),
      [...sections].map(([name, dishes]) => h('div.menu-section', {},
        h('h3.menu-section-title', {}, name),
        dishes.map((d) => h('details.dish-row', {},
          h('summary', {},
            h('span.names', {}, h('span.orig', {}, d.originalName), d.translatedName && h('span.trans', {}, d.translatedName), glosses(d)),
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
        h('div', {}, h('h3.dish-name', {}, d.originalName), d.translatedName && h('p.dish-trans', {}, d.translatedName), glosses(d)),
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

function glosses(d) {
  return d.glosses?.length ? h('span.glosses', {}, d.glosses.map((g) => `${g.language}: ${g.name}`).join(' · ')) : null;
}

export function dishDetail(d) {
  const style = d.attributes.filter((a) => STYLE_ATTRIBUTES.includes(a));
  const ing = d.ingredients;
  const prep = d.preparation;
  const hasTypical = ing.some((x) => x.source === 'typical') || prep.some((x) => x.source === 'typical');
  return h('div.dish-detail', {},
    style.length > 0 && h('p.style', {}, style.map((a) => h('span.badge', {}, a))),
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
    refreshTray(ctx);
    toast(action === 'ordered' ? 'Added to your order. Tell me how it was afterwards.' : 'Saved to your journal.', { href: '#/journal', label: 'Open journal' });
  };
  return h('div.dish-actions', {},
    h('button.small', { type: 'button', disabled: inJournal('ordered'), dataset: { order: d.originalName }, onclick: (e) => add('ordered', e) }, inJournal('ordered') ? 'Ordered ✓' : 'I’m ordering this'),
    h('button.small.ghost', { type: 'button', disabled: inJournal('saved'), onclick: (e) => add('saved', e) }, inJournal('saved') ? 'Saved ✓' : 'Save for later'),
  );
}

function groupBy(list, fn) {
  const m = new Map();
  for (const x of list) { const k = fn(x); m.set(k, [...(m.get(k) ?? []), x]); }
  return m;
}

// --- Your order: show to staff, copy for chat -------------------------------------

function currentOrder(store) {
  if (!state.menu) return [];
  const byName = new Map(state.menu.dishes.map((d) => [d.originalName, d]));
  return store.profile.history
    .filter((x) => x.action === 'ordered' && !x.feedbackAt && x.restaurant.name === (state.menu.restaurant.name ?? null)
      && byName.has(x.dish.originalName) && Date.now() - Date.parse(x.at) < 12 * 3600e3)
    .reverse()
    .map((entry) => ({ entry, dish: byName.get(entry.dish.originalName) }));
}

function refreshTray(ctx) {
  const el = document.getElementById('order-tray');
  if (el) mount(el, orderTray(ctx));
}

function orderTotal(items) {
  const amounts = items.map((i) => i.dish.price);
  if (!amounts.length || amounts.some((p) => p.amount == null)) return null;
  const currencies = new Set(amounts.map((p) => p.currency));
  if (currencies.size > 1) return null;
  const sum = amounts.reduce((s, p) => s + p.amount, 0);
  const cur = [...currencies][0];
  return cur === 'EUR' ? `${sum.toFixed(2).replace('.', ',')} €` : `${sum.toFixed(2)}${cur ? ` ${cur}` : ''}`;
}

export function orderText(menu, items) {
  const lines = items.map(({ dish }) => {
    const names = [dish.originalName, dish.glosses?.find((g) => /english/i.test(g.language))?.name ?? null].filter(Boolean);
    const price = priceLabel(dish);
    return `• ${names.join(' — ')}${price ? ` (${price})` : ''}`;
  });
  const total = orderTotal(items);
  return [`${menu.restaurant.name ?? 'Order'}:`, ...lines, total ? `Total: ${total}` : null].filter(Boolean).join('\n');
}

function orderTray(ctx) {
  const items = currentOrder(ctx.store);
  if (!items.length) return null;
  const total = orderTotal(items);
  return h('div.tray', {},
    h('div.block-head', {}, h('h2.section-title', {}, 'Your order'), total && h('span.price', {}, total)),
    h('ul.tray-list', {}, items.map(({ entry, dish }) => h('li', {},
      h('span', {}, h('strong', {}, dish.originalName), dish.translatedName && h('span.muted', {}, ` · ${dish.translatedName}`)),
      h('span.tray-right', {}, priceLabel(dish) ?? '', h('button.small.ghost', {
        type: 'button', 'aria-label': `Remove ${dish.originalName}`,
        onclick: async () => {
          await ctx.store.do('removeHistory', entry.id);
          const btn = [...document.querySelectorAll('[data-order]')].filter((b) => b.dataset.order === dish.originalName);
          btn.forEach((b) => { b.disabled = false; b.textContent = 'I’m ordering this'; });
          refreshTray(ctx);
        },
      }, 'Remove'))))),
    h('div.actions', {},
      h('button.small.primary', { type: 'button', onclick: () => showToStaff(items) }, 'Show to staff'),
      h('button.small', {
        type: 'button',
        onclick: async () => {
          const text = orderText(state.menu, items);
          try { await navigator.clipboard.writeText(text); toast('Copied — paste it into the chat.'); } catch { prompt('Copy your order:', text); }
        },
      }, 'Copy for chat')),
  );
}

function showToStaff(items) {
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const overlay = h('div.staff', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Order to show staff' },
    h('p.eyebrow', {}, state.menu.restaurant.name ?? ''),
    h('ol.staff-list', {}, items.map(({ dish }) => h('li', {},
      h('span.staff-name', {}, dish.originalName),
      dish.section && h('span.staff-sub', {}, dish.section),
      priceLabel(dish) && h('span.staff-sub', {}, priceLabel(dish))))),
    h('button.staff-close', { type: 'button', onclick: close }, 'Done'),
  );
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  overlay.querySelector('.staff-close').focus();
}
