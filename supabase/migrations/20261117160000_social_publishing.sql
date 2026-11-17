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
-- Before applying, add two Vault secrets (Supabase → Project Settings → Vault):
--   project_url      https://<project>.supabase.co
--   social_cron_key  the same value as the Edge Function secret SOCIAL_CRON_KEY
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

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
