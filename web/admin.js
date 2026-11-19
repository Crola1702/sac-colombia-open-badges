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
  say(error ? "No se pudo enviar el enlace. Revise el correo e intente de nuevo." : "Si este correo está autorizado, recibirá un enlace de acceso.", error ? "bad" : "ok");
};
$("logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $("login").hidden = false; return; }
  // RLS only lets active issuers read this table, so a row means authorized.
  const { data: me } = await sb.from("issuers").select("email").eq("email", session.user.email.toLowerCase()).maybeSingle();
  if (!me) { say("Esta cuenta no está autorizada para emitir insignias.", "bad"); $("logout").closest("p").hidden = false; $("app").hidden = false; document.querySelectorAll("#app section").forEach((s) => (s.hidden = true)); $("who").textContent = session.user.email; return; }
  $("who").textContent = `Sesión iniciada como ${session.user.email}`;
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
    h("td", { className: t.active ? "ok" : "muted" }, t.active ? "Activo" : "Inactivo"),
    h("td", { className: "row" },
      h("button", { className: "secondary", onclick: () => editType(t) }, "Editar"),
      h("button", { className: "secondary", onclick: () => setActive(t, !t.active) }, t.active ? "Desactivar" : "Activar")))));
  $("i-type").replaceChildren(...types.filter((t) => t.active).map((t) => h("option", { value: t.id }, t.name)));
}
function editType(t) {
  $("type-title").textContent = `Editar: ${t.name}`;
  $("t-id").value = t.id; $("t-name").value = t.name; $("t-slug").value = t.slug;
  $("t-desc").value = t.description; $("t-criteria").value = t.criteria;
  $("t-image").value = t.image_url || ""; $("t-atype").value = t.achievement_type;
  $("t-name").focus();
}
function resetType() { $("type-form").reset(); $("t-id").value = ""; $("type-title").textContent = "Nuevo tipo de insignia"; }
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
  say("Tipo de insignia guardado.", "ok"); resetType(); loadTypes();
};

// ---- issuing ----
function showResults(results) {
  $("results").replaceChildren(...results.map((r) => h("li", { className: !r.ok ? "bad" : r.email_status === "failed" ? "warn" : "ok" },
    !r.ok ? `${r.email}: no emitida (${r.error})`
      : r.email_status === "failed" ? `${r.email}: emitida, pero el correo FALLÓ (${r.email_error}). Use Reenviar en la lista inferior.`
      : `${r.email}: emitida y enviada por correo`)));
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
  $("csv-summary").textContent = `${csvRows.length} filas, ${valid} válidas.` + (valid > MAX_BATCH ? ` Demasiadas: máximo ${MAX_BATCH}.` : "");
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
      say(`Emitiendo ${Math.min(i + CHUNK, todo.length)} de ${todo.length}...`);
      all.push(...(await callIssue({ achievement_id: $("i-type").value, recipients: todo.slice(i, i + CHUNK) })).results);
    }
    say("Done.", "ok");
  } catch (err) { say(`Proceso detenido: ${err.message}. Las filas ya emitidas aparecen en la lista inferior.`, "bad"); }
  showResults(all);
};

// ---- issued credentials ----
async function loadCreds() {
  const { data, error } = await sb.from("credentials")
    .select("id, recipient_name, recipient_email, issued_at, email_status, email_error, revoked_at, revoked_reason, achievements(name)")
    .order("issued_at", { ascending: false }).limit(300);
  if (error) return say(error.message, "bad");
  $("creds").replaceChildren(...data.map((c) => h("tr", {},
    h("td", {}, new Date(c.issued_at).toLocaleString("es-CO")),
    h("td", {}, `${c.recipient_name} <${c.recipient_email}>`),
    h("td", {}, c.achievements?.name ?? ""),
    h("td", { className: c.email_status === "sent" ? "ok" : "bad", title: c.email_error || "" },
      c.email_status === "sent" ? "Enviado" : `Fallido${c.email_error ? `: ${c.email_error}` : ""}`),
    h("td", { className: c.revoked_at ? "bad" : "ok" }, c.revoked_at ? `Revocada${c.revoked_reason ? `: ${c.revoked_reason}` : ""}` : "Válida"),
    h("td", { className: "row" },
      h("a", { href: `verify.html?id=${c.id}`, target: "_blank", rel: "noopener" }, "Abrir"),
      h("button", { className: "secondary", onclick: (ev) => reissueForm(c, ev.target.closest("td")) }, "Reemitir"),
      ...(c.revoked_at ? [] : [
        h("button", { className: "secondary", onclick: () => resend(c.id) }, "Reenviar"),
        h("button", { className: "danger", onclick: () => revoke(c) }, "Revocar")])))));
}
async function resend(id) {
  try {
    const r = await callIssue({ action: "resend", credential_id: id });
    say(r.email_status === "sent" ? "Correo enviado." : `El correo falló: ${r.error}`, r.email_status === "sent" ? "ok" : "bad");
  } catch (err) { say(err.message, "bad"); }
  loadCreds();
}
// Small inline form (no prompt) to correct name/email; the old credential is revoked as "Reissued".
function reissueForm(c, cell) {
  const name = h("input", { value: c.recipient_name, required: true, "aria-label": "Nombre" });
  const email = h("input", { type: "email", value: c.recipient_email, required: true, "aria-label": "Correo electrónico" });
  const form = h("form", {}, name, email,
    h("button", {}, "Reemitir"),
    h("button", { type: "button", className: "secondary", onclick: () => form.remove() }, "Cancelar"));
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await callIssue({ action: "reissue", credential_id: c.id, name: name.value, email: email.value });
      say("Insignia reemitida. La anterior quedó revocada.", "ok");
    } catch (err) { say(err.message, "bad"); }
    loadCreds();
  };
  cell.append(form);
  name.focus();
}
async function revoke(c) {
  const reason = prompt(`¿Motivo de la revocación de la insignia de ${c.recipient_name}?`);
  if (!reason) return;
  const { error } = await sb.rpc("revoke_credential", { p_id: c.id, p_reason: reason });
  if (error) say(error.message, "bad"); else loadCreds();
}
$("reload").onclick = loadCreds;

start();
