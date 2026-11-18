// Kitchen: the shared side of WasGibts. Sign in, start or join a household
// (the cook and the person eating the boxes), invite someone, and choose to
// share your restrictions with the cook. Recipe ideas and the weekly boxes
// build on this. Everything else in the app works without signing in.

import { h, mount, toast } from '../dom.js';
import * as cloud from '../cloud.js';
import { api } from '../api.js';
import { CUISINES } from '/shared/recipes.js';

const ui = { step: 'email', email: '', code: '', busy: false, error: null, user: undefined, households: null, members: [], invite: null, shared: null, name: '', joinCode: '', listening: false, cuisine: 'Taiwanese', wish: '', ideas: null, removed: [], saved: null, filter: 'All', savedIds: new Set() };

export function renderKitchen(root, ctx) {
  const rerender = () => renderKitchen(root, ctx);
  if (!ui.listening) {
    ui.listening = true;
    cloud.onAuthChange(async (user) => { ui.user = user; ui.households = null; await load(ctx); rerender(); }).catch((e) => { ui.error = e.message; rerender(); });
  }
  if (ui.user === undefined) {
    mount(root, intro(), h('p.muted', {}, 'Loading…'));
    load(ctx).then(rerender);
    return;
  }
  const home = ui.households?.[0] ?? null;
  mount(root,
    intro(),
    ui.error && h('p.error', { role: 'alert' }, ui.error),
    !ui.user ? signIn(rerender)
      : !home ? startOrJoin(ctx, rerender)
        : household(ctx, home, rerender),
  );
}

async function load(ctx) {
  try {
    ui.user = await cloud.currentUser();
    if (ui.user && ui.households === null) {
      ui.households = await cloud.myHouseholds();
      const home = ui.households[0];
      if (home) {
        ui.members = await cloud.members(home.id);
        const shared = await cloud.sharedRestrictions(home.id);
        ui.shared = shared.find((r) => r.user_id === ui.user.id) ?? null;
        ui.everyone = shared;
        ui.saved = await cloud.listRecipes(home.id);
      }
    }
    ui.error = null;
  } catch (e) { ui.error = e.message; ui.user ??= null; }
}

function intro() {
  return h('section.intro', {},
    h('p.eyebrow', {}, 'Kitchen'),
    h('h1.display', {}, 'Cook for two'),
    h('p.lede', {}, 'Plan weekend meal-prep boxes and share them with the person eating them. They see what’s in box 1, 2, 3… on their own phone.'));
}

const busy = async (rerender, fn) => {
  ui.busy = true; ui.error = null; rerender();
  try { await fn(); } catch (e) { ui.error = e.message; }
  ui.busy = false; rerender();
};

function signIn(rerender) {
  if (ui.step === 'code') {
    return h('form.block.kitchen-card', { onsubmit: (e) => { e.preventDefault(); busy(rerender, async () => { await cloud.verifyCode(ui.email, ui.code); ui.households = null; }); } },
      h('h2.section-title', {}, 'Check your email'),
      h('p', {}, `I sent a sign-in email to ${ui.email}. Type the 6-digit code from it, or tap the link in the email on this device.`),
      h('label.field', {}, h('span', {}, 'Code'),
        h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 10, required: true, value: ui.code, oninput: (e) => { ui.code = e.target.value; } })),
      h('div.actions', {},
        h('button.primary', { type: 'submit', disabled: ui.busy }, ui.busy ? 'Checking…' : 'Sign in'),
        h('button.ghost', { type: 'button', onclick: () => { ui.step = 'email'; ui.code = ''; rerender(); } }, 'Use another email')));
  }
  return h('form.block.kitchen-card', { onsubmit: (e) => { e.preventDefault(); busy(rerender, async () => { await cloud.sendCode(ui.email); ui.step = 'code'; }); } },
    h('h2.section-title', {}, 'Sign in'),
    h('p.muted', {}, 'Only needed for the shared kitchen. Your taste profile, journal and menus stay on this device.'),
    h('label.field', {}, h('span', {}, 'Email'),
      h('input', { type: 'email', autocomplete: 'email', required: true, value: ui.email, oninput: (e) => { ui.email = e.target.value; } })),
    h('div.actions', {}, h('button.primary', { type: 'submit', disabled: ui.busy }, ui.busy ? 'Sending…' : 'Email me a code')));
}

function startOrJoin(ctx, rerender) {
  return h('div', {},
    h('form.block.kitchen-card', { onsubmit: (e) => { e.preventDefault(); busy(rerender, async () => { await cloud.createHousehold('Our kitchen', ui.name); ui.households = null; await load(ctx); }); } },
      h('h2.section-title', {}, 'I’m the cook'),
      h('p.muted', {}, 'Start a kitchen, then invite the person you cook for.'),
      nameField(),
      h('div.actions', {}, h('button.primary', { type: 'submit', disabled: ui.busy }, 'Start our kitchen'))),
    h('form.block.kitchen-card', { onsubmit: (e) => { e.preventDefault(); busy(rerender, async () => { await cloud.joinHousehold(ui.joinCode, ui.name); ui.households = null; await load(ctx); toast('You’re in. Boxes will show up here.'); }); } },
      h('h2.section-title', {}, 'I got an invite code'),
      nameField(),
      h('label.field', {}, h('span', {}, 'Invite code'),
        h('input', { type: 'text', autocapitalize: 'characters', maxlength: 12, required: true, value: ui.joinCode, oninput: (e) => { ui.joinCode = e.target.value; } })),
      h('div.actions', {}, h('button.primary', { type: 'submit', disabled: ui.busy }, 'Join'))),
    accountLine(rerender));
}

const nameField = () => h('label.field', {}, h('span', {}, 'Your name (shown to the other person)'),
  h('input', { type: 'text', maxlength: 60, autocomplete: 'given-name', value: ui.name, oninput: (e) => { ui.name = e.target.value; } }));

function household(ctx, home, rerender) {
  const me = ui.user.id;
  const share = cloud.restrictionsToShare(ctx.store.profile);
  return h('div', {},
    ideasBlock(ctx, home, rerender),
    savedBlock(home, rerender),
    h('section.block.kitchen-card', {},
      h('h2.section-title', {}, home.name),
      h('ul.member-list', {}, ui.members.map((m) => h('li', {},
        h('strong', {}, m.display_name || (m.user_id === me ? 'You' : 'Someone')),
        ' · ', m.role === 'cook' ? 'cooks' : 'eats the boxes', m.user_id === me ? ' (you)' : ''))),
      ui.invite
        ? h('div.invite', {},
          h('p', {}, 'Invite code (single use, valid 7 days):'),
          h('p.invite-code', {}, ui.invite.code),
          h('p.small.muted', {}, 'They open WasGibts → Kitchen, sign in with their own email, choose “I got an invite code” and type this.'),
          navigator.share && h('button.small', { type: 'button', onclick: () => navigator.share({ text: `Join my WasGibts kitchen: open ${location.origin}/#/kitchen, sign in, and enter the code ${ui.invite.code}` }).catch(() => {}) }, 'Send it'))
        : h('button', { type: 'button', disabled: ui.busy, onclick: () => busy(rerender, async () => { ui.invite = await cloud.createInvite(home.id); }) }, 'Invite someone')),

    h('section.block.kitchen-card', {},
      h('h2.section-title', {}, 'Share my restrictions with the cook'),
      h('p.muted', {}, 'So recipe ideas avoid what you can’t or won’t eat. Only these are shared, never the rest of your taste profile.'),
      share.restrictions.length || share.dislikes.length
        ? h('ul.small', {}, [
          ...share.restrictions.map((r) => h('li', {}, `${r.subject} (${r.type}${r.severity === 'strict' ? ', strict' : ''})`)),
          share.dislikes.length > 0 && h('li', {}, `Would rather avoid: ${share.dislikes.join(', ')}`),
        ])
        : h('p.small', {}, 'Nothing to share yet: add allergies or dislikes in your Taste profile.'),
      h('div.actions', {},
        h('button', { type: 'button', disabled: ui.busy, onclick: () => busy(rerender, async () => { await cloud.shareRestrictions(home.id, ctx.store.profile); ui.shared = { updated_at: new Date().toISOString() }; toast('Shared with your kitchen.'); }) }, ui.shared ? 'Update what I share' : 'Share these'),
        ui.shared && h('button.ghost', { type: 'button', disabled: ui.busy, onclick: () => busy(rerender, async () => { await cloud.stopSharingRestrictions(home.id); ui.shared = null; }) }, 'Stop sharing')),
      ui.shared && h('p.small.muted', {}, 'Shared. Update after you change your restrictions.')),

    h('p.small.muted.kitchen-next', {}, 'This week’s numbered boxes are coming next.'),
    accountLine(rerender, home));
}

function accountLine(rerender, home = null) {
  return h('p.small.muted.account-line', {},
    `Signed in as ${ui.user.email}. `,
    h('button.ghost.small', { type: 'button', onclick: () => busy(rerender, async () => { await cloud.signOut(); Object.assign(ui, { user: null, households: null, invite: null, shared: null, step: 'email', code: '' }); }) }, 'Sign out'),
    home && h('button.ghost.small.danger', { type: 'button', onclick: () => { if (confirm(`Leave “${home.name}”? You’ll stop seeing its recipes and boxes.`)) busy(rerender, async () => { await cloud.leaveHousehold(home.id); ui.households = null; await load(); }); } }, 'Leave kitchen'));
}

// --- Recipe ideas ----------------------------------------------------------------------

function ideasBlock(ctx, home, rerender) {
  const restrictions = (ui.everyone ?? []).flatMap((x) => x.restrictions ?? []);
  const dislikes = [...new Set((ui.everyone ?? []).flatMap((x) => x.dislikes ?? []))];
  const ask = () => busy(rerender, async () => {
    if (!ctx.ai.available) throw new Error(ctx.ai.locked ? 'Enter the passcode on the Read a menu tab first; recipe ideas use the same AI.' : 'Recipe ideas need the AI, which isn’t set up on this server.');
    const out = await api.recipeIdeas({ cuisine: ui.cuisine, request: ui.wish, count: 4, restrictions, dislikes, language: ctx.store.profile.settings.translateTo });
    ui.ideas = out.ideas; ui.removed = out.removed;
  });
  return h('section.block.kitchen-card', {},
    h('h2.section-title', {}, 'Recipe ideas'),
    h('p.muted', {}, 'Easy, healthy dishes that keep in the fridge and reheat well.'),
    h('div.chips', { role: 'group', 'aria-label': 'Cuisine' }, CUISINES.map((c) => h('button', {
      type: 'button', class: `chip${ui.cuisine === c ? ' on' : ''}`, 'aria-pressed': String(ui.cuisine === c), onclick: () => { ui.cuisine = c; rerender(); },
    }, c))),
    h('label.field', {}, h('span', {}, 'Anything in particular? (optional)'),
      h('input', { type: 'text', maxlength: 300, placeholder: 'e.g. more fish, no deep frying, vegetarian lunch', value: ui.wish, oninput: (e) => { ui.wish = e.target.value; } })),
    (restrictions.length > 0 || dislikes.length > 0) && h('p.small.muted', {}, `Avoiding: ${[...restrictions.map((r) => r.subject), ...dislikes].join(', ')} (shared by your kitchen).`),
    h('div.actions', {}, h('button.primary', { type: 'button', disabled: ui.busy, onclick: ask }, ui.busy ? 'Thinking…' : `Get ${ui.cuisine} ideas`)),
    ui.removed.length > 0 && h('p.small.callout', {}, `Left out because of a restriction: ${ui.removed.map((r) => `${r.title} (${r.reason})`).join('; ')}.`),
    ui.ideas && h('ul.recipe-list', {}, ui.ideas.map((r) => recipeCard(r, {
      action: ui.savedIds.has(r.title) ? h('button.small', { type: 'button', disabled: true }, 'Saved ✓')
        : h('button.small', { type: 'button', disabled: ui.busy, onclick: () => busy(rerender, async () => { await cloud.saveRecipe(home.id, r); ui.savedIds.add(r.title); ui.saved = await cloud.listRecipes(home.id); }) }, 'Save'),
    }))));
}

function savedBlock(home, rerender) {
  const list = ui.saved ?? [];
  if (!list.length) return null;
  const cuisines = ['All', ...new Set(list.map((r) => r.cuisine))];
  const shown = ui.filter === 'All' ? list : list.filter((r) => r.cuisine === ui.filter);
  return h('section.block.kitchen-card', {},
    h('h2.section-title', {}, `Saved recipes (${list.length})`),
    cuisines.length > 2 && h('div.chips.scroll-row', {}, cuisines.map((c) => h('button', { type: 'button', class: `chip${ui.filter === c ? ' on' : ''}`, onclick: () => { ui.filter = c; rerender(); } }, c))),
    h('ul.recipe-list', {}, shown.map((r) => recipeCard(r, {
      action: h('button.small.ghost.danger', { type: 'button', disabled: ui.busy, onclick: () => { if (confirm(`Delete “${r.title}”?`)) busy(rerender, async () => { await cloud.deleteRecipe(r.id); ui.saved = await cloud.listRecipes(home.id); }); } }, 'Delete'),
    }))));
}

/** One recipe: the essentials up front, ingredients and steps folded. */
export function recipeCard(r, { action = null } = {}) {
  return h('li.recipe', {},
    h('p.eyebrow', {}, [r.cuisine, r.activeMinutes ? `${r.activeMinutes} min` : null, r.servings ? `${r.servings} portions` : null].filter(Boolean).join(' · ')),
    h('h3.dish-name.s', {}, r.title),
    r.titleOriginal && r.titleOriginal !== r.title && h('p.dish-trans', {}, r.titleOriginal),
    r.summary && h('p', {}, r.summary),
    h('p.small.keeps', {}, `Keeps ${r.keepsDays} day${r.keepsDays === 1 ? '' : 's'} in the fridge. ${r.reheat ?? ''}`),
    r.allergens?.length > 0 && h('p.small.muted', {}, `Contains: ${r.allergens.join(', ')}`),
    r.flags?.length > 0 && h('p.small.concern-line', {}, r.flags.join(' · ')),
    h('details.what', {},
      h('summary', {}, 'Ingredients & steps'),
      h('ul.small', {}, (r.ingredients ?? []).map((i) => h('li', {}, [i.amount, i.item].filter(Boolean).join(' ')))),
      h('ol.small', {}, (r.steps ?? []).map((st) => h('li', {}, st))),
      r.whyItBoxesWell && h('p.small.muted', {}, r.whyItBoxesWell),
      r.storage && h('p.small.muted', {}, r.storage)),
    action && h('div.actions', {}, action));
}
