import { Agent, defineTool, type ModelClient, type TraceEvent } from "./harness/index.ts";
import { bySupplier, fmt, statusLabel, tax, type Row } from "./core/gst.ts";

export const SYSTEM = `You help an Indian business's accountant follow up with suppliers after a GSTR-2B reconciliation.

Call get_supplier_issues. For each supplier with an issue the supplier has to act on (missing in 2B, amount mismatch, or an invoice in 2B the buyer doesn't recognise), write one short email with save_email. Skip suppliers whose only issue is on the buyer's side (a typo in the buyer's own books, or a tax-type booking error); those don't need an email.

Each email: polite, plain English, under 120 words. Name every invoice number it is about, with the amounts from the tool. Say exactly what you need the supplier to do (file it in GSTR-1, amend it, or confirm the invoice). Never invent amounts, dates or invoice numbers. Sign off as "Accounts team, {{buyer}}".

When done, reply with one line: how many emails, and the total credit at risk they cover.`;

export interface Email {
  gstin: string;
  supplier: string;
  subject: string;
  body: string;
}

export function makeFollowUpAgent(model: ModelClient, rows: Row[], buyer: string, onEvent?: (e: TraceEvent) => void) {
  const groups = bySupplier(rows);
  const state: { emails: Email[] } = { emails: [] };

  const tools = [
    defineTool<Record<string, never>>({
      name: "get_supplier_issues",
      description: "Reconciliation issues grouped by supplier, worst first.",
      input: { type: "object", properties: {} },
      run: () =>
        groups.map((gr) => ({
          supplier: gr.supplier,
          gstin: gr.gstin,
          creditAtRisk: gr.atRisk,
          issues: gr.rows.map((r) => ({
            status: statusLabel(r.status),
            invoiceInBooks: r.books?.invoiceNo ?? null,
            invoiceIn2B: r.gstr2b?.invoiceNo ?? null,
            date: (r.books ?? r.gstr2b)!.date,
            taxableBooks: r.books?.taxable ?? null,
            taxable2B: r.gstr2b?.taxable ?? null,
            taxBooks: r.books ? tax(r.books) : null,
            tax2B: r.gstr2b ? tax(r.gstr2b) : null,
            notes: r.notes,
          })),
        })),
    }),
    defineTool<{ gstin: string; subject: string; body: string }>({
      name: "save_email",
      description: "Save a follow-up email for one supplier. It is checked: the supplier must have issues, and every invoice number for them that needs their action must appear in the body.",
      input: {
        type: "object",
        properties: { gstin: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
        required: ["gstin", "subject", "body"],
      },
      run: ({ gstin, subject, body }) => {
        const gr = groups.find((x) => x.gstin === gstin.toUpperCase());
        if (!gr) throw new Error(`No issues for GSTIN ${gstin}. Use a GSTIN from get_supplier_issues.`);
        const needed = gr.rows
          .filter((r) => r.status === "missing-in-2b" || r.status === "amount-mismatch" || r.status === "missing-in-books")
          .map((r) => (r.books ?? r.gstr2b)!.invoiceNo);
        if (!needed.length) throw new Error(`${gr.supplier} has nothing for the supplier to fix. Skip this one.`);
        const missing = needed.filter((n) => !body.includes(n));
        if (missing.length) throw new Error(`The email doesn't mention ${missing.join(", ")}. Name every invoice it's about.`);
        if (body.split(/\s+/).length > 160) throw new Error("Too long. Keep it under 120 words.");
        const amounts = [...body.matchAll(/₹\s?([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
        const known = new Set(gr.rows.flatMap((r) => [r.books?.taxable, r.gstr2b?.taxable, r.books && tax(r.books), r.gstr2b && tax(r.gstr2b), r.itcAtRisk, gr.atRisk]).filter((x): x is number => typeof x === "number"));
        const made = amounts.filter((a) => ![...known].some((k) => Math.abs(k - a) < 1));
        if (made.length) throw new Error(`These amounts aren't in the data: ₹${made.map(fmt).join(", ₹")}. Use only amounts from get_supplier_issues.`);
        state.emails = state.emails.filter((e) => e.gstin !== gr.gstin);
        state.emails.push({ gstin: gr.gstin, supplier: gr.supplier, subject, body });
        return { saved: true, supplier: gr.supplier };
      },
    }),
  ];

  const agent = new Agent({ model, system: SYSTEM.replace("{{buyer}}", buyer), tools, limits: { maxSteps: 12 }, onEvent });
  return { agent, state, prompt: `Reconciliation for ${buyer} is done. ${groups.length} suppliers have something to look at.` };
}
