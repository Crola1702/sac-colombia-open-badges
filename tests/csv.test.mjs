import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseRecipients } from "../web/csv.js";

test("handles BOM, CRLF, quotes and embedded commas/newlines", () => {
  const rows = parseCsv('﻿name,email\r\n"Doe, Jane","j@x.co"\r\n"Say ""hi""","a@b.co"\r\n"Multi\nline",m@l.co');
  assert.deepEqual(rows, [
    ["name", "email"],
    ["Doe, Jane", "j@x.co"],
    ['Say "hi"', "a@b.co"],
    ["Multi\nline", "m@l.co"],
  ]);
});

test("skips blank lines and keeps a last row without newline", () => {
  assert.deepEqual(parseCsv("a,b\n\n1,2\n"), [["a", "b"], ["1", "2"]]);
});

test("parseRecipients validates emails, duplicates and header", () => {
  const r = parseRecipients("Name,Email\nAda,ADA@x.co\n,b@x.co\nBob,not-an-email\nAda2,ada@x.co");
  assert.deepEqual(r.map((x) => x.error), [null, "Missing name", "Invalid email", "Duplicate email in file"]);
  assert.equal(r[0].email, "ada@x.co");
  assert.throws(() => parseRecipients("foo,bar\n1,2"), /header/);
});
