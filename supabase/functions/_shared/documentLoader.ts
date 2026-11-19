// Offline JSON-LD document loader. Edge functions must never fetch contexts
// over the network: it is slow, flaky, and a trust risk. Everything the
// signing/verification libs need is bundled or derived from our own key.
import credentialsV2 from "./contexts/credentials-v2.json" with { type: "json" };
import obV3 from "./contexts/ob-v3p0-3.0.3.json" with { type: "json" };
import multikeyV1 from "./contexts/multikey-v1.json" with { type: "json" };

export const CTX_VC = "https://www.w3.org/ns/credentials/v2";
export const CTX_OB = "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json";
const CTX_MULTIKEY = "https://w3id.org/security/multikey/v1";

const STATIC: Record<string, unknown> = {
  [CTX_VC]: credentialsV2,
  [CTX_OB]: obV3,
  [CTX_MULTIKEY]: multikeyV1,
};

// Same shape as web/did.json (written by scripts/generate-key.mjs).
export function buildDidDocument(did: string, publicKeyMultibase: string) {
  return {
    "@context": ["https://www.w3.org/ns/did/v1", CTX_MULTIKEY],
    id: did,
    verificationMethod: [{
      id: `${did}#key-1`,
      type: "Multikey",
      controller: did,
      publicKeyMultibase,
    }],
    assertionMethod: [`${did}#key-1`],
    authentication: [`${did}#key-1`],
  };
}

export function makeDocumentLoader(did: string, publicKeyMultibase: string) {
  return (url: string) => {
    const base = url.split("#")[0];
    let document: unknown = STATIC[url];
    if (!document && base === did) {
      const doc = buildDidDocument(did, publicKeyMultibase);
      // A fragment URL resolves to the verification method itself.
      document = url === did
        ? doc
        : { "@context": CTX_MULTIKEY, ...doc.verificationMethod[0] };
    }
    if (!document) throw new Error(`Blocked network fetch of ${url}`);
    return Promise.resolve({ contextUrl: null, documentUrl: url, document });
  };
}
