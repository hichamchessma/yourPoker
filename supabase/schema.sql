-- ─────────────────────────────────────────────────────────────────────────────
-- Subscriptions — source of truth for Pro access. Written ONLY by the server (the
-- Lemon Squeezy webhook, using the service-role key). Clients can READ their own row
-- via RLS, never write it — so Pro status can't be faked from the browser.
--
-- HOW TO RUN: Supabase dashboard → SQL Editor → paste this → Run. (Idempotent.)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.subscriptions (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  status              text not null default 'free',   -- 'active' | 'cancelled' | 'expired' | 'past_due' | 'free'
  plan                text,                            -- e.g. 'Pro mensuel' / 'Pro annuel'
  ls_subscription_id  text,
  current_period_end  timestamptz,
  updated_at          timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- Each user can read ONLY their own subscription row.
drop policy if exists "read own subscription" on public.subscriptions;
create policy "read own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

-- NB: no insert/update/delete policies on purpose → only the service role (the webhook)
-- can write. The anon/authenticated client can never modify a subscription.

-- ─────────────────────────────────────────────────────────────────────────────
-- CLOUD BACKUP of the player's progression. localStorage stays the source of
-- truth for instant, offline-first UX; these tables make the ACCOUNT portable —
-- a new phone (or a cleared browser) must not wipe someone's history, otherwise
-- a monthly subscription is impossible to defend.
--
-- Unlike `subscriptions` (server-only), these rows ARE written by the client:
-- they're the user's own data and carry no entitlement, so full RLS on
-- `auth.uid() = user_id` is the right boundary.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.sessions (
  -- the client-side id (Date.now()) is kept so the same session is recognised
  -- across devices; uniqueness only has to hold PER USER.
  id         bigint      not null,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  kind       text        not null check (kind in ('tournament', 'cash')),
  played_at  timestamptz not null default now(),
  title      text        not null default '',
  subtitle   text        not null default '',
  result_bb  numeric     not null default 0,
  currency   text,
  -- Only the most recent hands of a session are mirrored (see CLOUD_MAX_HANDS in
  -- historyStore.ts): full replays are the heavy part and the cheap part to lose.
  hands      jsonb       not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists sessions_user_kind_date_idx
  on public.sessions (user_id, kind, played_at desc);

create table if not exists public.perf_scores (
  user_id   uuid        not null references auth.users(id) on delete cascade,
  kind      text        not null check (kind in ('tournament', 'cash')),
  scored_at timestamptz not null,
  score     int         not null,
  grade     text        not null,
  decisions int         not null,
  primary key (user_id, kind, scored_at)   -- natural de-duplication across devices
);

alter table public.sessions    enable row level security;
alter table public.perf_scores enable row level security;

-- Own-rows-only, for every verb (the client is the author of this data).
do $$
declare t text;
begin
  foreach t in array array['sessions', 'perf_scores'] loop
    execute format('drop policy if exists "own rows select" on public.%I', t);
    execute format('create policy "own rows select" on public.%I for select using (auth.uid() = user_id)', t);
    execute format('drop policy if exists "own rows insert" on public.%I', t);
    execute format('create policy "own rows insert" on public.%I for insert with check (auth.uid() = user_id)', t);
    execute format('drop policy if exists "own rows update" on public.%I', t);
    execute format('create policy "own rows update" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('drop policy if exists "own rows delete" on public.%I', t);
    execute format('create policy "own rows delete" on public.%I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;
