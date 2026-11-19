// Usage: node scripts/generate-key.mjs <did> [more args ignored]
//   e.g. node scripts/generate-key.mjs did:web:myorg.github.io:badges
// Prints the Supabase secrets and writes web/did.json (public data only).
// The private key is printed to the terminal once; it is never written to disk.
import { writeFileSync } from "node:fs";
import * as Ed25519Multikey from "@digitalbazaar/ed25519-multikey";

const did = process.argv[2];
if (!did?.startsWith("did:web:")) {
  console.error("Usage: node scripts/generate-key.mjs did:web:<owner>.github.io:<repo>");
  process.exit(1);
}

const key = await Ed25519Multikey.generate({ controller: did, id: `${did}#key-1` });
const { publicKeyMultibase, secretKeyMultibase } = await key.export({ publicKey: true, secretKey: true });

// Keep in sync with buildDidDocument() in supabase/functions/_shared/documentLoader.ts
const didDoc = {
  "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
  id: did,
  verificationMethod: [{ id: `${did}#key-1`, type: "Multikey", controller: did, publicKeyMultibase }],
  assertionMethod: [`${did}#key-1`],
  authentication: [`${did}#key-1`],
};
writeFileSync(new URL("../web/did.json", import.meta.url), JSON.stringify(didDoc, null, 2) + "\n");

console.log("Wrote web/did.json (public, commit it).\n");
console.log("Store these in Supabase (supabase secrets set ...). Keep the private key out of git:\n");
console.log(`ISSUER_DID=${did}`);
console.log(`ISSUER_PUBLIC_KEY_MULTIBASE=${publicKeyMultibase}`);
console.log(`ISSUER_PRIVATE_KEY_MULTIBASE=${secretKeyMultibase}`);
