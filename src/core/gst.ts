// GSTIN checks and invoice matching for GSTR-2B reconciliation. No AI in this file.

export interface Invoice {
  gstin: string; // supplier GSTIN
  supplier: string;
  invoiceNo: string;
  date: string; // YYYY-MM-DD
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
}

export type Status =
  | "matched" // same GSTIN + invoice, amounts within tolerance
  | "amount-mismatch" // same GSTIN + invoice, amounts differ
  | "probable" // close invoice number or GSTIN typo, same amounts: check by hand
  | "missing-in-2b" // in your books, supplier hasn't filed it: credit at risk
  | "missing-in-books"; // supplier filed it, you haven't recorded it

export interface Row {
  status: Status;
  books: Invoice | null;
  gstr2b: Invoice | null;
  notes: string[];
  itcAtRisk: number; // tax in books not backed by 2B
}

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The 15th character of a GSTIN is a checksum over the first 14. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]);
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

/** Format and checksum. Returns a problem, or null if the GSTIN is valid. */
export function gstinProblem(g: string): string | null {
  const s = g.trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) return "doesn't look like a GSTIN (15 characters: 2-digit state, PAN, entity, Z, check)";
  const st = Number(s.slice(0, 2));
  if (st < 1 || st > 38) return `state code ${s.slice(0, 2)} doesn't exist`;
  if (gstinCheckChar(s.slice(0, 14)) !== s[14]) return "fails the checksum, so a character is probably mistyped";
  return null;
}

export const STATES: Record<string, string> = {
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "19": "West Bengal", "23": "Madhya Pradesh",
  "24": "Gujarat", "27": "Maharashtra", "29": "Karnataka", "32": "Kerala", "33": "Tamil Nadu", "36": "Telangana",
};

/** INV-0042, inv/42 and INV 42 are the same invoice. */
export function normInvoice(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(" ").map((p) => (/^\d+$/.test(p) ? String(Number(p)) : p)).join("");
}

export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

export const tax = (i: Invoice) => round2(i.igst + i.cgst + i.sgst);
const round2 = (n: number) => Math.round(n * 100) / 100;
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

export interface Options {
  buyerGstin: string;
  tolerance: number; // rupees, per amount
}

/**
 * Pairs each invoice in your purchase register with one in GSTR-2B.
 * Pass 1: same GSTIN and same invoice number (after normalising).
 * Pass 2: same amounts, and either the invoice number is one or two keystrokes off
 *         or the GSTIN in your books is invalid but the invoice number matches.
 * Whatever is left over is missing on one side.
 */
export function reconcile(books: Invoice[], gstr2b: Invoice[], opt: Options): Row[] {
  const rows: Row[] = [];
  const left = new Set(gstr2b.map((_, i) => i));
  const pending: Invoice[] = [];
  const close = (a: number, b: number) => Math.abs(a - b) <= opt.tolerance;
  const sameAmounts = (a: Invoice, b: Invoice) => close(a.taxable, b.taxable) && close(tax(a), tax(b));

  for (const b of books) {
    const k = normInvoice(b.invoiceNo);
    const hit = [...left].find((i) => gstr2b[i].gstin.toUpperCase() === b.gstin.toUpperCase() && normInvoice(gstr2b[i].invoiceNo) === k);
    if (hit === undefined) { pending.push(b); continue; }
    left.delete(hit);
    const g = gstr2b[hit];
    const notes: string[] = [];
    if (b.invoiceNo.trim() !== g.invoiceNo.trim()) notes.push(`Invoice number written differently ("${b.invoiceNo}" vs "${g.invoiceNo}"), same invoice.`);
    if (sameAmounts(b, g)) {
      rows.push({ status: "matched", books: b, gstr2b: g, notes, itcAtRisk: 0 });
    } else {
      if (!close(b.taxable, g.taxable)) notes.push(`Taxable value ₹${fmt(b.taxable)} in books, ₹${fmt(g.taxable)} in 2B.`);
      if (!close(tax(b), tax(g))) notes.push(`Tax ₹${fmt(tax(b))} in books, ₹${fmt(tax(g))} in 2B.`);
      rows.push({ status: "amount-mismatch", books: b, gstr2b: g, notes, itcAtRisk: Math.max(0, round2(tax(b) - tax(g))) });
    }
  }

  for (const b of pending) {
    const badGstin = gstinProblem(b.gstin);
    const hit = [...left].find((i) => {
      const g = gstr2b[i];
      if (!sameAmounts(b, g) || days(b.date, g.date) > 31) return false;
      const sameGstin = g.gstin.toUpperCase() === b.gstin.toUpperCase();
      if (sameGstin) return editDistance(normInvoice(b.invoiceNo), normInvoice(g.invoiceNo)) <= 2;
      return badGstin !== null && normInvoice(b.invoiceNo) === normInvoice(g.invoiceNo) && editDistance(b.gstin.toUpperCase(), g.gstin.toUpperCase()) <= 2;
    });
    if (hit === undefined) {
      const notes = ["Not in GSTR-2B. The supplier may not have filed it yet. Until they do, this credit can't be claimed."];
      if (badGstin) notes.push(`GSTIN in your books ${badGstin}.`);
      rows.push({ status: "missing-in-2b", books: b, gstr2b: null, notes, itcAtRisk: tax(b) });
      continue;
    }
    left.delete(hit);
    const g = gstr2b[hit];
    const notes = g.gstin.toUpperCase() === b.gstin.toUpperCase()
      ? [`Invoice number "${b.invoiceNo}" in books, "${g.invoiceNo}" in 2B. Same supplier and amounts, so probably a typo. Confirm with the bill.`]
      : [`GSTIN in your books ${badGstin}. 2B has ${g.gstin} for the same invoice and amounts. Correct it in your books.`];
    rows.push({ status: "probable", books: b, gstr2b: g, notes, itcAtRisk: 0 });
  }

  for (const i of left) rows.push({ status: "missing-in-books", books: null, gstr2b: gstr2b[i], notes: ["In GSTR-2B but not in your purchase register. Book it if it's yours, or ask the supplier if it isn't."], itcAtRisk: 0 });

  // Tax-type check: same state means CGST + SGST, different state means IGST.
  const buyerState = opt.buyerGstin.slice(0, 2);
  for (const r of rows) {
    const b = r.books;
    if (!b) continue;
    const intra = b.gstin.slice(0, 2) === buyerState;
    if (intra && b.igst > 0) r.notes.push(`Supplier is in your state (${STATES[buyerState] ?? buyerState}), so this should be CGST + SGST, not IGST.`);
    if (!intra && (b.cgst > 0 || b.sgst > 0)) r.notes.push(`Supplier is in another state (${STATES[b.gstin.slice(0, 2)] ?? b.gstin.slice(0, 2)}), so this should be IGST, not CGST + SGST.`);
  }

  const order: Status[] = ["missing-in-2b", "amount-mismatch", "probable", "missing-in-books", "matched"];
  return rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.itcAtRisk - a.itcAtRisk);
}

export function summary(rows: Row[], books: Invoice[], gstr2b: Invoice[]) {
  const sum = (xs: Invoice[]) => round2(xs.reduce((s, i) => s + tax(i), 0));
  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  return {
    itcBooks: sum(books),
    itc2b: sum(gstr2b),
    atRisk: round2(rows.reduce((s, r) => s + r.itcAtRisk, 0)),
    matched: count("matched"),
    mismatch: count("amount-mismatch"),
    probable: count("probable"),
    missing2b: count("missing-in-2b"),
    missingBooks: count("missing-in-books"),
    withNotes: rows.filter((r) => r.notes.length > 0).length,
  };
}

/** Issues grouped by supplier, so one follow-up can go to each. */
export function bySupplier(rows: Row[]) {
  const m = new Map<string, { supplier: string; gstin: string; rows: Row[]; atRisk: number }>();
  for (const r of rows) {
    if (r.status === "matched" && !r.notes.length) continue;
    const inv = (r.books ?? r.gstr2b)!;
    const key = (r.gstr2b ?? r.books)!.gstin.toUpperCase();
    const e = m.get(key) ?? { supplier: inv.supplier, gstin: key, rows: [], atRisk: 0 };
    e.rows.push(r);
    e.atRisk = round2(e.atRisk + r.itcAtRisk);
    m.set(key, e);
  }
  return [...m.values()].sort((a, b) => b.atRisk - a.atRisk);
}

export const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// ---- CSV in and out ----

const HEADERS: Record<keyof Invoice, string[]> = {
  gstin: ["gstin", "supplier gstin", "gstin of supplier", "ctin"],
  supplier: ["supplier", "supplier name", "trade name", "trade/legal name", "name"],
  invoiceNo: ["invoice no", "invoice number", "inv no", "invoice", "document number"],
  date: ["date", "invoice date", "document date"],
  taxable: ["taxable", "taxable value", "taxable amount"],
  igst: ["igst", "integrated tax"],
  cgst: ["cgst", "central tax"],
  sgst: ["sgst", "state tax", "sgst/utgst", "state/ut tax"],
};

export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const delim = text.split("\n")[0].includes("\t") ? "\t" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) out.push(row);
  return out;
}

/** Dates as DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD. */
function normDate(s: string): string {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  throw new Error(`Couldn't read the date "${s}". Use DD-MM-YYYY.`);
}

const num = (s: string, what: string) => {
  const v = Number(s.replace(/[₹,\s]/g, "") || "0");
  if (Number.isNaN(v)) throw new Error(`"${s}" isn't a number (${what}).`);
  return v;
};

/** Reads a CSV or tab-separated paste from Excel/Sheets. Column names are matched loosely. */
export function readInvoices(text: string, label: string): Invoice[] {
  const rows = parseCsv(text.trim());
  if (rows.length < 2) throw new Error(`${label}: paste a header row and at least one invoice.`);
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*\(.*\)$/, ""));
  const col = {} as Record<keyof Invoice, number>;
  for (const [k, names] of Object.entries(HEADERS) as [keyof Invoice, string[]][]) {
    const i = head.findIndex((h) => names.includes(h));
    if (i < 0 && !["igst", "cgst", "sgst", "supplier"].includes(k)) throw new Error(`${label}: no "${names[0]}" column. Found: ${rows[0].join(", ")}.`);
    col[k] = i;
  }
  return rows.slice(1).map((r, n) => {
    const at = `${label} row ${n + 2}`;
    try {
      return {
        gstin: r[col.gstin].trim().toUpperCase(),
        supplier: col.supplier >= 0 ? r[col.supplier].trim() : "",
        invoiceNo: r[col.invoiceNo].trim(),
        date: normDate(r[col.date]),
        taxable: num(r[col.taxable], "taxable value"),
        igst: col.igst >= 0 ? num(r[col.igst] ?? "", "IGST") : 0,
        cgst: col.cgst >= 0 ? num(r[col.cgst] ?? "", "CGST") : 0,
        sgst: col.sgst >= 0 ? num(r[col.sgst] ?? "", "SGST") : 0,
      };
    } catch (e) {
      throw new Error(`${at}: ${e instanceof Error ? e.message : e}`);
    }
  });
}

const LABEL: Record<Status, string> = {
  matched: "Matched",
  "amount-mismatch": "Amount mismatch",
  probable: "Probable match, check",
  "missing-in-2b": "Missing in 2B",
  "missing-in-books": "Missing in books",
};
export const statusLabel = (s: Status) => LABEL[s];

/** Tab-separated, so it pastes straight into Google Sheets or Excel as columns. */
export function toSheet(rows: Row[]): string {
  const h = ["Status", "Supplier", "Supplier GSTIN", "Invoice (books)", "Invoice (2B)", "Date", "Taxable (books)", "Taxable (2B)", "Tax (books)", "Tax (2B)", "ITC at risk", "Notes"];
  const lines = rows.map((r) => {
    const i = (r.books ?? r.gstr2b)!;
    return [LABEL[r.status], i.supplier, (r.gstr2b ?? r.books)!.gstin, r.books?.invoiceNo ?? "", r.gstr2b?.invoiceNo ?? "", i.date, r.books?.taxable ?? "", r.gstr2b?.taxable ?? "", r.books ? tax(r.books) : "", r.gstr2b ? tax(r.gstr2b) : "", r.itcAtRisk || "", r.notes.join(" ")]
      .map((v) => String(v).replace(/[\t\n]/g, " "))
      .join("\t");
  });
  return [h.join("\t"), ...lines].join("\n");
}
