-- WasGibts shared data: households (cook + eater), saved recipes, weekly boxes, ratings.
-- Every row belongs to a household; only its members can see or change it (RLS).

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Our kitchen' check (char_length(name) between 1 and 80),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'eater' check (role in ('cook', 'eater')),
  display_name text check (char_length(display_name) <= 60),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index members_user_idx on public.members(user_id);

create table public.invites (
  code text primary key default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users(id),
  used_at timestamptz
);

-- Restrictions and dislikes an eater chooses to share with the household's cook.
create table public.shared_restrictions (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  restrictions jsonb not null default '[]'::jsonb,  -- [{type, subject, severity}]
  dislikes jsonb not null default '[]'::jsonb,      -- ["coriander", ...]
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  cuisine text not null check (char_length(cuisine) <= 40),
  title text not null check (char_length(title) <= 120),
  title_original text check (char_length(title_original) <= 120),
  summary text check (char_length(summary) <= 600),
  data jsonb not null default '{}'::jsonb,  -- ingredients, steps, keepsDays, reheat, allergens, tags
  source text not null default 'ai' check (source in ('ai', 'own')),
  created_by uuid not null default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index recipes_household_idx on public.recipes(household_id, created_at desc);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  week_of date not null,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (household_id, week_of)
);

create table public.boxes (
  plan_id uuid not null references public.plans(id) on delete cascade,
  box_no smallint not null check (box_no between 1 and 6),
  recipe_id uuid references public.recipes(id) on delete set null,
  made_on date,
  note text check (char_length(note) <= 300),
  updated_at timestamptz not null default now(),
  primary key (plan_id, box_no)
);

create table public.ratings (
  plan_id uuid not null references public.plans(id) on delete cascade,
  box_no smallint not null check (box_no between 1 and 6),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  verdict text not null check (verdict in ('loved', 'fine', 'not_again')),
  note text check (char_length(note) <= 300),
  at timestamptz not null default now(),
  primary key (plan_id, box_no, user_id)
);

-- Membership check used by every policy. SECURITY DEFINER so it can read
-- members without recursing through members' own RLS.
create or replace function public.is_member(h uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.household_id = h and m.user_id = auth.uid());
$$;
revoke all on function public.is_member(uuid) from public;
grant execute on function public.is_member(uuid) to authenticated;

create or replace function public.plan_household(p uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.plans where id = p;
$$;
revoke all on function public.plan_household(uuid) from public;
grant execute on function public.plan_household(uuid) to authenticated;

-- Creating a household makes its creator the cook.
create or replace function public.add_creator_as_cook() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.members (household_id, user_id, role) values (new.id, new.created_by, 'cook');
  return new;
end $$;
create trigger households_add_creator after insert on public.households
  for each row execute function public.add_creator_as_cook();

-- Join with an invite code (single use, not expired).
create or replace function public.join_household(invite_code text, as_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.invites set used_by = auth.uid(), used_at = now()
    where code = upper(trim(invite_code)) and used_by is null and expires_at > now()
    returning household_id into h;
  if h is null then raise exception 'That invite code is not valid any more'; end if;
  insert into public.members (household_id, user_id, role, display_name)
    values (h, auth.uid(), 'eater', left(as_name, 60))
    on conflict (household_id, user_id) do nothing;
  return h;
end $$;
revoke all on function public.join_household(text, text) from public;
grant execute on function public.join_household(text, text) to authenticated;

alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.shared_restrictions enable row level security;
alter table public.recipes enable row level security;
alter table public.plans enable row level security;
alter table public.boxes enable row level security;
alter table public.ratings enable row level security;

create policy "members read their households" on public.households for select to authenticated using (public.is_member(id) or created_by = auth.uid());
create policy "signed-in users create households" on public.households for insert to authenticated with check (created_by = auth.uid());
create policy "members rename households" on public.households for update to authenticated using (public.is_member(id)) with check (public.is_member(id));
create policy "creator deletes household" on public.households for delete to authenticated using (created_by = auth.uid());

create policy "members see fellow members" on public.members for select to authenticated using (public.is_member(household_id));
create policy "members update own row" on public.members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "members leave" on public.members for delete to authenticated using (user_id = auth.uid());

create policy "members see invites" on public.invites for select to authenticated using (public.is_member(household_id));
create policy "members create invites" on public.invites for insert to authenticated with check (public.is_member(household_id) and created_by = auth.uid());
create policy "members delete invites" on public.invites for delete to authenticated using (public.is_member(household_id));

create policy "members read shared restrictions" on public.shared_restrictions for select to authenticated using (public.is_member(household_id));
create policy "own shared restrictions insert" on public.shared_restrictions for insert to authenticated with check (user_id = auth.uid() and public.is_member(household_id));
create policy "own shared restrictions update" on public.shared_restrictions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(household_id));
create policy "own shared restrictions delete" on public.shared_restrictions for delete to authenticated using (user_id = auth.uid());

create policy "members read recipes" on public.recipes for select to authenticated using (public.is_member(household_id));
create policy "members add recipes" on public.recipes for insert to authenticated with check (public.is_member(household_id) and created_by = auth.uid());
create policy "members edit recipes" on public.recipes for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "members delete recipes" on public.recipes for delete to authenticated using (public.is_member(household_id));

create policy "members read plans" on public.plans for select to authenticated using (public.is_member(household_id));
create policy "members add plans" on public.plans for insert to authenticated with check (public.is_member(household_id));
create policy "members edit plans" on public.plans for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "members delete plans" on public.plans for delete to authenticated using (public.is_member(household_id));

create policy "members read boxes" on public.boxes for select to authenticated using (public.is_member(public.plan_household(plan_id)));
create policy "members add boxes" on public.boxes for insert to authenticated with check (public.is_member(public.plan_household(plan_id)));
create policy "members edit boxes" on public.boxes for update to authenticated using (public.is_member(public.plan_household(plan_id))) with check (public.is_member(public.plan_household(plan_id)));
create policy "members delete boxes" on public.boxes for delete to authenticated using (public.is_member(public.plan_household(plan_id)));

create policy "members read ratings" on public.ratings for select to authenticated using (public.is_member(public.plan_household(plan_id)));
create policy "own ratings insert" on public.ratings for insert to authenticated with check (user_id = auth.uid() and public.is_member(public.plan_household(plan_id)));
create policy "own ratings update" on public.ratings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own ratings delete" on public.ratings for delete to authenticated using (user_id = auth.uid());

-- Live sync: boxes and ratings changes are pushed to subscribed members (RLS applies).
alter publication supabase_realtime add table public.boxes, public.ratings, public.recipes, public.plans;
