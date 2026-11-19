import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get("id");

async function main() {
  if (!id) throw new Error("Falta el identificador de la insignia en el enlace.");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/verify?id=${encodeURIComponent(id)}`, {
    headers: { apikey: SUPABASE_ANON_KEY },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "No se pudo verificar la insignia.");
  render(data);
}

function render({ credential: c, verified, revoked, revoked_reason, errors }) {
  const a = c.credentialSubject.achievement;
  const person = c.credentialSubject.identifier.find((i) => i.identityType === "name");
  const date = new Date(c.validFrom);

  // Revoked wins over valid: a revoked badge must never look fine.
  const st = $("status");
  if (revoked) { st.textContent = "Revocada"; st.className = "status bad"; $("reason").textContent = revoked_reason || ""; }
  else if (verified) { st.textContent = "Válida"; st.className = "status ok"; }
  else { st.textContent = "No válida"; st.className = "status bad"; $("reason").textContent = errors.join(" "); }

  $("name").textContent = a.name;
  $("description").textContent = a.description || "";
  $("criteria").textContent = a.criteria?.narrative || "";
  $("recipient").textContent = person?.identityHash || "";
  $("date").textContent = date.toLocaleDateString("es-CO", { year: "numeric", month: "long", day: "numeric" });
  const issuer = $("issuer");
  issuer.textContent = c.issuer.name;
  if (c.issuer.url) issuer.href = c.issuer.url;
  if (a.image?.id) { $("image").src = a.image.id; $("image").alt = a.name; $("image").hidden = false; }
  if (a.image?.id) {
    // shortcut: assumes each SVG badge has a PNG twin at the same path, true for web/badges/; revisit if images move elsewhere.
    const png = a.image.id.replace(/\.svg$/i, ".png");
    Object.assign($("image-download"), { href: png, download: `insignia-${id}.png`, hidden: false });
  }

  $("download").onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(c, null, 2)], { type: "application/json" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: `badge-${id}.json` });
    link.click();
    URL.revokeObjectURL(url);
  };

  const q = new URLSearchParams({
    startTask: "CERTIFICATION_NAME", name: a.name, organizationName: c.issuer.name,
    issueYear: date.getFullYear(), issueMonth: date.getMonth() + 1,
    certUrl: location.href, certId: id,
  });
  $("linkedin").href = `https://www.linkedin.com/profile/add?${q}`;

  $("loading").hidden = true;
  $("result").hidden = false;
}

main().catch((e) => { $("loading").textContent = e.message; $("loading").className = "bad"; });
