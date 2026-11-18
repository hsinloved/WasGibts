-- Policy helpers live in a schema the REST API does not expose.
create schema if not exists private;
grant usage on schema private to authenticated;

alter function public.is_member(uuid) set schema private;
alter function public.plan_household(uuid) set schema private;
revoke all on function private.is_member(uuid) from public, anon;
revoke all on function private.plan_household(uuid) from public, anon;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.plan_household(uuid) to authenticated;

-- The trigger function is never called directly.
alter function public.add_creator_as_cook() set schema private;
revoke all on function private.add_creator_as_cook() from public, anon, authenticated;

-- Joining is for signed-in users only.
revoke all on function public.join_household(text, text) from public, anon;
grant execute on function public.join_household(text, text) to authenticated;
