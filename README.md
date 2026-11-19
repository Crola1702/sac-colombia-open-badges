# SAC Team IEEE Colombia Open Badges

Open Badges 3.0 issuer (VC Data Model 2.0, Data Integrity `eddsa-rdfc-2022`) running on free tiers: Supabase (Postgres, Auth, Edge Functions) and GitHub Pages. Emails go out through Brevo.

```
web/        static site (landing, admin, public verify page, did.json)
supabase/   migrations and edge functions (issue, verify)
scripts/    generate-key.mjs, generate-client-key.mjs
tests/      node tests for the CSV parser
```

## Deployment

1. **Supabase project.** Create a free project. Note the project ref, URL and anon key.
2. **Migrations.** `supabase link --project-ref <ref> && supabase db push` (or paste `supabase/migrations/*.sql` in the SQL editor). This also seeds four badge types.
3. **Auth.** Authentication > Providers > Email: enable it, disable "Allow new users to sign up". Authentication > URL Configuration: set Site URL to `https://<owner>.github.io/<repo>/admin.html` and add it to the Redirect URLs. The built-in mailer is rate limited (few emails per hour); configure custom SMTP (Brevo SMTP works) if issuers sign in often.
4. **Issuer key and DID.** The DID is `did:web:<owner>.github.io:<repo>` and resolves to `https://<owner>.github.io/<repo>/did.json`.
   ```
   npm install
   node scripts/generate-key.mjs did:web:<owner>.github.io:<repo>
   ```
   It writes `web/did.json` (public, commit it) and prints the secret values once. Never commit the private key.
5. **Secrets.**
   ```
   supabase secrets set \
     ISSUER_DID=did:web:<owner>.github.io:<repo> \
     ISSUER_PUBLIC_KEY_MULTIBASE=... ISSUER_PRIVATE_KEY_MULTIBASE=... \
     ISSUER_URL=https://<owner>.github.io/<repo>/ \
     VERIFY_BASE_URL=https://<owner>.github.io/<repo>/verify.html \
     BREVO_API_KEY=... EMAIL_FROM=badges@your-verified-sender.org EMAIL_FROM_NAME="SAC Team IEEE Colombia"
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.
6. **Functions.**
   ```
   supabase functions deploy issue
   supabase functions deploy verify --no-verify-jwt
   supabase functions deploy claim --no-verify-jwt
   ```
   `verify` and `claim` are public by design (`claim` is authorized by a signed token). `issue` checks the user JWT and the issuer allowlist itself. CORS is `*` because `issue` requires a JWT.
7. **Brevo.** Create a free account, verify a sender address (Senders, Domains & Dedicated IPs), create an API key (SMTP & API). Free plan: 300 emails/day, which is also the effective daily issuing cap. Brevo only needs a verified sender, not a verified domain.
8. **GitHub Pages.** Repo Settings > Pages: Source "GitHub Actions". Settings > Secrets and variables > Actions > Variables: add `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Push to `main`; `deploy-pages.yml` tests, writes `web/config.js` and deploys. For local use copy `web/config.example.js` to `web/config.js`.
9. **First issuer.** Add the email to the allowlist (lowercase) and invite the user:
   ```sql
   insert into public.issuers (email, name) values ('person@example.org', 'Person Name');
   ```
   Then Authentication > Users > Invite user with the same email. They sign in at `admin.html` with a magic link.

## Daily operation

- **New badge type:** admin page > Badge types > fill the form. Edit or deactivate from the list (inactive types cannot be issued).
- **Issue one:** pick the type, enter name and email.
- **Issue many:** upload a CSV with header `name,email`, review the preview (invalid and duplicate rows are skipped), send. Max 200 rows per file.
- **Email failed:** the credential is kept; the list shows the error. Click Resend.
- **Revoke:** Revoke in the credentials list, with a reason. The verify page then shows REVOKED. Credentials are never deleted.
- **Check by hand:** `https://<owner>.github.io/<repo>/verify.html?id=<uuid>`; the signed JSON can be downloaded and checked in external OB3 validators.

## Reissue

Credential has a wrong name or email? In the credentials list click Reissue, edit the fields inline and submit. The function issues a new credential for the same badge (`credentials.replaces` points at the old one), emails it, then revokes the old one with reason "Reissued". The old verify link then shows REVOKED. This is also the path for a revoked claim, because the token can never be redeemed again (`already_issued`).

## Claim API (contract v1)

Lets an external IEEE Colombia system (for example the card-tree-testing tool) hand a person a link to claim a badge. The two systems share nothing but this contract.

**Completion token.** Compact JWS (JWT), header `{"alg":"EdDSA","typ":"JWT","kid":"<key id>"}`, Ed25519. Claims:

| Claim | Required | Meaning |
|---|---|---|
| `iss` | yes | client_id registered here (e.g. `card-tree-testing`) |
| `aud` | yes | `sac-ieee-colombia-badges` |
| `sub` | yes | opaque pseudonymous completion id, no PII, max 128 chars |
| `badge` | yes | achievement slug |
| `jti` | yes | unique id, single use, max 128 chars |
| `iat`, `exp` | yes | `exp` in the future, `exp - iat <= max_token_age_seconds` (default 30 days), 60 s clock skew allowed |
| `evidence` | no | non-PII narrative, max 200 chars, added to the credential as `evidence: [{type: ["Evidence"], narrative}]` |

**Claim URL** given to the person: `<ISSUER_PAGES_URL>/claim.html#token=<jws>`. The token is in the fragment so it never reaches server logs or Referer, and `claim.js` clears it from the address bar after reading it.

**Endpoint.** `POST <SUPABASE_URL>/functions/v1/claim` (public, JSON body, send the project anon key as `apikey` header from browsers):

- `{"action":"preview","token"}` returns 200 `{"badge":{"slug","name","description","criteria","image_url"},"client":{"name"},"expires_at"}`. Does not consume the token.
- `{"action":"redeem","token","name","email"}` returns 201 `{"credential_id","verify_url","email_status"}` and sends the email. An email failure does not fail the redeem; see `email_status`.
- Errors are `{"error":"<code>","message"}`:

| Code | HTTP | When |
|---|---|---|
| `invalid_input` | 400 | bad JSON, missing action/token, bad name or email |
| `invalid_token` | 401 | bad signature, unknown iss or kid, inactive client, wrong aud, malformed or missing claims, lifetime too long |
| `token_expired` | 401 | `exp` passed (beyond skew) |
| `badge_not_allowed` | 403 | slug not in the client's `allowed_badges`, or badge inactive |
| `already_redeemed` | 409 | `jti` already used |
| `already_issued` | 409 | same client + `sub` + badge already has a credential |

**Flow.** Client system signs a token when a person completes something, and shows them the claim URL. The person opens it, `claim.html` calls `preview` and shows the badge, the person enters name and email, `claim.html` calls `redeem`. The issuer inserts a `claim_redemptions` row first (primary key on `jti`, unique on client+sub+badge, so concurrent redeems cannot both succeed), signs and stores the credential (`issued_by = claim:<client_id>`), emails the verify link, and returns it. If creating the credential fails the redemption row is deleted so the person can retry.

**Register a new client system.** Insert one row, no code change (keep each client's SQL in `supabase/clients/`; the pilot is `supabase/clients/card-tree-testing.sql`):

```
node scripts/generate-client-key.mjs <client_id> "<Display name>" <slug>[,<slug>] [kid]
```

It prints a private JWK (give it to the client system as a secret, never commit it), the public JWK, and the `insert into public.claim_clients` SQL to run in the SQL editor. The badge slugs must exist in `achievements`.

**Client key rotation.** Generate a new key with a new `kid`, append its public JWK to `claim_clients.jwks.keys` (keys are matched by `kid`), switch the client to sign with the new key, then remove the old public key once its tokens have expired. Set `active = false` to disable a client entirely.

**Privacy.** The issuer stores name and email (same as manual issuing) in `credentials`, plus `jti`, `sub` and client id in `claim_redemptions`. It never receives anything else about the person. The client system stores only what it already has and never sees the name or email entered at the claim page. `sub` must not be derivable to a person outside the client system, and `evidence` must not contain PII. The public credential holds a salted email hash and the name.

**Versioning.** Adding new optional claims is non-breaking (unknown claims are ignored). Any breaking change bumps `aud` to `sac-ieee-colombia-badges-v2`, and the issuer would then accept both during migration.

## Key rotation (issuer signing key)

The signature is checked against the key in the current `did.json` and the `ISSUER_PUBLIC_KEY_MULTIBASE` secret. Replacing the key makes all older credentials fail verification. To rotate safely you must keep old public keys resolvable (extra `verificationMethod` entries with their own ids) and teach `verify` to pick the key from `proof.verificationMethod`. That is not implemented; treat the key as long lived and back up the private key securely.

## Keepalive

Free Supabase projects pause after 7 days of inactivity. `keepalive.yml` reads one row from `achievements` every 3 days (and on demand) and fails on a non-2xx response so you get notified. GitHub disables scheduled workflows after 60 days without repo activity; re-enable them if that happens.

## Free tier limits to keep in mind

Supabase: 500 MB database, 500k edge function invocations/month, pause after 7 idle days. Brevo: 300 emails/day. Each issued credential is signed and emailed sequentially, so the admin page sends CSV batches in chunks of 25 per request to stay under function time limits. GitHub Pages: static only, public repo recommended.

## Tests

```
npm test                                  # CSV parser (node)
deno test --node-modules-dir=none --allow-read --allow-env supabase/functions/_shared/
```

The Deno test signs a credential offline (no network permission needed), verifies it, then tampers with a field and expects verification to fail.
