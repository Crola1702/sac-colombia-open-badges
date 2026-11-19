import { assert, assertEquals } from "jsr:@std/assert@1";
import * as Ed25519Multikey from "npm:@digitalbazaar/ed25519-multikey@1.3.1";
import { buildCredential, signCredential, verifyCredential } from "./credential.ts";

Deno.test("sign, verify, and detect tampering", async () => {
  const did = "did:web:example.github.io:badges";
  const k = await Ed25519Multikey.generate({ controller: did, id: `${did}#key-1` });
  const exported = await k.export({ publicKey: true, secretKey: true });
  const issuer = {
    did,
    url: "https://example.github.io/badges/",
    publicKeyMultibase: exported.publicKeyMultibase,
    privateKeyMultibase: exported.secretKeyMultibase,
  };

  const unsigned = await buildCredential({
    id: "urn:uuid:11111111-1111-1111-1111-111111111111",
    issuer,
    achievement: {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Event attendee",
      description: "Attended an event.",
      criteria: "Be present.",
      image_url: "https://example.com/b.png",
    },
    recipient: { name: "Ada Lovelace", email: "Ada@Example.com" },
  });
  const signed = await signCredential(unsigned, issuer);
  assertEquals(signed.proof.type, "DataIntegrityProof");
  assertEquals(signed.proof.cryptosuite, "eddsa-rdfc-2022");
  assertEquals(signed.proof.verificationMethod, `${did}#key-1`);

  const ok = await verifyCredential(signed, issuer);
  assertEquals(ok.errors, []);
  assert(ok.verified);

  const tampered = structuredClone(signed);
  tampered.credentialSubject.achievement.name = "Outstanding volunteer";
  const bad = await verifyCredential(tampered, issuer);
  assert(!bad.verified);
});

Deno.test("evidence is signed and verifiable", async () => {
  const did = "did:web:example.github.io:badges";
  const k = await Ed25519Multikey.generate({ controller: did, id: `${did}#key-1` });
  const e = await k.export({ publicKey: true, secretKey: true });
  const issuer = { did, url: "https://example.github.io/badges/", publicKeyMultibase: e.publicKeyMultibase, privateKeyMultibase: e.secretKeyMultibase };
  const unsigned = await buildCredential({
    id: "urn:uuid:11111111-1111-1111-1111-111111111111", issuer,
    achievement: { id: "22222222-2222-2222-2222-222222222222", name: "N", description: "D", criteria: "C" },
    recipient: { name: "Ada", email: "a@x.co" }, evidence: "Completed the study",
  });
  const signed = await signCredential(unsigned, issuer);
  assertEquals((await verifyCredential(signed, issuer)).errors, []);
  const t = structuredClone(signed);
  t.evidence[0].narrative = "forged";
  assert(!(await verifyCredential(t, issuer)).verified);
});
