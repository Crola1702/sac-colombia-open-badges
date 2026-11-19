-- Pilot claim client: card sorting and tree testing tool (Project 2).
-- Public key only; the private key lives in that project's Supabase secrets.
-- Apply in the SQL editor after the migrations. Re-running updates the key (rotation: append the new JWK to "keys").
insert into public.claim_clients (id, name, jwks, allowed_badges)
values (
  'card-tree-testing',
  'IEEE Colombia card sorting and tree testing tool',
  '{"keys":[{"crv":"Ed25519","x":"1YUOMmaSevLGXOU1WilrstXTla9Ziy-kzHjUCeBmcg0","kty":"OKP","kid":"card-tree-testing-2026-11-19","alg":"EdDSA","use":"sig"}]}',
  array['test-participant']
)
on conflict (id) do update set jwks = excluded.jwks, allowed_badges = excluded.allowed_badges;
