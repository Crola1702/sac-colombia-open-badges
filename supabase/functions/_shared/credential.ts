// Build, sign and verify Open Badges 3.0 credentials (VC Data Model 2.0,
// Data Integrity, eddsa-rdfc-2022). Pure functions: no I/O besides crypto.
import * as vc from "npm:@digitalbazaar/vc@7.3.0";
import { DataIntegrityProof } from "npm:@digitalbazaar/data-integrity@2.5.0";
import { cryptosuite as eddsaRdfc2022 } from "npm:@digitalbazaar/eddsa-rdfc-2022-cryptosuite@1.3.0";
import * as Ed25519Multikey from "npm:@digitalbazaar/ed25519-multikey@1.3.1";
import { CTX_OB, CTX_VC, makeDocumentLoader } from "./documentLoader.ts";

export interface IssuerConfig {
  did: string;
  url: string;
  publicKeyMultibase: string;
  privateKeyMultibase: string;
}

export interface AchievementInput {
  id: string;
  name: string;
  description: string;
  criteria: string;
  image_url?: string | null;
  achievement_type?: string | null;
}

export const ISSUER_NAME = "SAC Team IEEE Colombia";

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildCredential(opts: {
  id: string; // public verification URL or urn:uuid
  issuer: IssuerConfig;
  achievement: AchievementInput;
  recipient: { name: string; email: string };
  validFrom?: string;
  evidence?: string; // optional non-PII narrative
}) {
  const { achievement: a, recipient: r, issuer } = opts;
  // Salted hash keeps the email out of the public JSON; the salt is per credential.
  const salt = crypto.randomUUID();
  const email = r.email.trim().toLowerCase();
  const hash = await sha256Hex(email + salt);
  return {
    "@context": [CTX_VC, CTX_OB],
    id: opts.id,
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    issuer: { id: issuer.did, type: ["Profile"], name: ISSUER_NAME, url: issuer.url },
    validFrom: opts.validFrom ?? new Date().toISOString(),
    name: a.name,
    ...(opts.evidence ? { evidence: [{ type: ["Evidence"], narrative: opts.evidence }] } : {}),
    credentialSubject: {
      type: ["AchievementSubject"],
      identifier: [
        { type: "IdentityObject", identityType: "emailAddress", hashed: true, identityHash: `sha256$${hash}`, salt },
        // OB3 allows a plain (unhashed) identity; used to show the recipient name.
        { type: "IdentityObject", identityType: "name", hashed: false, identityHash: r.name.trim() },
      ],
      achievement: {
        id: `urn:uuid:${a.id}`,
        type: ["Achievement"],
        name: a.name,
        description: a.description,
        criteria: { narrative: a.criteria },
        ...(a.image_url ? { image: { id: a.image_url, type: "Image" } } : {}),
        achievementType: a.achievement_type || "Badge",
      },
    },
  };
}

export async function signCredential(credential: Record<string, unknown>, issuer: IssuerConfig) {
  const key = await Ed25519Multikey.from({
    "@context": "https://w3id.org/security/multikey/v1",
    type: "Multikey",
    id: `${issuer.did}#key-1`,
    controller: issuer.did,
    publicKeyMultibase: issuer.publicKeyMultibase,
    secretKeyMultibase: issuer.privateKeyMultibase,
  });
  const suite = new DataIntegrityProof({ signer: key.signer(), cryptosuite: eddsaRdfc2022 });
  return await vc.issue({
    credential: structuredClone(credential), // vc.issue mutates its input
    suite,
    documentLoader: makeDocumentLoader(issuer.did, issuer.publicKeyMultibase),
  });
}

export async function verifyCredential(
  credential: Record<string, unknown>,
  issuer: Pick<IssuerConfig, "did" | "publicKeyMultibase">,
): Promise<{ verified: boolean; errors: string[] }> {
  try {
    const suite = new DataIntegrityProof({ cryptosuite: eddsaRdfc2022 });
    const result = await vc.verifyCredential({
      credential,
      suite,
      documentLoader: makeDocumentLoader(issuer.did, issuer.publicKeyMultibase),
    });
    return {
      verified: !!result.verified,
      errors: result.verified ? [] : [String(result.error?.message ?? "Signature verification failed")],
    };
  } catch (e) {
    return { verified: false, errors: [(e as Error).message] };
  }
}
