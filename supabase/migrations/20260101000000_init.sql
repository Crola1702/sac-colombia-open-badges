-- Open Badges issuer schema. RLS is enabled on every table.

create table public.issuers (
  email      text primary key check (email = lower(email)),
  name       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER so the check works regardless of RLS on issuers.
create function public.is_issuer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.issuers
    where active and email = lower(auth.jwt() ->> 'email')
  );
$$;

create table public.achievements (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  name             text not null,
  description      text not null,
  criteria         text not null,           -- narrative shown as achievement.criteria
  image_url        text,
  achievement_type text not null default 'Badge',  -- OB3 AchievementType enum value
  active           boolean not null default true,
  created_by       text default lower(auth.jwt() ->> 'email'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger achievements_touch before update on public.achievements
  for each row execute function public.touch_updated_at();

create table public.credentials (
  id               uuid primary key default gen_random_uuid(),
  achievement_id   uuid not null references public.achievements(id),
  recipient_name   text not null,
  recipient_email  text not null,
  issued_by        text not null,
  issued_at        timestamptz not null default now(),
  credential       jsonb not null,           -- full signed OB3 credential
  email_status     text check (email_status in ('sent', 'failed')),
  email_error      text,
  revoked_at       timestamptz,
  revoked_reason   text
);
create index credentials_achievement_idx on public.credentials (achievement_id);
create index credentials_issued_at_idx on public.credentials (issued_at desc);

alter table public.issuers      enable row level security;
alter table public.achievements enable row level security;
alter table public.credentials  enable row level security;

create policy issuers_select on public.issuers
  for select to authenticated using (public.is_issuer());

-- Public (anon) reads active types; this is also what the keepalive hits.
create policy achievements_public_select on public.achievements
  for select to anon, authenticated using (active);
create policy achievements_issuer_select on public.achievements
  for select to authenticated using (public.is_issuer());
create policy achievements_issuer_insert on public.achievements
  for insert to authenticated with check (public.is_issuer());
create policy achievements_issuer_update on public.achievements
  for update to authenticated using (public.is_issuer()) with check (public.is_issuer());

-- Issuers can read; inserts come only from the edge function (service role bypasses RLS).
-- No update or delete policies: revocation goes through revoke_credential().
create policy credentials_issuer_select on public.credentials
  for select to authenticated using (public.is_issuer());

-- Column-limited update: only the revocation columns can change.
create function public.revoke_credential(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_issuer() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.credentials
     set revoked_at = now(), revoked_reason = p_reason
   where id = p_id and revoked_at is null;
end $$;
revoke execute on function public.revoke_credential(uuid, text) from public, anon;
grant execute on function public.revoke_credential(uuid, text) to authenticated;

-- Table privileges: defense in depth on top of RLS.
revoke all on public.issuers, public.credentials from anon, authenticated;
grant select on public.issuers, public.credentials to authenticated;
revoke all on public.achievements from anon, authenticated;
grant select on public.achievements to anon, authenticated;
grant insert, update on public.achievements to authenticated;

insert into public.achievements (slug, name, description, criteria) values
  ('test-participant', 'Test participant',
   'Awarded for taking part in a test of the SAC Team IEEE Colombia badge system.',
   'Participated in a test run of the badge issuing process.'),
  ('completed-the-wiki', 'Completed the wiki',
   'Awarded for completing the SAC Team IEEE Colombia wiki.',
   'Read and completed all sections of the SAC Team IEEE Colombia wiki.'),
  ('outstanding-volunteer', 'Outstanding volunteer',
   'Awarded for outstanding volunteer work with IEEE Colombia.',
   'Recognized by the SAC Team for exceptional volunteer contributions.'),
  ('event-attendee', 'Event attendee',
   'Awarded for attending an IEEE Colombia event.',
   'Attended an event organized by IEEE Colombia.');
