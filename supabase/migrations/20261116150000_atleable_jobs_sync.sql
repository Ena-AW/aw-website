-- Atleable → website jobs sync.
--
-- Atleable's jobs already live in this same database (public.jobs), so the
-- website reads them directly: no HTTP API between the two is needed, and
-- nothing in Atleable's own tables changes (no triggers, no new columns).
--
-- website.sync_atleable_jobs() copies Atleable jobs into website.jobs:
--   * a job published in Atleable appears on the website (see atleable_rule()),
--   * edits to its title, description, location, work model and type follow,
--   * when it is archived, unpublished or deleted in Atleable it is closed here.
-- Website-only fields (slug, position, salary, apply link, spotlight) are never
-- overwritten. A status chosen in the admin panel (e.g. Closed to hide a job)
-- stays until the job's state changes in Atleable.
--
-- It runs from the atleable-sync Edge Function (every 15 minutes from GitHub
-- Actions, when Atleable pings it, or from the admin panel's "Sync" button).

alter table website.jobs
  add column if not exists atleable_state      text,         -- Atleable's state when last synced
  add column if not exists atleable_updated_at timestamptz;  -- Atleable's updated_at when last synced

-- Which Atleable jobs go on the website:
--   'all'    every job published in Atleable
--   'mkt'    only published jobs whose client is a marketing client (MKT)
--   'manual' every published job is copied in as a draft; the team publishes it
create or replace function website.atleable_rule() returns text
language sql immutable set search_path = '' as $$ select 'all' $$;

create or replace function website.slugify(t text) returns text
language sql immutable set search_path = '' as $$
  select trim(both '-' from regexp_replace(
    lower(translate(coalesce(t, ''),
      'ÁÀÂÃÄÅáàâãäåÇçĆćČčÉÈÊËéèêëĘęÍÌÎÏíìîïŁłÑñŃńÓÒÔÕÖØóòôõöøŚśŠšÚÙÛÜúùûüÝýÿŹźŻżŽžĄąßŐőŰű',
      'AAAAAAaaaaaaCcCcCcEEEEeeeeEeIIIIiiiiLlNnNnOOOOOOooooooSsSsUUUUuuuuYyyZzZzZzAasOoUu')),
    '[^a-z0-9]+', '-', 'g'));
$$;

-- "German Gaming Support Specialist" → German. Atleable rarely fills its
-- language field, so the title is the fallback.
create or replace function website.language_from(lang text, title text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(
    nullif(trim(lang), ''),
    initcap((regexp_match(coalesce(title, ''),
      '\m(german|dutch|flemish|french|italian|spanish|portuguese|english|greek|polish|swedish|danish|norwegian|finnish|czech|slovak|turkish|hebrew|arabic|russian|romanian|hungarian|bulgarian|croatian|serbian|slovenian|ukrainian|japanese|korean|chinese|mandarin|cantonese|estonian|latvian|lithuanian|icelandic|persian|farsi|irish)\M',
      'i'))[1]),
    case when title ~* '\m(fran[cç]ais|francophone)' then 'French'
         when title ~* '\mitalian[oa]' then 'Italian'
         when title ~* '\mportugu[eê]s' then 'Portuguese' end,
    '');
$$;

create or replace function website.sync_atleable_jobs()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  rule text := website.atleable_rule();
  r record;
  listed boolean;
  new_status text;
  s text;
  loc text;
  ctry text;
  added int := 0;
  changed int := 0;
  closed int := 0;
begin
  if not (website.is_staff() or coalesce((select auth.role()), '') = 'service_role') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  for r in
    select j.id, j.title, j.shortcode, j.state, j.language, j.market, j.location, j.work_model,
           j.description, j.updated_at, coalesce(c.is_marketing, false) as is_marketing,
           e.employment_type,
           w.id as wid, w.status as wstatus, w.atleable_state, w.atleable_updated_at,
           w.language as wlanguage, w.apply_url as wapply
    from public.jobs j
    left join public.clients c on c.id = j.client_id
    left join public.job_extras e on e.job_id = j.id
    left join website.jobs w on w.atleable_id = j.id::text
    where w.id is not null or j.state = 'published'
  loop
    listed := r.state = 'published' and (rule <> 'mkt' or r.is_marketing);
    loc  := coalesce(nullif(trim(r.location), ''), nullif(trim(r.market), ''), '');
    ctry := coalesce(nullif(trim(r.market), ''), nullif(trim(split_part(loc, ',', -1)), ''), '');

    if r.wid is null then
      continue when not listed;
      s := coalesce(nullif(website.slugify(r.title), ''), 'job');
      if exists (select 1 from website.jobs where slug = s) then
        s := s || '-' || website.slugify(r.shortcode);
      end if;
      insert into website.jobs (
        slug, title, description, location, location_slug, country, language, position,
        employment_type, work_model, apply_url, status, source, atleable_id, atleable_state, atleable_updated_at)
      values (
        s, r.title, coalesce(r.description, ''), loc,
        website.slugify(split_part(loc, ',', 1) || case when ctry <> '' then '-' || ctry else '' end),
        ctry, website.language_from(r.language, r.title),
        case when r.title ~* 'sales' then 'Sales'
             when r.title ~* 'marketing|social media|content' then 'Marketing'
             when r.title ~* 'technical|tech support|\mit\M' then 'Technical Support'
             else 'Customer Support' end,
        case when r.employment_type ~* 'part' then 'Part-time'
             when r.employment_type ~* 'contract|temp' then 'Contract'
             when r.employment_type ~* 'intern' then 'Internship'
             else 'Full-time' end,
        case lower(replace(coalesce(r.work_model, ''), '-', '_'))
             when 'remote' then 'Remote' when 'hybrid' then 'Hybrid' else 'On-site' end,
        'https://apply.workable.com/j/' || r.shortcode,
        case when rule = 'manual' then 'draft' else 'published' end,
        'atleable', r.id::text, r.state, r.updated_at);
      added := added + 1;
      continue;
    end if;

    -- Status follows Atleable only when Atleable's state changes, so the
    -- team can still hide a job here without it coming straight back.
    new_status := r.wstatus;
    if r.atleable_state is distinct from r.state then
      new_status := case when not listed then 'closed'
                         when rule = 'manual' then r.wstatus
                         else 'published' end;
    end if;

    if r.atleable_updated_at is distinct from r.updated_at or new_status <> r.wstatus then
      update website.jobs set
        title           = r.title,
        description     = coalesce(r.description, ''),
        location        = loc,
        location_slug   = website.slugify(split_part(loc, ',', 1) || case when ctry <> '' then '-' || ctry else '' end),
        country         = ctry,
        language        = case when nullif(trim(r.language), '') is not null or r.wlanguage = ''
                               then website.language_from(r.language, r.title) else r.wlanguage end,
        employment_type = case when r.employment_type ~* 'part' then 'Part-time'
                               when r.employment_type ~* 'contract|temp' then 'Contract'
                               when r.employment_type ~* 'intern' then 'Internship'
                               else 'Full-time' end,
        work_model      = case lower(replace(coalesce(r.work_model, ''), '-', '_'))
                               when 'remote' then 'Remote' when 'hybrid' then 'Hybrid' else 'On-site' end,
        apply_url       = case when r.wapply = '' then 'https://apply.workable.com/j/' || r.shortcode else r.wapply end,
        status          = new_status,
        atleable_state  = r.state,
        atleable_updated_at = r.updated_at
      where id = r.wid;
      if new_status = 'closed' and r.wstatus <> 'closed' then closed := closed + 1; else changed := changed + 1; end if;
    elsif r.atleable_state is distinct from r.state then
      update website.jobs set atleable_state = r.state where id = r.wid;
    end if;
  end loop;

  -- Deleted in Atleable: close it here (kept for records).
  with gone as (
    update website.jobs w set status = 'closed', atleable_state = 'deleted'
    where w.source = 'atleable' and w.atleable_state is distinct from 'deleted'
      and not exists (select 1 from public.jobs j where j.id::text = w.atleable_id)
    returning 1
  )
  select closed + count(*) into closed from gone;

  return jsonb_build_object('added', added, 'updated', changed, 'closed', closed);
end;
$$;

revoke execute on function website.sync_atleable_jobs() from anon, public;
grant execute on function website.sync_atleable_jobs() to authenticated, service_role;
grant execute on function website.slugify(text), website.language_from(text, text), website.atleable_rule() to authenticated, service_role;
