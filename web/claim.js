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
  const data = await res.json();
  if (!res.ok) throw new Error(MESSAGES[data.error] || data.message || "Something went wrong.");
  return data;
}

const MESSAGES = {
  invalid_token: "This claim link is not valid.",
  token_expired: "This claim link has expired.",
  badge_not_allowed: "This link cannot award that badge.",
  already_redeemed: "This claim link was already used.",
  already_issued: "A badge was already issued for this completion. Contact the SAC Team if something is wrong.",
};

function fail(e) { $("msg").textContent = e.message; $("msg").className = "bad"; $("msg").hidden = false; }

async function main() {
  if (!token) throw new Error("This page needs a claim link from the system that gave you the badge.");
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
    $("mail-note").textContent = r.email_status === "sent" ? "We also emailed you the link." : "We could not send the email, so save this link.";
    $("claim").hidden = true;
    $("done").hidden = false;
  } catch (err) { $("submit").disabled = false; fail(err); }
};

main().catch(fail);
