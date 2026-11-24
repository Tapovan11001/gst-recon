import { fmt, gstinProblem, readInvoices, reconcile, statusLabel, summary, tax, toSheet, type Row, type Status } from "../src/core/gst.ts";
import { BOOKS, BUYER, GSTR2B, toCsv } from "../src/core/sample.ts";
import { makeFollowUpAgent } from "../src/agent.ts";
import { anthropicModel } from "../src/harness/models/anthropic.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const rupee = (n: number) => `₹${fmt(n)}`;

let rows: Row[] = [];
type Filter = Status | "all" | "issues";
let filter: Filter = "issues";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "issues", label: "Needs action" },
  { key: "all", label: "All" },
  { key: "missing-in-2b", label: "Missing in 2B" },
  { key: "amount-mismatch", label: "Amount mismatch" },
  { key: "probable", label: "Probable match" },
  { key: "missing-in-books", label: "Missing in books" },
  { key: "matched", label: "Matched" },
];

function run() {
  const err = $("err");
  const buyer = $<HTMLInputElement>("buyer").value.trim().toUpperCase();
  try {
    const bp = gstinProblem(buyer);
    if (bp) throw new Error(`Your GSTIN ${bp}.`);
    const books = readInvoices($<HTMLTextAreaElement>("books").value, "Purchase register");
    const g2b = readInvoices($<HTMLTextAreaElement>("g2b").value, "GSTR-2B");
    rows = reconcile(books, g2b, { buyerGstin: buyer, tolerance: Math.max(0, Number($<HTMLInputElement>("tol").value) || 0) });
    err.hidden = true;
    const s = summary(rows, books, g2b);
    $("k-books").textContent = rupee(s.itcBooks);
    $("k-2b").textContent = rupee(s.itc2b);
    $("k-risk").textContent = rupee(s.atRisk);
    $("k-match").textContent = String(s.matched);
    $("k-match-of").textContent = `of ${rows.length} invoices`;
    $("data-line").textContent = `${books.length} invoices in your books, ${g2b.length} in 2B.`;
  } catch (e) {
    rows = [];
    err.hidden = false;
    err.textContent = e instanceof Error ? e.message : String(e);
    $<HTMLDetailsElement>("inputs").open = true;
  }
  $("emails").replaceChildren();
  $("mail-status").textContent = "";
  render();
}

const needsAction = (r: Row) => r.status !== "matched" || r.notes.some((n) => !n.startsWith("Invoice number written"));

function render() {
  $("filters").replaceChildren(
    ...FILTERS.map((f) => {
      const n = f.key === "all" ? rows.length : f.key === "issues" ? rows.filter(needsAction).length : rows.filter((r) => r.status === f.key).length;
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-pressed", String(filter === f.key));
      b.textContent = `${f.label} `;
      const c = document.createElement("span");
      c.textContent = String(n);
      b.append(c);
      b.addEventListener("click", () => { filter = f.key; render(); });
      return b;
    }),
  );
  const shown = rows.filter((r) => (filter === "all" ? true : filter === "issues" ? needsAction(r) : r.status === filter));
  $("rows").replaceChildren(
    ...shown.map((r) => {
      const tr = document.createElement("tr");
      tr.className = `s-${r.status}`;
      const i = (r.books ?? r.gstr2b)!;
      const td = (text: string, cls = "") => {
        const c = document.createElement("td");
        if (cls) c.className = cls;
        c.textContent = text;
        return c;
      };
      const st = document.createElement("td");
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = statusLabel(r.status);
      st.append(pill);
      const sup = document.createElement("td");
      const nm = document.createElement("div");
      nm.textContent = i.supplier || "(no name)";
      const gs = document.createElement("div");
      gs.className = "mono muted";
      gs.textContent = (r.gstr2b ?? r.books)!.gstin;
      sup.append(nm, gs);
      const inv = document.createElement("td");
      inv.className = "mono";
      const a = r.books?.invoiceNo, b = r.gstr2b?.invoiceNo;
      inv.textContent = a && b && a !== b ? `${a} / ${b}` : (a ?? b)!;
      const both = (f: (x: NonNullable<Row["books"]>) => number) =>
        r.books && r.gstr2b && Math.abs(f(r.books) - f(r.gstr2b)) > 0.5 ? `${fmt(f(r.books))} / ${fmt(f(r.gstr2b))}` : fmt(f((r.books ?? r.gstr2b)!));
      const notes = document.createElement("td");
      notes.className = "notes";
      for (const n of r.notes) {
        const p = document.createElement("p");
        p.textContent = n;
        notes.append(p);
      }
      tr.append(st, sup, inv, td(both((x) => x.taxable), "n mono"), td(both(tax), "n mono"), td(r.itcAtRisk ? fmt(r.itcAtRisk) : "", "n mono risk"), notes);
      return tr;
    }),
  );
  if (!shown.length) {
    const tr = document.createElement("tr");
    const c = document.createElement("td");
    c.colSpan = 7;
    c.className = "empty";
    c.textContent = rows.length ? "Nothing in this view." : "Fix the data above to see results.";
    tr.append(c);
    $("rows").append(tr);
  }
}

function load() {
  $<HTMLInputElement>("buyer").value = BUYER.gstin;
  $<HTMLTextAreaElement>("books").value = toCsv(BOOKS);
  $<HTMLTextAreaElement>("g2b").value = toCsv(GSTR2B);
  run();
}

let t: ReturnType<typeof setTimeout> | undefined;
for (const id of ["books", "g2b", "buyer", "tol"]) $(id).addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 250); });
$("sample").addEventListener("click", load);

$("copy").addEventListener("click", async () => {
  const text = toSheet(rows);
  try {
    await navigator.clipboard.writeText(text);
    $("copy-note").textContent = `Copied ${rows.length} rows. In Google Sheets, click cell A1 and paste.`;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.className = "fallback";
    $("copy-note").replaceChildren("Select all and copy this, then paste into Sheets:", ta);
    ta.select();
  }
});
$("csv").addEventListener("click", () => {
  const csv = toSheet(rows).split("\n").map((l) => l.split("\t").map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "gst-2b-reconciliation.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

try { const k = sessionStorage.getItem("gst-key"); if (k) $<HTMLInputElement>("api-key").value = k; } catch {}
$("draft").addEventListener("click", async () => {
  const key = $<HTMLInputElement>("api-key").value.trim();
  const st = $("mail-status");
  if (!rows.length) return;
  if (!key) { st.textContent = "Paste an Anthropic API key first."; return; }
  try { sessionStorage.setItem("gst-key", key); } catch {}
  const btn = $<HTMLButtonElement>("draft");
  btn.disabled = true;
  st.textContent = "Claude is reading the issues…";
  try {
    let rejected = 0;
    const { agent, state, prompt } = makeFollowUpAgent(anthropicModel({ apiKey: key, browser: true, maxTokens: 8000 }), rows, BUYER.name, (e) => {
      if (e.kind === "tool_result" && e.isError) { rejected++; st.textContent = `An email didn't pass the check (${rejected}). Claude is fixing it…`; }
      if (e.kind === "tool_result" && !e.isError && e.name === "save_email") st.textContent = "Saved an email. Writing the next…";
    });
    const r = await agent.run(prompt);
    $("emails").replaceChildren(
      ...state.emails.map((m) => {
        const card = document.createElement("article");
        card.className = "email";
        const h = document.createElement("h3");
        h.textContent = `To ${m.supplier}`;
        const sub = document.createElement("p");
        sub.className = "subject";
        sub.textContent = m.subject;
        const body = document.createElement("pre");
        body.textContent = m.body;
        card.append(h, sub, body);
        return card;
      }),
    );
    if (r.status === "done") st.textContent = `${state.emails.length} email${state.emails.length === 1 ? "" : "s"} written${rejected ? `, after ${rejected} fix${rejected === 1 ? "" : "es"}` : ""}. ${r.output ?? ""}`;
    else {
      const err = r.trace.find((e) => e.kind === "error");
      st.textContent = err && err.kind === "error"
        ? (/fetch|network|connection/i.test(err.message) ? "Couldn't reach the Claude API from this page. Open the hosted site if this preview blocks outside requests." : err.message)
        : `Stopped: ${r.status}.`;
    }
  } finally {
    btn.disabled = false;
  }
});

load();
