import { test } from "node:test";
import assert from "node:assert/strict";
import { gstinProblem, normInvoice, readInvoices, reconcile, summary, toSheet, bySupplier } from "../src/core/gst.ts";
import { BOOKS, BUYER, GSTR2B, TYPO_GSTIN, toCsv } from "../src/core/sample.ts";
import { makeFollowUpAgent } from "../src/agent.ts";
import { scriptedModel, lastToolResults } from "../src/harness/index.ts";

const opt = { buyerGstin: BUYER.gstin, tolerance: 1 };

test("GSTIN checksum: sample GSTINs pass, the planted typo fails", () => {
  for (const i of [...BOOKS, ...GSTR2B]) if (i.gstin !== TYPO_GSTIN) assert.equal(gstinProblem(i.gstin), null, i.gstin);
  assert.match(gstinProblem(TYPO_GSTIN)!, /checksum/);
  assert.match(gstinProblem("27AAPFS1234K1")!, /doesn't look like/);
  assert.match(gstinProblem("99AAPFS1234K1Z5")!, /state code/);
});

test("invoice numbers are compared the way people write them", () => {
  assert.equal(normInvoice("INV-0042"), normInvoice("inv42"));
  assert.equal(normInvoice("BST/2026-27/311"), normInvoice("BST 2026 27 311"));
  assert.notEqual(normInvoice("KA/1123"), normInvoice("KA/1132"));
});

test("sample reconciliation finds every planted problem", () => {
  const rows = reconcile(BOOKS, GSTR2B, opt);
  const by = (inv: string) => rows.find((r) => r.books?.invoiceNo === inv || r.gstr2b?.invoiceNo === inv)!;
  assert.equal(by("INV-0042").status, "matched");
  assert.match(by("INV-0042").notes[0], /written differently/);
  assert.equal(by("SP/118").status, "matched");
  assert.match(by("SP/118").notes.join(), /should be CGST \+ SGST/);
  assert.equal(by("BST/2026-27/311").status, "amount-mismatch");
  assert.equal(by("BST/2026-27/311").itcAtRisk, 900);
  assert.equal(by("BST/2026-27/340").status, "missing-in-2b");
  assert.equal(by("KA/1123").status, "probable");
  assert.equal(by("OL-7781").status, "missing-in-2b");
  assert.equal(by("KC/0091").status, "probable");
  assert.match(by("KC/0091").notes[0], /checksum/);
  assert.equal(by("INV-0057").status, "missing-in-books");

  const s = summary(rows, BOOKS, GSTR2B);
  assert.deepEqual([s.matched, s.mismatch, s.probable, s.missing2b, s.missingBooks], [6, 1, 2, 2, 1]);
  assert.equal(s.atRisk, 900 + 21600 + 1080);
  assert.equal(rows[0].books?.invoiceNo, "BST/2026-27/340"); // biggest risk first
});

test("CSV round trip, Sheets-style tab paste and DD-MM-YYYY dates", () => {
  assert.deepEqual(readInvoices(toCsv(BOOKS), "Books"), BOOKS);
  const tsv = "Supplier GSTIN\tTrade/Legal name\tInvoice number\tInvoice date\tTaxable Value (₹)\tIntegrated Tax\n" + `${GSTR2B[3].gstin}\tBharat\tX/1\t05/10/2026\t"45,000"\t8100`;
  const [r] = readInvoices(tsv, "2B");
  assert.deepEqual([r.date, r.taxable, r.igst, r.cgst], ["2026-10-05", 45000, 8100, 0]);
  assert.throws(() => readInvoices("GSTIN,Invoice No\nX,1", "Books"), /no "date" column/);
  assert.throws(() => readInvoices("GSTIN,Invoice No,Date,Taxable\nX,1,2026/13/45,5", "Books"), /row 2.*date/);
});

test("sheet export has one row per invoice plus a header, tab-separated", () => {
  const rows = reconcile(BOOKS, GSTR2B, opt);
  const out = toSheet(rows).split("\n");
  assert.equal(out.length, rows.length + 1);
  assert.equal(out[0].split("\t").length, 12);
  assert.ok(out.every((l) => l.split("\t").length === 12));
});

test("follow-up agent: emails are checked for invoice numbers and made-up amounts", async () => {
  const rows = reconcile(BOOKS, GSTR2B, opt);
  const bharat = bySupplier(rows).find((g) => g.supplier === "Bharat Steel Traders")!;
  const model = scriptedModel([
    { tools: [{ name: "get_supplier_issues", input: {} }] },
    { tools: [{ name: "save_email", input: { gstin: bharat.gstin, subject: "GSTR-1 for October", body: "Please file BST/2026-27/340 and fix the value. We were charged ₹99,999." } }] },
    (req) => {
      assert.match(lastToolResults(req)[0], /doesn't mention BST\/2026-27\/311/);
      return { tools: [{ name: "save_email", input: { gstin: bharat.gstin, subject: "GSTR-1 for October", body: "Please file BST/2026-27/340 (tax ₹21,600) and amend BST/2026-27/311: taxable ₹50,000 on the bill but ₹45,000 in your return. We were charged ₹99,999." } }] };
    },
    (req) => {
      assert.match(lastToolResults(req)[0], /aren't in the data: ₹99,999/);
      return { tools: [{ name: "save_email", input: { gstin: bharat.gstin, subject: "GSTR-1 for October", body: "Please file BST/2026-27/340 (tax ₹21,600) and amend BST/2026-27/311: taxable ₹50,000 on the bill but ₹45,000 in your return." } }] };
    },
    { text: "1 email, covering ₹22,500 at risk." },
  ]);
  const { agent, state, prompt } = makeFollowUpAgent(model, rows, BUYER.name);
  const r = await agent.run(prompt);
  assert.equal(r.status, "done");
  assert.equal(state.emails.length, 1);
  assert.equal(state.emails[0].supplier, "Bharat Steel Traders");
});
