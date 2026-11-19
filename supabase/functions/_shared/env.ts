import { IssuerConfig } from "./credential.ts";

export function issuerConfig(): IssuerConfig {
  const get = (k: string) => {
    const v = Deno.env.get(k);
    if (!v) throw new Error(`Missing secret ${k}`);
    return v;
  };
  return {
    did: get("ISSUER_DID"),
    url: get("ISSUER_URL"),
    publicKeyMultibase: get("ISSUER_PUBLIC_KEY_MULTIBASE"),
    privateKeyMultibase: get("ISSUER_PRIVATE_KEY_MULTIBASE"),
  };
}
