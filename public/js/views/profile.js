import { h, mount, toast, fmtDate, plural } from '../dom.js';
import { api } from '../api.js';
import { CATEGORIES, OCCASIONS, RESTRICTION_TYPES, confidenceLabel } from '/shared/model.js';
import { exportProfile, isEmerging, evidenceScore, isUnverifiedPrior } from '/shared/profile.js';

const ui = { editing: null, adding: null, importText: '', proposal: null, busy: false };

export function renderProfile(root, ctx) {
  const { store } = ctx;
  const p = store.profile;
  const rerender = () => renderProfile(root, ctx);

  const live = p.preferences.filter((x) => x.status === 'active');
  const likes = live.filter((x) => x.polarity === 'like');
  const dislikes = live.filter((x) => x.polarity === 'dislike');
  const suggested = p.preferences.filter((x) => x.status === 'suggested' && !isEmerging(x));
  const emerging = p.preferences.filter((x) => x.status === 'suggested' && isEmerging(x));
  const dismissed = p.preferences.filter((x) => x.status === 'dismissed');

  mount(root,
    h('section.intro', {},
      h('p.eyebrow', {}, 'Taste profile'),
      h('h1.display', {}, 'What I know about your taste'),
      h('p.lede', {}, 'All of this lives on this device, separate from the AI. Each request sends only a compact summary. Edit anything; nothing here is final.'),
      !store.persisted && h('p.error', {}, 'Your browser is blocking storage, so changes will be lost when you close this tab. Export your profile to keep it.'),
    ),

    section('You enjoy', 'Stated by you, or patterns you confirmed.', likes, ctx, rerender, { polarity: 'like' }),
    section('You’d rather avoid', 'Taste, not safety — allergies go further down.', dislikes, ctx, rerender, { polarity: 'dislike' }),

    h('section.block', {},
      h('h2.section-title', {}, 'To be confirmed'),
      h('p.muted', {}, 'Things you listed as likely, and patterns from your feedback on dishes you ordered. They count for less until you confirm them.'),
      suggested.length ? h('ul.prefs', {}, suggested.map((x) => prefRow(x, ctx, rerender))) : h('p.empty', {}, 'None yet. Give feedback in your journal and patterns will appear here.'),
      emerging.length > 0 && h('details.quiet', {},
        h('summary', {}, `Early signals (${emerging.length}) — too thin to use yet`),
        h('ul.prefs', {}, emerging.map((x) => prefRow(x, ctx, rerender)))),
    ),

    guidanceBlock(ctx, rerender),
    restrictionsBlock(ctx, rerender),
    importBlock(ctx, rerender),
    settingsBlock(ctx, rerender),

    dismissed.length > 0 && h('section.block', {},
      h('details.quiet', {},
        h('summary', {}, `Dismissed (${dismissed.length})`),
        h('p.small.muted', {}, 'You said these aren’t you. I keep them so I don’t suggest them again.'),
        h('ul.prefs', {}, dismissed.map((x) => prefRow(x, ctx, rerender))))),

    dataBlock(ctx, rerender),
  );
}

function section(title, blurb, list, ctx, rerender, defaults) {
  const key = `add-${defaults.polarity}`;
  return h('section.block', {},
    h('div.block-head', {},
      h('h2.section-title', {}, title),
      h('button.small.ghost', { type: 'button', onclick: () => { ui.adding = ui.adding === key ? null : key; rerender(); } }, ui.adding === key ? 'Close' : 'Add'),
    ),
    h('p.muted', {}, blurb),
    ui.adding === key && prefForm(defaults, async (fields) => { await ctx.store.do('addPreference', fields); ui.adding = null; rerender(); }, () => { ui.adding = null; rerender(); }),
    list.length ? h('ul.prefs', {}, list.map((x) => prefRow(x, ctx, rerender))) : h('p.empty', {}, 'Nothing here yet.'),
  );
}

function prefRow(pref, ctx, rerender) {
  const { store } = ctx;
  if (ui.editing === pref.id) {
    return h('li.pref.editing', {}, prefForm(pref, async (fields) => {
      await store.do('updatePreference', pref.id, fields); ui.editing = null; rerender();
    }, () => { ui.editing = null; rerender(); }));
  }
  const origin = pref.origin === 'explicit'
    ? (pref.evidence.some((e) => e.source === 'user_confirmed') ? 'you confirmed' : 'you said')
    : pref.status === 'active' ? 'you confirmed'
      : isUnverifiedPrior(pref) ? 'you listed as likely · not yet tested' : `noticed · ${confidenceLabel(pref.confidence)}`;
  const act = (op, label, cls = 'ghost') => h(`button.small.${cls}`, { type: 'button', onclick: async () => { await store.do(op, pref.id); rerender(); } }, label);

  return h('li.pref', {},
    h('div.pref-main', {},
      h('span.pref-subject', {}, pref.subject),
      h('span.pref-meta', {}, [pref.category, origin, ...pref.contexts.map((c) => `only ${OCCASIONS[c].label.toLowerCase()}`)].join(' · ')),
      pref.note && h('p.pref-note', {}, pref.note),
    ),
    h('div.pref-actions', {},
      pref.status === 'suggested' && act('confirmPreference', 'That’s me', 'confirm'),
      pref.status === 'suggested' && act('dismissPreference', 'Not me'),
      pref.status === 'dismissed' && act('restorePreference', 'Restore'),
      pref.status !== 'dismissed' && h('button.small.ghost', { type: 'button', onclick: () => { ui.editing = pref.id; rerender(); } }, 'Edit'),
      pref.status !== 'suggested' && h('button.small.ghost.danger', {
        type: 'button', onclick: async () => { if (confirm(`Delete “${pref.subject}”?`)) { await store.do('removePreference', pref.id); rerender(); } },
      }, 'Delete'),
    ),
    h('details.why', {},
      h('summary', {}, pref.origin === 'inferred' && pref.status === 'suggested'
        ? `Why I think this · ${plural(pref.evidence.length, 'piece')} of evidence (weight ${evidenceScore(pref).toFixed(1)})`
        : 'Evidence and history'),
      h('ul.evidence-list', {}, pref.evidence.map((e) => h('li', {}, h('span.date', {}, fmtDate(e.at)), ' ', e.note))),
      h('ul.history-list', {}, pref.history.map((c) => h('li', {}, h('span.date', {}, fmtDate(c.at)), ` ${c.by === 'user' ? 'You' : 'WasGibts'}: ${c.action}${c.detail ? ` — ${c.detail}` : ''}`))),
    ),
  );
}

function prefForm(initial, onSave, onCancel) {
  const f = { polarity: initial.polarity ?? 'like', category: initial.category ?? 'ingredient', subject: initial.subject ?? '', note: initial.note ?? '', contexts: [...(initial.contexts ?? [])] };
  return h('form.pref-form', {
    onsubmit: (e) => { e.preventDefault(); if (f.subject.trim()) onSave({ ...f, subject: f.subject.trim() }); },
  },
  h('div.row', {},
    h('label.field', {}, h('span', {}, 'I…'), select(['like', 'dislike'], f.polarity, (v) => { f.polarity = v; }, { like: 'enjoy', dislike: 'would rather avoid' })),
    h('label.field.grow', {}, h('span', {}, 'What'), h('input', { required: true, maxlength: 80, value: f.subject, placeholder: 'e.g. smoked fish, crunchy textures', oninput: (e) => { f.subject = e.target.value; } })),
    h('label.field', {}, h('span', {}, 'Kind'), select(CATEGORIES, f.category, (v) => { f.category = v; })),
  ),
  h('fieldset.contexts', {},
    h('legend', {}, 'Only on some occasions? ', h('em', {}, 'leave empty for always')),
    h('div.chips', {}, Object.entries(OCCASIONS).map(([id, o]) => h('label.chip.check', {},
      h('input', { type: 'checkbox', checked: f.contexts.includes(id), onchange: (e) => { f.contexts = e.target.checked ? [...f.contexts, id] : f.contexts.filter((c) => c !== id); } }),
      o.label))),
  ),
  h('label.field', {}, h('span', {}, 'Note ', h('em', {}, 'optional')), h('input', { maxlength: 200, value: f.note, oninput: (e) => { f.note = e.target.value; } })),
  h('div.actions', {}, h('button.small.primary', { type: 'submit' }, 'Save'), h('button.small.ghost', { type: 'button', onclick: onCancel }, 'Cancel')),
  );
}

function select(options, value, onChange, labels = {}) {
  return h('select', { onchange: (e) => onChange(e.target.value) },
    options.map((o) => h('option', { value: o, selected: o === value }, labels[o] ?? o)));
}

// --- Ground rules (standing guidance) -------------------------------------------

function guidanceBlock(ctx, rerender) {
  const { store } = ctx;
  let draft = '';
  return h('section.block', {},
    h('h2.section-title', {}, 'Ground rules'),
    h('p.muted', {}, 'Standing instructions, in your words, sent with every recommendation request. Use them for what I should not assume and how you like recommendations made.'),
    store.profile.guidance.length
      ? h('ul.guidance-list', {}, store.profile.guidance.map((g, i) => h('li', {},
        h('span', { contenteditable: 'plaintext-only', spellcheck: 'false', title: 'Click to edit', onblur: async (e) => { if (e.target.textContent.trim() !== g) { await store.do('updateGuidance', i, e.target.textContent); rerender(); } } }, g),
        h('button.small.ghost.danger', { type: 'button', onclick: async () => { await store.do('removeGuidance', i); rerender(); } }, 'Remove'))))
      : h('p.empty', {}, 'No ground rules yet.'),
    h('form.inline', { onsubmit: async (e) => { e.preventDefault(); if (draft.trim()) { await store.do('addGuidance', draft); rerender(); } } },
      h('label.field', {}, h('span', {}, 'Add a rule'), h('input', { maxlength: 200, placeholder: 'e.g. Don’t assume I want dessert', oninput: (e) => { draft = e.target.value; } })),
      h('button.small', { type: 'submit' }, 'Add')),
  );
}

// --- Restrictions --------------------------------------------------------------

function restrictionsBlock(ctx, rerender) {
  const { store } = ctx;
  const p = store.profile;
  const f = { type: 'allergy', subject: '', severity: 'strict', note: '' };
  return h('section.block.sensitive', {},
    h('div.block-head', {},
      h('h2.section-title', {}, 'Allergies & restrictions'),
      h('span.optional', {}, 'Optional'),
    ),
    h('p.muted', {}, 'Hard limits rather than taste. Strict ones are never recommended; possible conflicts are always flagged. Menus are incomplete — always confirm with the restaurant.'),
    h('label.toggle', {},
      h('input', { type: 'checkbox', checked: p.settings.shareRestrictionsWithAI, onchange: async (e) => { await store.setSettings({ shareRestrictionsWithAI: e.target.checked }); rerender(); } }),
      ' Include these when asking the AI for recommendations'),
    !p.settings.shareRestrictionsWithAI && h('p.small.muted', {}, 'Kept on this device only. Recommendations will not account for them.'),
    p.restrictions.length ? h('ul.prefs', {}, p.restrictions.map((r) => h('li.pref', {},
      h('div.pref-main', {},
        h('span.pref-subject', {}, r.subject),
        h('span.pref-meta', {}, `${r.type} · ${r.severity}`),
        r.note && h('p.pref-note', {}, r.note)),
      h('div.pref-actions', {},
        h('button.small.ghost', { type: 'button', onclick: async () => { await store.do('updateRestriction', r.id, { severity: r.severity === 'strict' ? 'flexible' : 'strict' }); rerender(); } }, r.severity === 'strict' ? 'Make flexible' : 'Make strict'),
        h('button.small.ghost.danger', { type: 'button', onclick: async () => { if (confirm(`Remove “${r.subject}”?`)) { await store.do('removeRestriction', r.id); rerender(); } } }, 'Remove'))))) : h('p.empty', {}, 'None recorded.'),
    h('details.add', {},
      h('summary', {}, 'Add a restriction'),
      h('form.pref-form', {
        onsubmit: async (e) => { e.preventDefault(); if (!f.subject.trim()) return; await store.do('addRestriction', { ...f, subject: f.subject.trim() }); rerender(); },
      },
      h('div.row', {},
        h('label.field', {}, h('span', {}, 'Type'), select(RESTRICTION_TYPES, f.type, (v) => { f.type = v; })),
        h('label.field.grow', {}, h('span', {}, 'What'), h('input', { required: true, maxlength: 80, placeholder: 'e.g. shellfish, pork, lactose', oninput: (e) => { f.subject = e.target.value; } })),
        h('label.field', {}, h('span', {}, 'How strict'), select(['strict', 'flexible'], f.severity, (v) => { f.severity = v; }, { strict: 'strict', flexible: 'flexible (traces OK)' }))),
      h('label.field', {}, h('span', {}, 'Note ', h('em', {}, 'optional')), h('input', { maxlength: 200, oninput: (e) => { f.note = e.target.value; } })),
      h('button.small.primary', { type: 'submit' }, 'Add'))),
  );
}

// --- Import from own words ------------------------------------------------------

function importBlock(ctx, rerender) {
  const { store, ai } = ctx;
  return h('section.block', {},
    h('h2.section-title', {}, 'Describe yourself in your own words'),
    h('p.muted', {}, 'Paste or write how you like to eat — a paragraph, a list, an old note. I’ll propose entries; you choose which to keep.'),
    !ai.available && h('p.small.muted', {}, 'Needs an AI key on the server. You can still add entries by hand above or import a JSON profile below.'),
    h('textarea', { rows: 6, maxlength: 20000, disabled: !ai.available, placeholder: 'I love anything sour or pickled, can’t stand coriander, and I’m allergic to peanuts. At lunch I want something light…', value: ui.importText, oninput: (e) => { ui.importText = e.target.value; } }),
    h('div.actions', {},
      h('button.small', {
        type: 'button', disabled: !ai.available || ui.busy,
        onclick: async () => {
          ui.busy = true; rerender();
          try { ui.proposal = withSelection(await api.parseProfile(ui.importText)); } catch (err) { toast(err.message); }
          ui.busy = false; rerender();
        },
      }, ui.busy ? 'Reading…' : 'Propose entries'),
    ),
    ui.proposal && proposalReview(store, rerender),
  );
}

const withSelection = (pr) => ({
  ...pr,
  preferences: pr.preferences.map((x) => ({ ...x, keep: true })),
  restrictions: pr.restrictions.map((x) => ({ ...x, keep: true })),
  history: pr.history.map((x) => ({ ...x, keep: true })),
});

function proposalReview(store, rerender) {
  const pr = ui.proposal;
  const row = (item, label) => h('li', {}, h('label.check-row', {},
    h('input', { type: 'checkbox', checked: item.keep, onchange: (e) => { item.keep = e.target.checked; } }),
    h('span', {}, h('strong', {}, label), item.quote && h('span.quote', {}, ` — “${item.quote}”`))));
  const total = pr.preferences.length + pr.restrictions.length + pr.history.length;
  return h('div.proposal', {},
    total === 0 ? h('p.empty', {}, 'I couldn’t find anything specific to add.') : [
      pr.preferences.length > 0 && [h('h3', {}, 'Taste'), h('ul.plain', {}, pr.preferences.map((x) => row(x, `${x.polarity === 'like' ? 'Enjoy' : 'Avoid'}: ${x.subject}${x.contexts.length ? ` (${x.contexts.join(', ')})` : ''}`)))],
      pr.restrictions.length > 0 && [h('h3', {}, 'Restrictions'), h('ul.plain', {}, pr.restrictions.map((x) => row(x, `${x.type}: ${x.subject} (${x.severity})`)))],
      pr.history.length > 0 && [h('h3', {}, 'Dishes you mentioned'), h('ul.plain', {}, pr.history.map((x) => row(x, `${x.dish}${x.restaurant ? ` at ${x.restaurant}` : ''} — ${x.sentiment}`)))],
    ],
    h('div.actions', {},
      total > 0 && h('button.small.primary', {
        type: 'button',
        onclick: async () => {
          for (const x of pr.preferences.filter((y) => y.keep)) await store.do('addPreference', { polarity: x.polarity, category: x.category, subject: x.subject, note: x.note, contexts: x.contexts });
          for (const x of pr.restrictions.filter((y) => y.keep)) await store.do('addRestriction', x);
          for (const x of pr.history.filter((y) => y.keep)) {
            const entry = await store.do('recordHistory', { action: 'ordered', dish: { originalName: x.dish }, restaurant: { name: x.restaurant } });
            const tag = { loved: ['loved'], liked: ['liked'], disliked: ['disliked'] }[x.sentiment] ?? [];
            await store.do('applyFeedback', entry.id, tag, x.quote);
          }
          if (pr.about && !store.profile.about.notes) await store.setAbout({ notes: pr.about });
          ui.proposal = null; ui.importText = '';
          rerender();
          toast('Added to your profile.');
        },
      }, 'Add selected'),
      h('button.small.ghost', { type: 'button', onclick: () => { ui.proposal = null; rerender(); } }, 'Discard'),
    ),
  );
}

// --- Settings & data ---------------------------------------------------------------

function settingsBlock(ctx, rerender) {
  const { store } = ctx;
  const s = store.profile.settings;
  return h('section.block', {},
    h('h2.section-title', {}, 'Settings'),
    h('div.row', {},
      h('label.field', {}, h('span', {}, 'Translate & explain in'),
        h('input', { value: s.translateTo, maxlength: 60, onchange: async (e) => { await store.setSettings({ translateTo: e.target.value.trim() || 'English' }); } })),
      h('label.field', {}, h('span', {}, 'Also show names in'),
        h('input', { value: s.glossLanguages.join(', '), maxlength: 80, placeholder: 'e.g. English, German', onchange: async (e) => { await store.setSettings({ glossLanguages: e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 4) }); } })),
    ),
    h('div.row', {},
      h('label.field', {}, h('span', {}, 'Home city'),
        h('input', { value: s.homeCity, maxlength: 80, placeholder: 'e.g. Munich, Germany', onchange: async (e) => { await store.setSettings({ homeCity: e.target.value.trim() }); } })),
      h('label.field', {}, h('span', {}, 'Occasion when opening a menu'),
        select(['ask', ...Object.keys(OCCASIONS)], s.defaultOccasion, async (v) => { await store.setSettings({ defaultOccasion: v }); }, { ask: 'Ask me', ...Object.fromEntries(Object.entries(OCCASIONS).map(([k, o]) => [k, o.label])) })),
    ),
    h('label.toggle', {},
      h('input', { type: 'checkbox', checked: s.includeAdventurousPick, onchange: async (e) => { await store.setSettings({ includeAdventurousPick: e.target.checked }); } }),
      ' Always include one adventurous or regional pick'),
    h('label.field', {}, h('span', {}, 'About you as an eater ', h('em', {}, 'optional, sent with requests')),
      h('textarea', { rows: 2, maxlength: 500, value: store.profile.about.notes, onchange: async (e) => { await store.setAbout({ notes: e.target.value }); } })),
  );
}

function dataBlock(ctx, rerender) {
  const { store } = ctx;
  return h('section.block.data', {},
    h('h2.section-title', {}, 'Your data'),
    h('p.muted', {}, `${plural(store.profile.preferences.length, 'preference')}, ${plural(store.profile.restrictions.length, 'restriction')}, ${plural(store.profile.history.length, 'journal entry', 'journal entries')}. Last changed ${fmtDate(store.profile.updatedAt)}.`),
    h('div.actions.wrap', {},
      h('button.small', {
        type: 'button',
        onclick: () => {
          const blob = new Blob([JSON.stringify(exportProfile(store.profile), null, 2)], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `wasgibts-profile-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(a); a.click(); a.remove();
        },
      }, 'Export as JSON'),
      h('label.button.small.ghost', {}, 'Import JSON…', h('input.visually-hidden', {
        type: 'file', accept: 'application/json,.json',
        onchange: async (e) => {
          const file = e.target.files[0]; if (!file) return;
          try {
            const raw = JSON.parse(await file.text());
            if (!confirm('Replace your current profile with this file?')) return;
            await store.replace(raw); rerender(); toast('Profile imported.');
          } catch { toast('That file is not a WasGibts profile.'); }
        },
      })),
      h('button.small.ghost', { type: 'button', onclick: async () => { if (confirm('Reset to the starting profile? Your journal and changes will be lost.')) { await store.resetToSeed(); rerender(); } } }, 'Reset to starting profile'),
      h('button.small.ghost.danger', { type: 'button', onclick: async () => { if (confirm('Delete your entire profile and journal from this device? This cannot be undone.')) { await store.wipe(); rerender(); toast('Everything deleted.'); } } }, 'Delete everything'),
    ),
  );
}
