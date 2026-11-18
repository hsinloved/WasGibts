// Menu history.
//
// Menus already read, with their latest picks, kept on this device so they can
// be reopened instantly without fetching or reading them again. Newest first;
// the same source replaces its older entry. Menus can be large, so the list is
// capped and the oldest entries are dropped if the browser runs out of room.

const MENUS_KEY = 'wasgibts.menus.v1';
const MAX_MENUS = 15;

const sourceKey = (menu) => menu?.source?.url || `${menu?.restaurant?.name ?? ''}|${menu?.source?.label ?? ''}|${menu?.dishes?.length ?? 0}`;

export const menuHistory = {
  list() {
    try { const v = JSON.parse(localStorage.getItem(MENUS_KEY)); return Array.isArray(v) ? v : []; } catch { return []; }
  },
  /** Add or refresh an entry for this menu. Returns its id. */
  save({ menu, recs = null, occasion = null, refine = null, id = null }) {
    if (!menu?.dishes?.length || menu.source?.kind === 'sample') return null;
    const key = sourceKey(menu);
    const list = menuHistory.list();
    const old = list.find((e) => (id && e.id === id) || e.key === key);
    const entry = {
      id: old?.id ?? `menu_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      key, at: new Date().toISOString(), firstAt: old?.firstAt ?? new Date().toISOString(),
      name: menu.restaurant?.name || menu.source?.label || 'Menu', cuisine: menu.restaurant?.cuisine ?? null,
      dishes: menu.dishes.length, topPicks: (recs?.picks ?? []).slice(0, 3).map((p) => { const d = menu.dishes.find((x) => x.id === p.dishId); return d ? (d.translatedName || d.originalName) : null; }).filter(Boolean),
      menu, recs, occasion, refine,
    };
    let next = [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, MAX_MENUS);
    while (next.length) {
      try { localStorage.setItem(MENUS_KEY, JSON.stringify(next)); break; } catch { next = next.slice(0, -1); }
    }
    return entry.id;
  },
  get(id) { return menuHistory.list().find((e) => e.id === id) ?? null; },
  remove(id) { try { localStorage.setItem(MENUS_KEY, JSON.stringify(menuHistory.list().filter((e) => e.id !== id))); } catch { /* ignore */ } },
  clear() { try { localStorage.removeItem(MENUS_KEY); } catch { /* ignore */ } },
};
