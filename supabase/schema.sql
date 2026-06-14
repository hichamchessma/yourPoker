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
