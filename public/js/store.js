// Persistence and app state.
//
// The profile is read and written only through a Repository. Today that is
// LocalRepository (localStorage, this device only). With accounts, add a
// RemoteRepository with the same three methods that calls /api/profile; the
// rest of the app does not change.

import { normalizeProfile, emptyProfile } from '/shared/model.js';
import * as ops from '/shared/profile.js';

const KEY = 'wasgibts.profile.v1';
const SESSION_KEY = 'wasgibts.session.v1';

export class LocalRepository {
  async load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? normalizeProfile(JSON.parse(raw)) : null;
    } catch { return null; }
  }
  async save(profile) {
    try { localStorage.setItem(KEY, JSON.stringify(profile)); return true; } catch { return false; }
  }
  async clear() {
    try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  }
}

export async function loadSeed() {
  const res = await fetch('/shared/seed-profile.json');
  if (!res.ok) return emptyProfile();
  return normalizeProfile(await res.json());
}

export function createStore(repo = new LocalRepository()) {
  let profile = null;
  let persisted = true;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(profile));

  async function commit() {
    persisted = await repo.save(profile);
    emit();
  }

  return {
    async init() {
      profile = (await repo.load()) ?? (await loadSeed());
      await commit();
      return profile;
    },
    get profile() { return profile; },
    get persisted() { return persisted; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Run a shared/profile.js operation against the live profile and save. */
    async do(op, ...args) {
      const result = ops[op](profile, ...args);
      await commit();
      return result;
    },
    async setSettings(patch) {
      profile.settings = { ...profile.settings, ...patch };
      profile.updatedAt = new Date().toISOString();
      await commit();
    },
    async setAbout(patch) {
      profile.about = { ...profile.about, ...patch };
      await commit();
    },
    async replace(raw) {
      profile = normalizeProfile(raw);
      await commit();
    },
    async resetToSeed() { profile = await loadSeed(); await commit(); },
    async wipe() { await repo.clear(); profile = emptyProfile(); await commit(); },
  };
}

/** The current menu and recommendations survive a reload, not a closed tab. */
export const session = {
  get() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) ?? {}; } catch { return {}; } },
  set(patch) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...session.get(), ...patch })); } catch { /* ignore */ } },
  clear() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } },
};
