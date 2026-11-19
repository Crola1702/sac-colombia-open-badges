// Issues credentials (single or batch) and resends emails. Requires a user JWT
// belonging to an active issuer. Inserts use the service role because
// credentials has no INSERT policy for users.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { corsHeaders, json } from "../_shared/cors.ts";
import { issuerConfig } from "../_shared/env.ts";
import { EMAIL_RE, issueCredential, sendBadgeEmail } from "../_shared/issuing.ts";

const MAX_BATCH = 200;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Identify the caller from their JWT, then check the allowlist.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /i, "");
  const { data: u } = await admin.auth.getUser(token);
  const callerEmail = u.user?.email?.toLowerCase();
  if (!callerEmail) return json({ error: "Unauthorized" }, 401);
  const { data: iss } = await admin.from("issuers").select("email").eq("email", callerEmail).eq("active", true).maybeSingle();
  if (!iss) return json({ error: "Not an authorized issuer" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const issuer = issuerConfig();

  if (body?.action === "resend") {
    const { data: c } = await admin.from("credentials")
      .select("id, recipient_name, recipient_email, revoked_at, achievements(name)")
      .eq("id", body.credential_id).maybeSingle();
    if (!c) return json({ error: "Credential not found" }, 404);
    if (c.revoked_at) return json({ error: "Credential is revoked" }, 409);
    const r = await sendBadgeEmail(admin, c.id, c.recipient_name, c.recipient_email, (c as any).achievements.name);
    return json({ credential_id: c.id, email_status: r.ok ? "sent" : "failed", error: r.error });
  }

  if (body?.action === "reissue") {
    const { data: old } = await admin.from("credentials")
      .select("id, recipient_name, recipient_email, achievements(*)").eq("id", body.credential_id).maybeSingle();
    if (!old) return json({ error: "Credential not found" }, 404);
    // Reissue only the latest version, otherwise each click would add another valid duplicate.
    const { data: newer } = await admin.from("credentials").select("id").eq("replaces", old.id).maybeSingle();
    if (newer) return json({ error: `Already reissued as ${newer.id}` }, 409);
    const name = String(body.name ?? old.recipient_name).trim();
    const email = String(body.email ?? old.recipient_email).trim().toLowerCase();
    if (!name || !EMAIL_RE.test(email)) return json({ error: "Invalid name or email" }, 400);
    try {
      // Issue the new one first so a failure never leaves the person without a credential.
      const c = await issueCredential({
        db: admin, issuer, achievement: (old as any).achievements, name, email,
        issuedBy: callerEmail, replaces: old.id,
      });
      await admin.from("credentials").update({ revoked_at: new Date().toISOString(), revoked_reason: "Reissued" })
        .eq("id", old.id).is("revoked_at", null);
      return json({ credential_id: c.id, email_status: c.email_status, email_error: c.email_error });
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
  }

  const recipients = body?.recipients;
  if (!body?.achievement_id || !Array.isArray(recipients) || recipients.length === 0) {
    return json({ error: "achievement_id and recipients[] are required" }, 400);
  }
  if (recipients.length > MAX_BATCH) return json({ error: `Max ${MAX_BATCH} recipients per request` }, 400);

  const { data: a } = await admin.from("achievements").select("*").eq("id", body.achievement_id).eq("active", true).maybeSingle();
  if (!a) return json({ error: "Badge type not found or inactive" }, 404);

  // Sequential on purpose: keeps CPU/memory low (RDF canonicalization) and respects email rate limits.
  const results = [];
  for (const r of recipients) {
    const name = String(r?.name ?? "").trim();
    const email = String(r?.email ?? "").trim().toLowerCase();
    if (!name || !EMAIL_RE.test(email)) {
      results.push({ email, ok: false, error: "Invalid name or email" });
      continue;
    }
    try {
      const c = await issueCredential({ db: admin, issuer, achievement: a, name, email, issuedBy: callerEmail });
      results.push({ email, ok: true, credential_id: c.id, email_status: c.email_status, email_error: c.email_error });
    } catch (e) {
      results.push({ email, ok: false, error: (e as Error).message });
    }
  }
  return json({ results });
});
