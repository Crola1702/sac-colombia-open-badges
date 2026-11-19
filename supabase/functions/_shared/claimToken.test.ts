import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { exportJWK, generateKeyPair, SignJWT } from "npm:jose@6.2.17";
import { AUDIENCE, ClaimClient, ClaimError, verifyClaimToken } from "./claimToken.ts";

const pair = await generateKeyPair("EdDSA", { extractable: true });
const other = await generateKeyPair("EdDSA", { extractable: true });
const pub = { ...(await exportJWK(pair.publicKey)), kid: "k1" };

const client: ClaimClient = {
  id: "card-tree-testing", name: "Card Tree Testing", jwks: { keys: [pub] },
  allowed_badges: ["test-participant"], max_token_age_seconds: 3600, active: true,
};
const getClient = (iss: string) => Promise.resolve(iss === client.id ? client : null);

const now = Math.floor(Date.now() / 1000);
function sign(over: Record<string, unknown> = {}, key = pair.privateKey, kid = "k1") {
  const claims: Record<string, unknown> = {
    iss: client.id, aud: AUDIENCE, sub: "p-1", badge: "test-participant", jti: "j-1",
    iat: now, exp: now + 600, ...over,
  };
  for (const k of Object.keys(claims)) if (claims[k] === undefined) delete claims[k];
  return new SignJWT(claims).setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid }).sign(key);
}
async function code(token: string) {
  const e = await assertRejects(() => verifyClaimToken(token, getClient), ClaimError);
  return (e as ClaimError).code;
}

Deno.test("valid token passes, evidence is optional", async () => {
  const r = await verifyClaimToken(await sign({ evidence: "Completed the study" }), getClient);
  assertEquals(r.claims.sub, "p-1");
  assertEquals(r.claims.evidence, "Completed the study");
  assert((await verifyClaimToken(await sign(), getClient)).claims.evidence === undefined);
});

Deno.test("failures map to the contract codes", async () => {
  assertEquals(await code(await sign({}, other.privateKey)), "invalid_token"); // wrong key
  assertEquals(await code(await sign({}, pair.privateKey, "nope")), "invalid_token"); // unknown kid
  assertEquals(await code(await sign({ iss: "ghost" })), "invalid_token"); // unknown iss
  assertEquals(await code(await sign({ aud: "other" })), "invalid_token"); // wrong aud
  assertEquals(await code("not.a.jwt"), "invalid_token"); // malformed
  assertEquals(await code(await sign({ iat: now - 7200, exp: now - 3600 })), "token_expired");
  assertEquals(await code(await sign({ exp: now + 7200 })), "invalid_token"); // lifetime > 3600
  for (const missing of ["sub", "badge", "jti", "exp", "iat"]) {
    assertEquals(await code(await sign({ [missing]: undefined })), "invalid_token", missing);
  }
  assertEquals(await code(await sign({ sub: "x".repeat(129) })), "invalid_token");
  assertEquals(await code(await sign({ evidence: "x".repeat(201) })), "invalid_token");
});

Deno.test("inactive client is rejected", async () => {
  const t = await sign();
  await assertRejects(() => verifyClaimToken(t, () => Promise.resolve({ ...client, active: false })), ClaimError);
});
