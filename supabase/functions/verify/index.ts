// Public endpoint. Uses the service role server-side but returns ONLY the
// signed credential plus status, never recipient_email or other columns.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { verifyCredential } from "../_shared/credential.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Invalid id" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await db
    .from("credentials")
    .select("credential, revoked_at, revoked_reason")
    .eq("id", id)
    .maybeSingle();
  if (error) return json({ error: "Lookup failed" }, 500);
  if (!data) return json({ error: "Credential not found" }, 404);

  const { verified, errors } = await verifyCredential(data.credential, {
    did: Deno.env.get("ISSUER_DID")!,
    publicKeyMultibase: Deno.env.get("ISSUER_PUBLIC_KEY_MULTIBASE")!,
  });
  return json({
    credential: data.credential,
    verified,
    revoked: !!data.revoked_at,
    revoked_reason: data.revoked_reason,
    errors,
  });
});
