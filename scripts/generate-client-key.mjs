// Usage: node scripts/generate-client-key.mjs <client_id> "<Display name>" <badge-slug>[,<badge-slug>...] [kid]
// Prints the private JWK (store it in the CLIENT system's secrets, never here)
// and the SQL to register the public key at the issuer.
import { generateKeyPairSync } from "node:crypto";

const [clientId, name, badges, kid = `${new Date().getFullYear()}-1`] = process.argv.slice(2);
if (!clientId || !name || !badges) {
  console.error('Usage: node scripts/generate-client-key.mjs <client_id> "<Name>" <slug,slug> [kid]');
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pub = { ...publicKey.export({ format: "jwk" }), kid, alg: "EdDSA", use: "sig" };
const priv = { ...privateKey.export({ format: "jwk" }), kid, alg: "EdDSA", use: "sig" };
const sql = (s) => s.replaceAll("'", "''");

console.log("PRIVATE JWK (client secret, keep out of git):\n" + JSON.stringify(priv) + "\n");
console.log("PUBLIC JWK:\n" + JSON.stringify(pub) + "\n");
console.log("SQL (new client). To rotate, append the new public key to jwks.keys instead:\n");
console.log(`insert into public.claim_clients (id, name, jwks, allowed_badges) values
  ('${sql(clientId)}', '${sql(name)}', '${sql(JSON.stringify({ keys: [pub] }))}'::jsonb,
   array[${badges.split(",").map((b) => `'${sql(b.trim())}'`).join(", ")}]);`);
