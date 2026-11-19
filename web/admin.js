import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { parseRecipients } from "./csv.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const MAX_BATCH = 200;
// Smaller client-side chunks keep each request well under the edge function time limit
// (every credential is signed and emailed sequentially).
const CHUNK = 25;

// Build DOM with textContent only, so user-supplied data can never inject HTML.
function h(tag, props = {}, ...kids) {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids);
  return el;
}
function say(text, cls = "") { $("msg").textContent = text; $("msg").className = cls; }

// Calls the issue function; surfaces the server's error message on non-2xx.
async function callIssue(body) {
  const { data, error } = await sb.functions.invoke("issue", { body });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  return data;
}

// ---- auth ----
$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithOtp({
    email: $("login-email").value.trim(),
    options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
  });
  // Same message either way so the form does not reveal who is an issuer.
  say(error ? "Could not send the link. Check the email and try again." : "If this email is authorized, a sign-in link is on its way.", error ? "bad" : "ok");
};
$("logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $("login").hidden = false; return; }
  // RLS only lets active issuers read this table, so a row means authorized.
  const { data: me } = await sb.from("issuers").select("email").eq("email", session.user.email.toLowerCase()).maybeSingle();
  if (!me) { say("This account is not an authorized issuer.", "bad"); $("logout").closest("p").hidden = false; $("app").hidden = false; document.querySelectorAll("#app section").forEach((s) => (s.hidden = true)); $("who").textContent = session.user.email; return; }
  $("who").textContent = `Signed in as ${session.user.email}`;
  $("app").hidden = false;
  await Promise.all([loadTypes(), loadCreds()]);
}

// ---- badge types ----
let types = [];
async function loadTypes() {
  const { data, error } = await sb.from("achievements").select("*").order("name");
  if (error) return say(error.message, "bad");
  types = data;
  $("types").replaceChildren(...types.map((t) => h("tr", {},
    h("td", {}, t.name), h("td", {}, t.slug),
    h("td", { className: t.active ? "ok" : "muted" }, t.active ? "Active" : "Inactive"),
    h("td", { className: "row" },
      h("button", { className: "secondary", onclick: () => editType(t) }, "Edit"),
      h("button", { className: "secondary", onclick: () => setActive(t, !t.active) }, t.active ? "Deactivate" : "Activate")))));
  $("i-type").replaceChildren(...types.filter((t) => t.active).map((t) => h("option", { value: t.id }, t.name)));
}
function editType(t) {
  $("type-title").textContent = `Edit: ${t.name}`;
  $("t-id").value = t.id; $("t-name").value = t.name; $("t-slug").value = t.slug;
  $("t-desc").value = t.description; $("t-criteria").value = t.criteria;
  $("t-image").value = t.image_url || ""; $("t-atype").value = t.achievement_type;
  $("t-name").focus();
}
function resetType() { $("type-form").reset(); $("t-id").value = ""; $("type-title").textContent = "New badge type"; }
$("t-reset").onclick = resetType;
async function setActive(t, active) {
  const { error } = await sb.from("achievements").update({ active }).eq("id", t.id);
  if (error) say(error.message, "bad"); else loadTypes();
}
$("type-form").onsubmit = async (e) => {
  e.preventDefault();
  const row = {
    name: $("t-name").value.trim(), slug: $("t-slug").value.trim(),
    description: $("t-desc").value.trim(), criteria: $("t-criteria").value.trim(),
    image_url: $("t-image").value.trim() || null, achievement_type: $("t-atype").value.trim(),
  };
  const id = $("t-id").value;
  const { error } = id ? await sb.from("achievements").update(row).eq("id", id) : await sb.from("achievements").insert(row);
  if (error) return say(error.message, "bad");
  say("Badge type saved.", "ok"); resetType(); loadTypes();
};

// ---- issuing ----
function showResults(results) {
  $("results").replaceChildren(...results.map((r) => h("li", { className: !r.ok ? "bad" : r.email_status === "failed" ? "warn" : "ok" },
    !r.ok ? `${r.email}: not issued (${r.error})`
      : r.email_status === "failed" ? `${r.email}: issued, email FAILED (${r.email_error}). Use Resend below.`
      : `${r.email}: issued and emailed`)));
  loadCreds();
}
$("single-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const { results } = await callIssue({ achievement_id: $("i-type").value, recipients: [{ name: $("s-name").value, email: $("s-email").value }] });
    showResults(results); e.target.reset();
  } catch (err) { say(err.message, "bad"); }
};

let csvRows = [];
$("csv-file").onchange = async (e) => {
  try {
    csvRows = parseRecipients(await e.target.files[0].text());
  } catch (err) { csvRows = []; $("csv-preview").hidden = true; return say(err.message, "bad"); }
  const valid = csvRows.filter((r) => !r.error).length;
  $("csv-summary").textContent = `${csvRows.length} rows, ${valid} valid.` + (valid > MAX_BATCH ? ` Too many: max ${MAX_BATCH}.` : "");
  $("csv-rows").replaceChildren(...csvRows.map((r) => h("tr", {}, h("td", {}, r.name), h("td", {}, r.email), h("td", { className: r.error ? "bad" : "ok" }, r.error || "OK"))));
  $("csv-send").disabled = valid === 0 || valid > MAX_BATCH;
  $("csv-preview").hidden = false;
};
$("csv-send").onclick = async () => {
  const todo = csvRows.filter((r) => !r.error).map(({ name, email }) => ({ name, email }));
  $("csv-send").disabled = true;
  const all = [];
  try {
    for (let i = 0; i < todo.length; i += CHUNK) {
      say(`Issuing ${Math.min(i + CHUNK, todo.length)} of ${todo.length}...`);
      all.push(...(await callIssue({ achievement_id: $("i-type").value, recipients: todo.slice(i, i + CHUNK) })).results);
    }
    say("Done.", "ok");
  } catch (err) { say(`Stopped: ${err.message}. Rows already issued are listed below.`, "bad"); }
  showResults(all);
};

// ---- issued credentials ----
async function loadCreds() {
  const { data, error } = await sb.from("credentials")
    .select("id, recipient_name, recipient_email, issued_at, email_status, email_error, revoked_at, revoked_reason, achievements(name)")
    .order("issued_at", { ascending: false }).limit(300);
  if (error) return say(error.message, "bad");
  $("creds").replaceChildren(...data.map((c) => h("tr", {},
    h("td", {}, new Date(c.issued_at).toLocaleString()),
    h("td", {}, `${c.recipient_name} <${c.recipient_email}>`),
    h("td", {}, c.achievements?.name ?? ""),
    h("td", { className: c.email_status === "sent" ? "ok" : "bad", title: c.email_error || "" },
      c.email_status === "sent" ? "Sent" : `Failed${c.email_error ? `: ${c.email_error}` : ""}`),
    h("td", { className: c.revoked_at ? "bad" : "ok" }, c.revoked_at ? `Revoked${c.revoked_reason ? `: ${c.revoked_reason}` : ""}` : "Valid"),
    h("td", { className: "row" },
      h("a", { href: `verify.html?id=${c.id}`, target: "_blank", rel: "noopener" }, "Open"),
      h("button", { className: "secondary", onclick: (ev) => reissueForm(c, ev.target.closest("td")) }, "Reissue"),
      ...(c.revoked_at ? [] : [
        h("button", { className: "secondary", onclick: () => resend(c.id) }, "Resend"),
        h("button", { className: "danger", onclick: () => revoke(c) }, "Revoke")])))));
}
async function resend(id) {
  try {
    const r = await callIssue({ action: "resend", credential_id: id });
    say(r.email_status === "sent" ? "Email sent." : `Email failed: ${r.error}`, r.email_status === "sent" ? "ok" : "bad");
  } catch (err) { say(err.message, "bad"); }
  loadCreds();
}
// Small inline form (no prompt) to correct name/email; the old credential is revoked as "Reissued".
function reissueForm(c, cell) {
  const name = h("input", { value: c.recipient_name, required: true, "aria-label": "Name" });
  const email = h("input", { type: "email", value: c.recipient_email, required: true, "aria-label": "Email" });
  const form = h("form", {}, name, email,
    h("button", {}, "Reissue"),
    h("button", { type: "button", className: "secondary", onclick: () => form.remove() }, "Cancel"));
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await callIssue({ action: "reissue", credential_id: c.id, name: name.value, email: email.value });
      say("Reissued. The old credential is now revoked.", "ok");
    } catch (err) { say(err.message, "bad"); }
    loadCreds();
  };
  cell.append(form);
  name.focus();
}
async function revoke(c) {
  const reason = prompt(`Reason for revoking the badge of ${c.recipient_name}?`);
  if (!reason) return;
  const { error } = await sb.rpc("revoke_credential", { p_id: c.id, p_reason: reason });
  if (error) say(error.message, "bad"); else loadCreds();
}
$("reload").onclick = loadCreds;

start();
