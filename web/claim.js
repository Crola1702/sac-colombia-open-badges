import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = (id) => document.getElementById(id);
// The token lives in the URL fragment so it never reaches server logs or Referer.
const token = new URLSearchParams(location.hash.slice(1)).get("token");
history.replaceState(null, "", location.pathname + location.search);

async function api(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/claim`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ token, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(MESSAGES[data.error] || FALLBACK);
  return data;
}

// Contract error codes stay as-is; only the text shown to the person is Spanish.
const MESSAGES = {
  invalid_input: "Revise su nombre y correo electrónico e intente de nuevo.",
  invalid_token: "Este enlace de reclamación no es válido.",
  token_expired: "Este enlace de reclamación expiró.",
  badge_not_allowed: "Este enlace no puede otorgar esa insignia.",
  already_redeemed: "Este enlace de reclamación ya fue utilizado.",
  already_issued: "Esta insignia ya fue emitida para esta participación. Si algo no es correcto, comuníquese con el SAC Team.",
};
const FALLBACK = "Ocurrió un error. Intente de nuevo más tarde.";

function fail(e) { $("msg").textContent = e.message; $("msg").className = "bad"; $("msg").hidden = false; }

async function main() {
  if (!token) throw new Error("Esta página requiere el enlace de reclamación del sistema que le otorgó la insignia.");
  const { badge, client } = await api({ action: "preview" });
  $("client").textContent = client.name;
  $("name").textContent = badge.name;
  $("description").textContent = badge.description;
  $("criteria").textContent = badge.criteria;
  if (badge.image_url) { $("image").src = badge.image_url; $("image").alt = badge.name; $("image").hidden = false; }
  $("msg").hidden = true;
  $("claim").hidden = false;
}

$("form").onsubmit = async (e) => {
  e.preventDefault();
  $("submit").disabled = true;
  try {
    const r = await api({ action: "redeem", name: $("f-name").value, email: $("f-email").value });
    $("verify-link").href = r.verify_url;
    $("mail-note").textContent = r.email_status === "sent" ? "También le enviamos el enlace por correo." : "No pudimos enviar el correo, por favor guarde este enlace.";
    $("claim").hidden = true;
    $("done").hidden = false;
  } catch (err) { $("submit").disabled = false; fail(err); }
};

main().catch(fail);
