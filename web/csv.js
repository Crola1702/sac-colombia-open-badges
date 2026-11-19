// Tiny CSV parser: quoted fields, escaped quotes (""), BOM, CRLF/LF.
// Returns an array of rows (arrays of strings); blank lines are skipped.
export function parseCsv(text) {
  const src = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Expects a `name,email` header. Returns [{ name, email, error }] where error is null when valid.
export function parseRecipients(text) {
  const [header, ...rows] = parseCsv(text);
  const cols = (header || []).map((h) => h.trim().toLowerCase());
  const ni = cols.indexOf("name"), ei = cols.indexOf("email");
  if (ni < 0 || ei < 0) throw new Error('El encabezado del CSV debe ser "name,email"');
  const seen = new Set();
  return rows.map((r) => {
    const name = (r[ni] ?? "").trim();
    const email = (r[ei] ?? "").trim().toLowerCase();
    let error = null;
    if (!name) error = "Falta el nombre";
    else if (!EMAIL_RE.test(email)) error = "Correo no válido";
    else if (seen.has(email)) error = "Correo repetido en el archivo";
    seen.add(email);
    return { name, email, error };
  });
}
