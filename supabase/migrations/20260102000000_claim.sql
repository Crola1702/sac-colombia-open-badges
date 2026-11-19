-- Claim API: external systems register here (one row per system, no code change).

create table public.claim_clients (
  id                     text primary key,            -- the token's "iss"
  name                   text not null,
  jwks                   jsonb not null,              -- {"keys":[public JWK with kid, ...]}
  allowed_badges         text[] not null default '{}', -- achievement slugs
  max_token_age_seconds  int not null default 2592000, -- 30 days
  active                 boolean not null default true,
  created_at             timestamptz not null default now()
);

-- jti primary key = single use; unique(client, sub, badge) = one credential per completion.
create table public.claim_redemptions (
  jti             text primary key,
  client_id       text not null references public.claim_clients(id),
  sub             text not null,
  achievement_id  uuid not null references public.achievements(id),
  credential_id   uuid references public.credentials(id),
  redeemed_at     timestamptz not null default now(),
  unique (client_id, sub, achievement_id)
);

alter table public.claim_clients     enable row level security;
alter table public.claim_redemptions enable row level security;

create policy claim_clients_select on public.claim_clients
  for select to authenticated using (public.is_issuer());
create policy claim_redemptions_select on public.claim_redemptions
  for select to authenticated using (public.is_issuer());

revoke all on public.claim_clients, public.claim_redemptions from anon, authenticated;
grant select on public.claim_clients, public.claim_redemptions to authenticated;

-- Set when a credential is reissued; points at the revoked one.
alter table public.credentials add column replaces uuid references public.credentials(id);
