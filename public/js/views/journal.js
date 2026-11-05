import { h, mount, toast, fmtDate } from '../dom.js';
import { FEEDBACK } from '/shared/model.js';
import { signalsFor } from '/shared/profile.js';

const open = new Set(); // entries whose feedback editor is open

export function renderJournal(root, ctx) {
  const { store } = ctx;
  const rerender = () => renderJournal(root, ctx);
  const history = store.profile.history;
  const waiting = history.filter((x) => x.action === 'ordered' && !x.feedbackAt);

  mount(root,
    h('section.intro', {},
      h('p.eyebrow', {}, 'Journal'),
      h('h1.display', {}, 'What you’ve eaten'),
      h('p.lede', {}, 'Ordering something teaches me nothing on its own. Your feedback does — and you can see exactly what each piece taught me.'),
    ),
    waiting.length > 0 && h('p.callout', {}, `${waiting.length === 1 ? 'One dish is' : `${waiting.length} dishes are`} waiting for your verdict.`),
    addForm(ctx, rerender),
    history.length === 0
      ? h('p.empty', {}, 'Nothing yet. When you order from a menu, it lands here.')
      : h('ol.journal', {}, history.map((entry) => journalEntry(ctx, entry, rerender))),
  );
}

function journalEntry(ctx, entry, rerender) {
  const { store } = ctx;
  const editing = open.has(entry.id) || (entry.action === 'ordered' && !entry.feedbackAt);
  const statusLabel = { ordered: 'Ordered', saved: 'Saved for later', skipped: 'Skipped' }[entry.action];
  return h('li.entry', {},
    h('div.entry-meta', {}, fmtDate(entry.at), ' · ', statusLabel, entry.recommended ? ' · recommended' : '', entry.restaurant.name ? ` · ${entry.restaurant.name}` : ''),
    h('h3.dish-name.s', {}, entry.dish.originalName),
    entry.dish.translatedName && h('p.dish-trans', {}, entry.dish.translatedName),
    entry.feedback.length > 0 && !open.has(entry.id) && h('p.verdict', {},
      entry.feedback.map((t) => h('span.chip.static', { class: FEEDBACK[t].tone }, FEEDBACK[t].label)),
      entry.note && h('span.note', {}, ` “${entry.note}”`)),
    editing ? feedbackEditor(ctx, entry, rerender) : h('div.entry-actions', {},
      h('button.small.ghost', { type: 'button', onclick: () => { open.add(entry.id); rerender(); } }, entry.feedback.length ? 'Change feedback' : (entry.action === 'saved' ? 'I had it — give feedback' : 'Give feedback')),
      h('button.small.ghost.danger', {
        type: 'button',
        onclick: async () => {
          if (!confirm('Remove this from your journal? Anything it taught your profile is withdrawn too.')) return;
          await store.do('removeHistory', entry.id); rerender();
        },
      }, 'Remove'),
    ),
  );
}

function feedbackEditor(ctx, entry, rerender) {
  const chosen = new Set(entry.feedback);
  let note = entry.note;
  const preview = h('div.preview');
  const updatePreview = () => mount(preview, teaches([...chosen], entry, ctx.store.profile));

  const chips = Object.entries(FEEDBACK).map(([id, f]) => h('button', {
    type: 'button', class: `chip ${f.tone}${chosen.has(id) ? ' on' : ''}`, 'aria-pressed': String(chosen.has(id)),
    onclick: (e) => {
      chosen.has(id) ? chosen.delete(id) : chosen.add(id);
      e.currentTarget.classList.toggle('on'); e.currentTarget.setAttribute('aria-pressed', String(chosen.has(id)));
      updatePreview();
    },
  }, f.label));
  updatePreview();

  return h('form.feedback', {
    onsubmit: async (e) => {
      e.preventDefault();
      const { touched } = await ctx.store.do('applyFeedback', entry.id, [...chosen], note.trim());
      open.delete(entry.id);
      rerender();
      toast(touched.length ? `Noted. ${touched.length === 1 ? 'One part' : `${touched.length} parts`} of your profile updated.` : 'Noted. Your profile is unchanged.', touched.length ? { href: '#/profile', label: 'See profile' } : null);
    },
  },
  h('p.small.muted', {}, 'How was it? Pick any that apply.'),
  h('div.chips', {}, chips),
  h('label.field', {}, h('span', {}, 'In your own words ', h('em', {}, 'optional')),
    h('input', { type: 'text', maxlength: 300, value: note, oninput: (e) => { note = e.target.value; } })),
  preview,
  h('div.actions', {},
    h('button.primary.small', { type: 'submit' }, 'Save feedback'),
    open.has(entry.id) && h('button.ghost.small', { type: 'button', onclick: () => { open.delete(entry.id); rerender(); } }, 'Cancel'),
    entry.action === 'ordered' && !entry.feedbackAt && h('button.ghost.small', {
      type: 'button',
      onclick: async () => { await ctx.store.do('applyFeedback', entry.id, [], ''); rerender(); },
    }, 'No feedback'),
  ));
}

/** Plain-language preview of what the chosen feedback will teach the profile. */
function teaches(tags, entry, profile) {
  if (!tags.length) return h('p.small.muted', {}, 'Nothing selected — your profile won’t change.');
  const lines = [];
  for (const t of tags) {
    const sigs = signalsFor(t, entry.dish);
    if (!sigs.length) lines.push(`“${FEEDBACK[t].label}” is noted on this entry only.`);
    for (const s of sigs) {
      const dismissed = profile.preferences.some((p) => p.status === 'dismissed' && p.polarity === s.polarity && p.subject.toLowerCase() === s.subject.toLowerCase());
      lines.push(`${s.polarity === 'like' ? 'You might like' : 'You might not enjoy'} ${s.subject}${dismissed ? ' (you dismissed this before; it stays dismissed)' : ''}`);
    }
  }
  return h('div.teaches', {},
    h('p.small', {}, 'This will add evidence for:'),
    h('ul.small', {}, [...new Set(lines)].map((l) => h('li', {}, l))),
    h('p.small.muted', {}, 'These stay suggestions until you confirm them in your profile.'));
}

function addForm(ctx, rerender) {
  let name = ''; let place = '';
  return h('details.add', {},
    h('summary', {}, 'Add something you ate elsewhere'),
    h('form.inline', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        await ctx.store.do('recordHistory', { action: 'ordered', dish: { originalName: name.trim() }, restaurant: { name: place.trim() || null } });
        rerender();
      },
    },
    h('label.field', {}, h('span', {}, 'Dish'), h('input', { required: true, maxlength: 120, oninput: (e) => { name = e.target.value; } })),
    h('label.field', {}, h('span', {}, 'Where ', h('em', {}, 'optional')), h('input', { maxlength: 120, oninput: (e) => { place = e.target.value; } })),
    h('button.small', { type: 'submit' }, 'Add')),
  );
}
