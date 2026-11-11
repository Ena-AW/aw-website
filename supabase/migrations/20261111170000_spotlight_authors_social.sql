-- Round 2: home page spotlight order, author photos, social media planner.

-- ---------------------------------------------------------------- spotlight
-- The home page shows the jobs with spotlight = true, in spotlight_order.
-- Chosen in the admin's "Home page" tab: 1 to 5 published jobs (3 recommended).
alter table website.jobs add column spotlight_order smallint;

create or replace function website.set_spotlight(p_ids uuid[])
returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if not website.is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 5 then
    raise exception 'The home page shows at most 5 spotlight jobs.' using errcode = '22023';
  end if;
  update website.jobs set spotlight = false, spotlight_order = null where spotlight or spotlight_order is not null;
  update website.jobs j set spotlight = true, spotlight_order = x.ord
  from unnest(p_ids) with ordinality as x(id, ord)
  where j.id = x.id;
end;
$$;
revoke execute on function website.set_spotlight(uuid[]) from anon, public;
grant execute on function website.set_spotlight(uuid[]) to authenticated;

-- ---------------------------------------------------------------- author photo
alter table website.posts add column show_author_photo boolean not null default true;

-- ---------------------------------------------------------------- social media
-- Accounts the team connects (Instagram, Facebook Page, LinkedIn page).
-- Access tokens never go in this table: they live in social_tokens, which
-- only the publishing Edge Function (service role) can read.
create table website.social_accounts (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null check (platform in ('instagram', 'facebook', 'linkedin')),
  name         text not null default '',
  handle       text not null default '',
  external_id  text,
  avatar_url   text not null default '',
  status       text not null default 'not_connected' check (status in ('not_connected', 'connected', 'expired', 'error')),
  connected_at timestamptz,
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (platform, external_id)
);
alter table website.social_accounts enable row level security;
create policy "staff read accounts" on website.social_accounts for select to authenticated using ((select website.is_staff()));
create policy "admins manage accounts" on website.social_accounts for all to authenticated using ((select website.is_admin())) with check ((select website.is_admin()));

create table website.social_tokens (
  account_id    uuid primary key references website.social_accounts (id) on delete cascade,
  access_token  text not null,
  refresh_token text,
  updated_at    timestamptz not null default now()
);
alter table website.social_tokens enable row level security;   -- no policies: service role only
revoke all on website.social_tokens from anon, authenticated;

create table website.social_posts (
  id           uuid primary key default gen_random_uuid(),
  title        text not null default '',                 -- internal name, never published
  format       text not null default 'post' check (format in ('post', 'carousel', 'reel', 'story')),
  platforms    text[] not null default '{}',             -- instagram, facebook, linkedin
  caption      text not null default '',
  overrides    jsonb not null default '{}'::jsonb,       -- per network: { "linkedin": { "caption": "…" }, "instagram": { "first_comment": "…" } }
  media        jsonb not null default '[]'::jsonb,       -- [{ "url": "…", "kind": "image" | "video", "alt": "…" }]
  link_url     text not null default '',
  scheduled_at timestamptz,
  status       text not null default 'draft' check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed')),
  results      jsonb not null default '{}'::jsonb,       -- per network: { "instagram": { "id": "…", "url": "…", "error": "…" } }
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null
);
create index social_posts_when_idx on website.social_posts (status, scheduled_at);
create trigger social_posts_touch before update on website.social_posts for each row execute function website.touch_updated();
alter table website.social_posts enable row level security;
create policy "staff read social"   on website.social_posts for select to authenticated using ((select website.is_staff()));
create policy "staff add social"    on website.social_posts for insert to authenticated with check ((select website.is_staff()));
create policy "staff edit social"   on website.social_posts for update to authenticated using ((select website.is_staff())) with check ((select website.is_staff()));
create policy "staff remove social" on website.social_posts for delete to authenticated using ((select website.is_staff()));

grant select, insert, update, delete on website.social_accounts, website.social_posts to authenticated, service_role;
grant select, insert, update, delete on website.social_tokens to service_role;
