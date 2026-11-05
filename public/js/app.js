import { createStore } from './store.js';
import { api } from './api.js';
import { renderRead } from './views/read.js';
import { renderJournal } from './views/journal.js';
import { renderProfile } from './views/profile.js';

const views = { '': renderRead, journal: renderJournal, profile: renderProfile };

async function main() {
  const store = createStore();
  const [, ai] = await Promise.all([store.init(), api.status()]);
  const ctx = { store, ai };
  const root = document.getElementById('view');

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

main().catch((err) => {
  document.getElementById('view').textContent = `Something went wrong starting the app: ${err.message}`;
});
