import { createStore } from './store.js';
import { api } from './api.js';
import { renderRead, receiveShare } from './views/read.js';
import { renderJournal } from './views/journal.js';
import { renderProfile } from './views/profile.js';
import { renderKitchen } from './views/kitchen.js';
import { toast } from './dom.js';

const views = { '': renderRead, journal: renderJournal, kitchen: renderKitchen, profile: renderProfile };

async function main() {
  const store = createStore();
  const [, ai] = await Promise.all([store.init(), api.status()]);
  await receiveShare(); // a link or screenshots shared into the installed app
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const ctx = { store, ai };
  const root = document.getElementById('view');
  await finishEmailSignIn();

  function route() {
    const name = location.hash.replace(/^#\/?/, '').split('/')[0];
    const view = views[name] ?? renderRead;
    document.querySelectorAll('nav a').forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === `#/${name}`)));
    view(root, ctx);
    const pending = store.profile.history.filter((x) => x.action === 'ordered' && !x.feedbackAt).length;
    document.getElementById('journal-count').textContent = pending ? String(pending) : '';
  }
  window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
  store.subscribe(() => {
    const pending = store.profile.history.filter((x) => x.action === 'ordered' && !x.feedbackAt).length;
    document.getElementById('journal-count').textContent = pending ? String(pending) : '';
  });
  route();
}

/**
 * A sign-in link from the email lands here with the session (or an error) in
 * the address: "#access_token=…" or "#error=…". Hand it to the Supabase client,
 * then continue on the Kitchen tab with a clean address. Without this the
 * hash router would treat the token as a page name and drop it.
 */
async function finishEmailSignIn() {
  const hash = location.hash;
  if (!/(^|[#&])(access_token|error_description)=/.test(hash)) return;
  const params = new URLSearchParams(hash.replace(/^#\/?[^#]*#/, '#').replace(/^#/, ''));
  try {
    if (params.get('error_description')) {
      toast(/expired|invalid/i.test(params.get('error_description')) ? 'That sign-in link has expired. Ask for a new code on the Kitchen tab.' : `Sign-in didn’t work: ${params.get('error_description')}`);
    } else {
      const { client } = await import('./cloud.js');
      const sb = await client();
      const { data } = await sb.auth.getSession(); // waits until the link's session is stored
      if (!data.session) {
        await sb.auth.setSession({ access_token: params.get('access_token'), refresh_token: params.get('refresh_token') });
      }
      toast('You’re signed in.');
    }
  } catch {
    toast('Sign-in didn’t work. Ask for a new code on the Kitchen tab.');
  }
  history.replaceState(null, '', `${location.pathname}#/kitchen`);
}

main().catch((err) => {
  document.getElementById('view').textContent = `Something went wrong starting the app: ${err.message}`;
});
