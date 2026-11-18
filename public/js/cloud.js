// Shared data for the household (Kitchen & Boxes), stored in Supabase.
//
// Everything else in WasGibts stays on this device; this module is only used
// once someone signs in on the Kitchen tab. Access is enforced by Row Level
// Security in the database (see supabase/migrations): a row is visible only
// to members of its household. The publishable key below is meant to be
// public; it grants nothing beyond what those rules allow.
//
// The Supabase client is vendored (/vendor/supabase-*.js) and loaded on first
// use, so the rest of the app never downloads it.

export const SUPABASE_URL = 'https://focbzehvucxetphfxzbm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_k-rnmB5lxO67rb6W7heAVQ_EeLscIoh';
const VENDOR = '/vendor/supabase-2.118.0.js';

let clientPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.supabase?.createClient) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve(); s.onerror = () => reject(new Error('Could not load sign-in. Are you online?'));
    document.head.append(s);
  });
}

/** The Supabase client, created once. */
export function client() {
  clientPromise ??= loadScript(VENDOR).then(() => window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'wasgibts.auth' },
  }));
  return clientPromise;
}

/** Plain-language errors instead of database messages. */
function fail(error, fallback) {
  if (!error) return;
  const m = String(error.message || '');
  if (/rate limit|too many/i.test(m)) throw new Error('Too many sign-in emails just now. Wait a few minutes and try again.');
  if (/expired|invalid/i.test(m) && /token|otp|code/i.test(m)) throw new Error('That code didn’t work or has expired. Ask for a new one.');
  if (/invite code is not valid/i.test(m)) throw new Error('That invite code isn’t valid any more. Ask for a new one.');
  if (/failed to fetch|network/i.test(m)) throw new Error('Could not reach the server. Are you online?');
  throw new Error(fallback || m || 'Something went wrong.');
}

// --- Account ---------------------------------------------------------------------

export async function currentUser() {
  const sb = await client();
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

export async function onAuthChange(fn) {
  const sb = await client();
  sb.auth.onAuthStateChange((_event, session) => fn(session?.user ?? null));
}

/** Email a sign-in code (and link). New addresses get an account. */
export async function sendCode(email) {
  const sb = await client();
  const { error } = await sb.auth.signInWithOtp({ email: String(email).trim(), options: { shouldCreateUser: true, emailRedirectTo: `${location.origin}/` } });
  fail(error);
}

export async function verifyCode(email, code) {
  const sb = await client();
  const { data, error } = await sb.auth.verifyOtp({ email: String(email).trim(), token: String(code).replace(/\s+/g, ''), type: 'email' });
  fail(error);
  return data.user;
}

export async function signOut() {
  const sb = await client();
  await sb.auth.signOut();
}

// --- Household ----------------------------------------------------------------------

/** The households this user belongs to, with members. Usually one. */
export async function myHouseholds() {
  const sb = await client();
  const user = await currentUser();
  if (!user) return [];
  const { data, error } = await sb.from('members').select('household_id, role, display_name, households(id, name, created_by)').eq('user_id', user.id);
  fail(error);
  return (data ?? []).map((m) => ({ id: m.household_id, name: m.households?.name ?? 'Our kitchen', role: m.role, displayName: m.display_name, isCreator: m.households?.created_by === user.id }));
}

export async function members(householdId) {
  const sb = await client();
  const { data, error } = await sb.from('members').select('user_id, role, display_name, joined_at').eq('household_id', householdId).order('joined_at');
  fail(error);
  return data ?? [];
}

export async function createHousehold(name, displayName) {
  const sb = await client();
  const { data, error } = await sb.from('households').insert({ name: String(name || 'Our kitchen').slice(0, 80) }).select('id').single();
  fail(error);
  if (displayName) await setDisplayName(data.id, displayName);
  return data.id;
}

export async function setDisplayName(householdId, displayName) {
  const sb = await client();
  const user = await currentUser();
  const { error } = await sb.from('members').update({ display_name: String(displayName).slice(0, 60) }).eq('household_id', householdId).eq('user_id', user.id);
  fail(error);
}

/** A fresh single-use invite code, valid 7 days. */
export async function createInvite(householdId) {
  const sb = await client();
  const { data, error } = await sb.from('invites').insert({ household_id: householdId }).select('code, expires_at').single();
  fail(error);
  return data;
}

export async function joinHousehold(code, displayName) {
  const sb = await client();
  const { data, error } = await sb.rpc('join_household', { invite_code: String(code).trim(), as_name: displayName || null });
  fail(error);
  return data;
}

export async function leaveHousehold(householdId) {
  const sb = await client();
  const user = await currentUser();
  const { error } = await sb.from('members').delete().eq('household_id', householdId).eq('user_id', user.id);
  fail(error);
}

// --- Restrictions shared with the cook -----------------------------------------------------

/** Only restrictions and dislikes, and only when the eater chooses to share them. */
export function restrictionsToShare(profile) {
  return {
    restrictions: profile.restrictions.map((r) => ({ type: r.type, subject: r.subject, severity: r.severity })),
    dislikes: profile.preferences.filter((p) => p.polarity === 'dislike' && p.status === 'active').map((p) => p.subject).slice(0, 40),
  };
}

export async function shareRestrictions(householdId, profile) {
  const sb = await client();
  const user = await currentUser();
  const { error } = await sb.from('shared_restrictions').upsert({ household_id: householdId, user_id: user.id, ...restrictionsToShare(profile), updated_at: new Date().toISOString() });
  fail(error);
}

export async function stopSharingRestrictions(householdId) {
  const sb = await client();
  const user = await currentUser();
  const { error } = await sb.from('shared_restrictions').delete().eq('household_id', householdId).eq('user_id', user.id);
  fail(error);
}

export async function sharedRestrictions(householdId) {
  const sb = await client();
  const { data, error } = await sb.from('shared_restrictions').select('user_id, restrictions, dislikes, updated_at').eq('household_id', householdId);
  fail(error);
  return data ?? [];
}

// --- Recipes ---------------------------------------------------------------------------

const RECIPE_FIELDS = ['servings', 'activeMinutes', 'ingredients', 'steps', 'keepsDays', 'storage', 'reheat', 'allergens', 'tags', 'whyItBoxesWell', 'flags', 'shortKeep'];

export async function saveRecipe(householdId, idea) {
  const sb = await client();
  const data = Object.fromEntries(RECIPE_FIELDS.filter((k) => idea[k] !== undefined).map((k) => [k, idea[k]]));
  const { data: row, error } = await sb.from('recipes').insert({
    household_id: householdId, cuisine: String(idea.cuisine).slice(0, 40), title: String(idea.title).slice(0, 120),
    title_original: idea.titleOriginal ? String(idea.titleOriginal).slice(0, 120) : null, summary: String(idea.summary ?? '').slice(0, 600), data, source: 'ai',
  }).select('id').single();
  fail(error);
  return row.id;
}

export async function listRecipes(householdId) {
  const sb = await client();
  const { data, error } = await sb.from('recipes').select('id, cuisine, title, title_original, summary, data, created_at').eq('household_id', householdId).order('created_at', { ascending: false }).limit(200);
  fail(error);
  return (data ?? []).map((r) => ({ id: r.id, cuisine: r.cuisine, title: r.title, titleOriginal: r.title_original, summary: r.summary, createdAt: r.created_at, ...r.data }));
}

export async function deleteRecipe(id) {
  const sb = await client();
  const { error } = await sb.from('recipes').delete().eq('id', id);
  fail(error);
}

// --- Weekly boxes -------------------------------------------------------------------------

/** The prep day a plan belongs to: the Saturday on or before `date` (YYYY-MM-DD, local time). */
export function prepDay(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); // Sat=6 → 0 days back, Sun → 1, Fri → 6
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The latest plan, or null. */
export async function latestPlan(householdId) {
  const sb = await client();
  const { data, error } = await sb.from('plans').select('id, week_of, note').eq('household_id', householdId).order('week_of', { ascending: false }).limit(1);
  fail(error);
  return data?.[0] ?? null;
}

/** This weekend's plan, created if needed. */
export async function planFor(householdId, weekOf = prepDay()) {
  const sb = await client();
  const found = await sb.from('plans').select('id, week_of, note').eq('household_id', householdId).eq('week_of', weekOf).maybeSingle();
  fail(found.error);
  if (found.data) return found.data;
  const { data, error } = await sb.from('plans').insert({ household_id: householdId, week_of: weekOf }).select('id, week_of, note').single();
  fail(error);
  return data;
}

export async function boxes(planId) {
  const sb = await client();
  const [b, r] = await Promise.all([
    sb.from('boxes').select('box_no, recipe_id, made_on, note, updated_at, recipes(id, cuisine, title, title_original, summary, data)').eq('plan_id', planId).order('box_no'),
    sb.from('ratings').select('box_no, user_id, verdict, note, at').eq('plan_id', planId),
  ]);
  fail(b.error); fail(r.error);
  return (b.data ?? []).map((x) => ({
    boxNo: x.box_no, madeOn: x.made_on, note: x.note,
    recipe: x.recipes ? { id: x.recipes.id, cuisine: x.recipes.cuisine, title: x.recipes.title, titleOriginal: x.recipes.title_original, summary: x.recipes.summary, ...x.recipes.data } : null,
    ratings: (r.data ?? []).filter((y) => y.box_no === x.box_no),
  }));
}

export async function setBox(planId, boxNo, recipeId, madeOn) {
  const sb = await client();
  if (!recipeId) {
    const { error } = await sb.from('boxes').delete().eq('plan_id', planId).eq('box_no', boxNo);
    return fail(error);
  }
  const { error } = await sb.from('boxes').upsert({ plan_id: planId, box_no: boxNo, recipe_id: recipeId, made_on: madeOn, updated_at: new Date().toISOString() });
  fail(error);
}

export async function rate(planId, boxNo, verdict, note = '') {
  const sb = await client();
  const user = await currentUser();
  const { error } = await sb.from('ratings').upsert({ plan_id: planId, box_no: boxNo, user_id: user.id, verdict, note: String(note).slice(0, 300), at: new Date().toISOString() });
  fail(error);
}

/** Live updates: calls `fn` whenever a box or rating in this plan changes (on any phone). */
export async function watchPlan(planId, fn) {
  const sb = await client();
  const channel = sb.channel(`plan-${planId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'boxes', filter: `plan_id=eq.${planId}` }, fn)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ratings', filter: `plan_id=eq.${planId}` }, fn)
    .subscribe();
  return () => sb.removeChannel(channel);
}
