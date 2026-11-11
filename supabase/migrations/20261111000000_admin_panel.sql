-- AW website: jobs, Atlean Talks posts, website team and the media bucket.
-- Lives in the Atleable (ATS) Supabase project, in its own "website" schema,
-- so it never mixes with Atleable's tables. Logins are the same Atlean
-- accounts as Atleable; website.profiles says who may use the website admin.
-- Public visitors (the anon key) can only read published rows.
-- "website" must be listed in Settings > Data API > Exposed schemas.

create schema if not exists website;
grant usage on schema website to anon, authenticated, service_role;

-- ---------------------------------------------------------------- team
create table website.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null default 'editor' check (role in ('admin', 'editor')),
  created_at timestamptz not null default now()
);

create or replace function website.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from website.profiles where id = (select auth.uid()));
$$;

create or replace function website.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from website.profiles where id = (select auth.uid()) and role = 'admin');
$$;

revoke execute on function website.is_staff(), website.is_admin() from anon, public;

grant execute on function website.is_staff(), website.is_admin() to authenticated;

alter table website.profiles enable row level security;
create policy "staff read team" on website.profiles for select to authenticated using ((select website.is_staff()));
create policy "admins change team" on website.profiles for update to authenticated using ((select website.is_admin())) with check ((select website.is_admin()));
create policy "admins remove team" on website.profiles for delete to authenticated using ((select website.is_admin()) and id <> (select auth.uid()));

-- Website access is given to people who already have an Atlean login (the
-- same login as Atleable). Admins call this with an email address; nobody's
-- account is created or deleted from the website.
create or replace function website.grant_access(p_email text, p_role text default 'editor', p_name text default null)
returns website.profiles
language plpgsql security definer set search_path = '' as $$
declare
  u auth.users;
  result website.profiles;
begin
  if not website.is_admin() then
    raise exception 'Only admins can give access.' using errcode = '42501';
  end if;
  select * into u from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if u.id is null then
    raise exception 'No Atlean login uses %. They need an Atleable account first.', p_email using errcode = 'P0002';
  end if;
  insert into website.profiles (id, email, full_name, role)
  values (u.id, lower(u.email),
          coalesce(nullif(trim(p_name), ''), u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
          case when p_role = 'admin' then 'admin' else 'editor' end)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name
  returning * into result;
  return result;
end;
$$;
revoke execute on function website.grant_access(text, text, text) from anon, public;
grant execute on function website.grant_access(text, text, text) to authenticated;

-- ---------------------------------------------------------------- shared
create or replace function website.touch_updated() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

-- ---------------------------------------------------------------- jobs
create table website.jobs (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title           text not null,
  location        text not null default '',
  location_slug   text not null default '',
  country         text not null default '',
  position        text not null default '',
  language        text not null default '',
  employment_type text not null default 'Full-time',
  work_model      text not null default 'On-site',
  salary          text not null default '',
  description     text not null default '',      -- HTML from the editor
  apply_url       text not null default '',
  spotlight       boolean not null default false, -- shown on the home page
  status          text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  atleable_id     text unique,                    -- the job's id in Atleable, for the two-way sync
  source          text not null default 'website' check (source in ('website', 'atleable')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null
);
create index jobs_status_idx on website.jobs (status);
create trigger jobs_touch before update on website.jobs for each row execute function website.touch_updated();

alter table website.jobs enable row level security;
create policy "public reads published jobs" on website.jobs for select to anon using (status = 'published');
create policy "staff read all jobs" on website.jobs for select to authenticated using (status = 'published' or (select website.is_staff()));
create policy "staff add jobs"    on website.jobs for insert to authenticated with check ((select website.is_staff()));
create policy "staff edit jobs"   on website.jobs for update to authenticated using ((select website.is_staff())) with check ((select website.is_staff()));
create policy "staff remove jobs" on website.jobs for delete to authenticated using ((select website.is_staff()));

-- ---------------------------------------------------------------- Atlean Talks
create table website.posts (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title        text not null,
  excerpt      text not null default '',
  body         text not null default '',          -- HTML from the editor
  category     text not null default '',
  author       text not null default '',
  cover_url    text not null default '',
  status       text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null
);
create index posts_status_idx on website.posts (status, published_at desc);
create trigger posts_touch before update on website.posts for each row execute function website.touch_updated();

alter table website.posts enable row level security;
create policy "public reads published posts" on website.posts for select to anon using (status = 'published');
create policy "staff read all posts" on website.posts for select to authenticated using (status = 'published' or (select website.is_staff()));
create policy "staff add posts"    on website.posts for insert to authenticated with check ((select website.is_staff()));
create policy "staff edit posts"   on website.posts for update to authenticated using ((select website.is_staff())) with check ((select website.is_staff()));
create policy "staff remove posts" on website.posts for delete to authenticated using ((select website.is_staff()));

-- ---------------------------------------------------------------- media library
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 524288000)   -- 500 MB per file, for videos
on conflict (id) do nothing;

create policy "staff upload media" on storage.objects for insert to authenticated with check (bucket_id = 'media' and (select website.is_staff()));
create policy "staff update media" on storage.objects for update to authenticated using (bucket_id = 'media' and (select website.is_staff()));
create policy "staff delete media" on storage.objects for delete to authenticated using (bucket_id = 'media' and (select website.is_staff()));
create policy "staff list media"   on storage.objects for select to authenticated using (bucket_id = 'media' and (select website.is_staff()));

-- explicit grants (default privileges only cover tables made after them in the same session)
grant select, insert, update, delete on website.profiles, website.jobs, website.posts to authenticated, service_role;
grant select on website.jobs, website.posts to anon;
