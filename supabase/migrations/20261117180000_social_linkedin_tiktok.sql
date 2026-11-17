-- LinkedIn company page and TikTok for the Social media planner.
--
-- Both connect with OAuth: an admin clicks "Connect" in Social media →
-- Accounts, signs in on LinkedIn or TikTok, and the social-oauth Edge Function
-- stores the account and its tokens. social-publish sends scheduled posts and
-- refreshes the tokens before they expire (LinkedIn about every 60 days,
-- TikTok every day).

alter table website.social_accounts drop constraint if exists social_accounts_platform_check;
alter table website.social_accounts add constraint social_accounts_platform_check
  check (platform in ('instagram', 'facebook', 'linkedin', 'tiktok'));

alter table website.social_tokens add column if not exists expires_at timestamptz;
alter table website.social_tokens add column if not exists refresh_expires_at timestamptz;

-- One-time values that tie a sign-in on LinkedIn or TikTok back to the admin
-- who started it. Only the Edge Functions (service role) use this table.
create table if not exists website.social_oauth_states (
  state      text primary key,
  platform   text not null check (platform in ('linkedin', 'tiktok')),
  user_id    uuid not null references auth.users (id) on delete cascade,
  return_to  text not null default '',
  created_at timestamptz not null default now()
);
alter table website.social_oauth_states enable row level security;   -- no policies: service role only
revoke all on website.social_oauth_states from anon, authenticated;
grant select, insert, delete on website.social_oauth_states to service_role;
