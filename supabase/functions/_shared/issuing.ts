// The one issuing routine shared by manual issue, reissue and claim:
// build, sign, insert, email. Email failure never loses the credential.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.119.0";
import { AchievementInput, buildCredential, IssuerConfig, signCredential } from "./credential.ts";
import { badgeEmail, sendEmail } from "./email.ts";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const verifyUrl = (id: string) => `${Deno.env.get("VERIFY_BASE_URL")}?id=${id}`;

// Sends the email and records the outcome on the row.
export async function sendBadgeEmail(db: SupabaseClient, id: string, name: string, email: string, badge: string) {
  const m = badgeEmail(name, badge, verifyUrl(id));
  const r = await sendEmail({ name, email }, m.subject, m.html);
  await db.from("credentials").update({ email_status: r.ok ? "sent" : "failed", email_error: r.error }).eq("id", id);
  return r;
}

// Throws only if signing or the insert fails (nothing is stored in that case).
export async function issueCredential(o: {
  db: SupabaseClient;
  issuer: IssuerConfig;
  achievement: AchievementInput;
  name: string;
  email: string;
  issuedBy: string;
  evidence?: string;
  replaces?: string;
}) {
  const id = crypto.randomUUID();
  const unsigned = await buildCredential({
    id: verifyUrl(id), issuer: o.issuer, achievement: o.achievement,
    recipient: { name: o.name, email: o.email }, evidence: o.evidence,
  });
  const signed = await signCredential(unsigned, o.issuer);
  const { error } = await o.db.from("credentials").insert({
    id, achievement_id: o.achievement.id, recipient_name: o.name, recipient_email: o.email,
    issued_by: o.issuedBy, credential: signed, replaces: o.replaces ?? null,
  });
  if (error) throw new Error(error.message);
  const m = await sendBadgeEmail(o.db, id, o.name, o.email, o.achievement.name);
  return { id, email_status: m.ok ? "sent" : "failed", email_error: m.error };
}
