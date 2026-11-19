// Verifies a client system's completion token (contract v1). Client lookup is
// injected so this is testable without a database.
import { decodeJwt, decodeProtectedHeader, errors, importJWK, jwtVerify } from "npm:jose@6.2.17";

export const AUDIENCE = "sac-ieee-colombia-badges";
const SKEW_SECONDS = 60;

export class ClaimError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}
const bad = (m: string) => new ClaimError("invalid_token", m, 401);

export interface ClaimClient {
  id: string;
  name: string;
  jwks: { keys: Array<Record<string, unknown>> };
  allowed_badges: string[];
  max_token_age_seconds: number;
  active: boolean;
}
export interface ClaimClaims { iss: string; sub: string; badge: string; jti: string; iat: number; exp: number; evidence?: string }

export async function verifyClaimToken(
  token: string,
  getClient: (iss: string) => Promise<ClaimClient | null>,
  now = new Date(),
): Promise<{ client: ClaimClient; claims: ClaimClaims }> {
  let kid: string | undefined, iss: unknown;
  try {
    const h = decodeProtectedHeader(token);
    if (h.alg !== "EdDSA") throw new Error("alg");
    kid = h.kid;
    iss = decodeJwt(token).iss; // unverified: only used to pick the key set
  } catch { throw bad("Malformed token"); }
  if (!kid || typeof iss !== "string") throw bad("Missing kid or iss");

  const client = await getClient(iss);
  if (!client || !client.active) throw bad("Unknown issuer");
  const jwk = client.jwks.keys.find((k) => k.kid === kid);
  if (!jwk) throw bad("Unknown key id");

  let payload;
  try {
    ({ payload } = await jwtVerify(token, await importJWK(jwk as never, "EdDSA"), {
      audience: AUDIENCE, algorithms: ["EdDSA"], clockTolerance: SKEW_SECONDS, currentDate: now,
    }));
  } catch (e) {
    if (e instanceof errors.JWTExpired) throw new ClaimError("token_expired", "Token expired", 401);
    throw bad("Invalid signature or audience");
  }

  const { sub, badge, jti, iat, exp, evidence } = payload;
  const str = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
  if (!str(sub, 128) || !str(badge, 128) || !str(jti, 128)) throw bad("Missing or invalid sub, badge or jti");
  if (typeof iat !== "number" || typeof exp !== "number") throw bad("Missing iat or exp");
  if (exp - iat > client.max_token_age_seconds) throw bad("Token lifetime too long");
  if (evidence !== undefined && !str(evidence, 200)) throw bad("Invalid evidence");

  return { client, claims: { iss, sub, badge, jti, iat, exp, evidence } as ClaimClaims };
}
