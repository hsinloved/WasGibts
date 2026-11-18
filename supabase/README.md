# Supabase (shared Kitchen & Boxes)

Project: `wasgibts` (ref `focbzehvucxetphfxzbm`, eu-central-1). Only the Kitchen tab uses it; the rest of WasGibts is local-first.

`migrations/` holds the SQL applied to the project, in order. Every table has Row Level Security: a row is readable and writable only by members of its household (`private.is_member`). Joining a household goes through `public.join_household(code)`, which accepts a single-use invite that hasn't expired.

The browser uses the project's **publishable** key (public by design); it can do nothing the policies don't allow. No service-role key is used anywhere.

## Auth settings (set in the dashboard)
- Authentication → URL Configuration: Site URL `https://wasgibts-two.vercel.app`, redirect URLs `https://wasgibts-two.vercel.app/**` and `http://localhost:8890/**`.
- Authentication → Emails → Magic Link (and Confirm signup): include the code, e.g. `<p>Your WasGibts code: <strong>{{ .Token }}</strong></p>` above the link, so people using the installed app can type the code instead of opening the link in a browser.
