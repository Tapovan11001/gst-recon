# GST Recon

Matches a business's purchase register against GSTR-2B, shows how much input tax credit is at risk and why, and exports the result to Google Sheets.

**Live:** {{live-url}}

## How it works in 100 words

Every month, a business can only claim back the GST it paid on purchases if its suppliers have reported those same bills to the government. The government's list is called GSTR-2B. GST Recon puts your purchase records next to that list and pairs them up, even when an invoice number is written differently. It shows which bills your supplier never reported, where the amounts differ, and where a GSTIN has a typo. It adds up how much tax credit is at risk. You can paste the result into Google Sheets, and Claude writes a polite follow-up email to each supplier.

_Created by Aarov Makhija._

## Why

Since 2022 a business can only claim input tax credit on a purchase if the supplier has reported that invoice and it shows up in the buyer's GSTR-2B. So every month someone in accounts puts two spreadsheets side by side and matches them by hand. Invoice numbers are written differently ("INV-0042" in Tally, "INV42" on the portal), digits get swapped, a supplier forgets to file, and the credit quietly drops off. Small firms usually find out when the notice arrives.

## What it does

- Paste the purchase register and the GSTR-2B B2B rows as CSV, or copy them straight from Excel or Google Sheets. Column names are matched loosely ("Invoice number", "Inv No", "Document Number").
- Pairs the invoices in two passes:
  1. **Same supplier GSTIN and the same invoice number** after normalising. "INV-0042", "inv/42" and "INV 42" count as the same. Then it compares taxable value and tax within a tolerance you set.
  2. For what's left: **same amounts, with an invoice number one or two keystrokes off** ("KA/1123" vs "KA/1132"), or **a GSTIN that fails its checksum** where 2B has the same invoice under a valid one. These are marked "probable", to confirm by hand, never matched silently.
- Whatever is still unpaired is **missing in 2B** (credit at risk until the supplier files) or **missing in books** (not recorded yet).
- Validates every GSTIN with the real check-digit algorithm.
- Flags the wrong tax type: IGST from a supplier in your own state, or CGST + SGST from one in another state.
- Shows totals: credit in books, credit in 2B, credit at risk. The worst rows come first.
- **Copy for Google Sheets** puts tab-separated rows on the clipboard, so a paste into A1 fills the columns. A CSV download is there too.
- **Supplier follow-ups**: Claude writes one email per supplier who has to act. The `save_email` tool rejects an email that leaves out an invoice it's about, or that mentions a rupee amount not in the data. It then sends the email back to be fixed.

## The sample

October data for a made-up Pune manufacturer: 11 invoices in the books, 10 in 2B. Seven problems are planted. One invoice number is written differently, one bill is booked as IGST when it's intra-state, one has a value mismatch, two bills were never filed by the supplier, one invoice number has swapped digits, and one GSTIN has a typo. There's also one bill in 2B that was never booked. The tests check that each is found, and that ₹23,580 of credit is at risk.

## Run it

```bash
npm install
npm test        # 6 tests: GSTIN checksum, matching, every planted issue, CSV/Sheets parsing, export, the email checks
npm run dev     # localhost:5173
```

## Layout

| Path | What's in it |
|---|---|
| `src/core/gst.ts` | GSTIN checksum, invoice normalising, the matcher, CSV in and Sheets out |
| `src/core/sample.ts` | Sample register and 2B with planted issues |
| `src/agent.ts` | Claude agent with `get_supplier_issues` and `save_email` |
| `src/harness/` | [TinyHarness](https://github.com/Tapovan11001/tinyharness), vendored |
| `web/` | Inputs, totals, filterable results, follow-up emails |

## Limits

- B2B invoices only. Credit notes, imports and amendments aren't handled yet.
- It reads the B2B rows you paste. It doesn't log in to the GST portal.
- "Probable" matches are for a person to confirm. That's on purpose.

## License

MIT
