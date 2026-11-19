// Public claim endpoint (contract v1, see README). Deployed with --no-verify-jwt:
// authorization is the signed completion token, not a user session.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { ClaimError, verifyClaimToken } from "../_shared/claimToken.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { issuerConfig } from "../_shared/env.ts";
import { EMAIL_RE, issueCredential, verifyUrl } from "../_shared/issuing.ts";

const fail = (code: string, message: string, status: number) => json({ error: code, message }, status);
const redeemed = () => new ClaimError("already_redeemed", "El enlace ya fue utilizado", 409);
const issued = () => new ClaimError("already_issued", "Ya se emitió una insignia para esta participación", 409);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("invalid_input", "Solo se admite POST", 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    let body: any;
    try { body = await req.json(); } catch { throw new ClaimError("invalid_input", "JSON no válido", 400); }
    if (typeof body?.token !== "string" || !["preview", "redeem"].includes(body?.action)) {
      throw new ClaimError("invalid_input", "Se requieren action y token", 400);
    }
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (body.action === "redeem" && (!name || name.length > 200 || !EMAIL_RE.test(email))) {
      throw new ClaimError("invalid_input", "Se requiere un nombre y un correo válidos", 400);
    }

    const { client, claims } = await verifyClaimToken(body.token, async (iss) =>
      (await db.from("claim_clients").select("*").eq("id", iss).maybeSingle()).data);

    const { data: a } = await db.from("achievements").select("*").eq("slug", claims.badge).eq("active", true).maybeSingle();
    if (!a || !client.allowed_badges.includes(claims.badge)) {
      throw new ClaimError("badge_not_allowed", "Este sistema no puede otorgar esa insignia", 403);
    }

    // Friendly early checks; the unique constraints below are what really enforce single use.
    const { data: byJti } = await db.from("claim_redemptions").select("jti").eq("jti", claims.jti).maybeSingle();
    if (byJti) throw redeemed();
    const { data: bySub } = await db.from("claim_redemptions").select("jti")
      .eq("client_id", client.id).eq("sub", claims.sub).eq("achievement_id", a.id).maybeSingle();
    if (bySub) throw issued();

    if (body.action === "preview") {
      return json({
        badge: { slug: a.slug, name: a.name, description: a.description, criteria: a.criteria, image_url: a.image_url },
        client: { name: client.name },
        expires_at: new Date(claims.exp * 1000).toISOString(),
      });
    }

    // Claim the slot first so concurrent redeems cannot both issue.
    const { error: insErr } = await db.from("claim_redemptions").insert({
      jti: claims.jti, client_id: client.id, sub: claims.sub, achievement_id: a.id,
    });
    if (insErr) {
      if (insErr.code !== "23505") throw new Error(insErr.message);
      throw `${insErr.message} ${insErr.details}`.includes("(jti)") ? redeemed() : issued();
    }

    try {
      const c = await issueCredential({
        db, issuer: issuerConfig(), achievement: a, name, email,
        issuedBy: `claim:${client.id}`, evidence: claims.evidence,
      });
      await db.from("claim_redemptions").update({ credential_id: c.id }).eq("jti", claims.jti);
      return json({ credential_id: c.id, verify_url: verifyUrl(c.id), email_status: c.email_status }, 201);
    } catch (e) {
      // Free the slot so the person can retry.
      await db.from("claim_redemptions").delete().eq("jti", claims.jti);
      throw e;
    }
  } catch (e) {
    if (e instanceof ClaimError) return fail(e.code, e.message, e.status);
    console.error(e);
    return json({ error: "server_error", message: "Error inesperado" }, 500);
  }
});
