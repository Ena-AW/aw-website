-- Social media publishing: Facebook Page and Instagram through Meta's Graph API.
--
-- The social-publish Edge Function (supabase/functions/social-publish) runs
-- every 5 minutes from pg_cron. Each run it sends every scheduled post in the
-- admin's Social media planner whose time has come (posts, carousels, reels,
-- stories), and writes the links or errors back to social_posts.results.
--
-- The Meta token is never stored here: it is the Edge Function secret
-- META_SYSTEM_TOKEN (a Business Manager system user token that does not expire).
-- The Page token derived from it is kept in social_tokens (service role only).
--
-- It uses two Vault secrets, created here if missing:
--   project_url      https://<project>.supabase.co  (set it if this runs on another project)
--   social_cron_key  a random key; the Edge Function checks it with website.social_cron_key()
-- Posts that were scheduled directly in Meta Business Suite are copied into
-- the planner (source = 'meta') so the calendar shows everything that is coming.
-- They are read-only copies: the publisher never sends them (Meta does).
alter table website.social_posts add column if not exists source text check (source in ('meta'));
alter table website.social_posts add column if not exists external_id text;
create unique index if not exists social_posts_external_idx on website.social_posts (source, external_id) where source is not null;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret('https://mmtcalnsehyuprcwlpgu.supabase.co', 'project_url')
  where not exists (select 1 from vault.secrets where name = 'project_url');
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'social_cron_key')
  where not exists (select 1 from vault.secrets where name = 'social_cron_key');

create or replace function website.social_cron_key() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'social_cron_key'
$$;
revoke execute on function website.social_cron_key() from public, anon, authenticated;
grant execute on function website.social_cron_key() to service_role;

select cron.unschedule('social-publish') where exists (select 1 from cron.job where jobname = 'social-publish');
select cron.schedule('social-publish', '*/5 * * * *', $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/social-publish',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'social_cron_key')),
    body    := '{"action":"run"}'::jsonb,
    timeout_milliseconds := 120000)
$cron$);
