// Sample October data for a small Pune manufacturer. Suppliers and GSTINs are made up,
// but the GSTINs pass the real checksum, except the one typo planted on purpose.
import { gstinCheckChar, type Invoice } from "./gst.ts";

const g = (first14: string) => first14 + gstinCheckChar(first14);

export const BUYER = { name: "Sahyadri Precision Parts", gstin: g("27AAPFS1234K1Z") };

const S = {
  shree: { supplier: "Shree Packaging", gstin: g("27AADCS4321L1Z") },
  bharat: { supplier: "Bharat Steel Traders", gstin: g("24AAFFB7788M1Z") },
  nandi: { supplier: "Nandi Electricals", gstin: g("29AAKCN5566P1Z") },
  om: { supplier: "Om Logistics", gstin: g("07AABCO9012Q1Z") },
  kaveri: { supplier: "Kaveri Chemicals", gstin: g("33AAGCK3344R1Z") },
};

const inter = (s: { supplier: string; gstin: string }, invoiceNo: string, date: string, taxable: number): Invoice => ({ ...s, invoiceNo, date, taxable, igst: taxable * 0.18, cgst: 0, sgst: 0 });
const intra = (s: { supplier: string; gstin: string }, invoiceNo: string, date: string, taxable: number): Invoice => ({ ...s, invoiceNo, date, taxable, igst: 0, cgst: taxable * 0.09, sgst: taxable * 0.09 });

/** The Kaveri GSTIN as a clerk might type it, with two digits swapped. */
export const TYPO_GSTIN = S.kaveri.gstin.replace("3344", "3434");

export const BOOKS: Invoice[] = [
  intra(S.shree, "INV-0042", "2026-10-03", 20000),
  { ...intra(S.shree, "SP/118", "2026-10-09", 15000), igst: 2700, cgst: 0, sgst: 0 }, // booked as IGST by mistake
  inter(S.bharat, "BST/2026-27/311", "2026-10-05", 50000),
  inter(S.bharat, "BST/2026-27/327", "2026-10-14", 82000),
  inter(S.bharat, "BST/2026-27/340", "2026-10-28", 120000),
  inter(S.nandi, "KA/1123", "2026-10-07", 12500),
  inter(S.nandi, "KA/1140", "2026-10-21", 8000),
  inter(S.om, "OL-7781", "2026-10-11", 6000),
  inter(S.om, "OL-7790", "2026-10-25", 6400),
  { ...inter(S.kaveri, "KC/0091", "2026-10-08", 36000), gstin: TYPO_GSTIN },
  inter(S.kaveri, "KC/0102", "2026-10-22", 41000),
];

export const GSTR2B: Invoice[] = [
  intra(S.shree, "INV42", "2026-10-03", 20000),
  intra(S.shree, "SP/118", "2026-10-09", 15000),
  intra(S.shree, "INV-0057", "2026-10-30", 9000),
  inter(S.bharat, "BST/2026-27/311", "2026-10-05", 45000),
  inter(S.bharat, "BST/2026-27/327", "2026-10-14", 82000),
  inter(S.nandi, "KA/1132", "2026-10-07", 12500),
  inter(S.nandi, "KA/1140", "2026-10-21", 8000),
  inter(S.om, "OL-7790", "2026-10-25", 6400),
  inter(S.kaveri, "KC/0091", "2026-10-08", 36000),
  inter(S.kaveri, "KC/0102", "2026-10-22", 41000),
];

/** As a CSV you'd export from Tally or a spreadsheet. */
export function toCsv(xs: Invoice[]): string {
  const d = (s: string) => s.split("-").reverse().join("-");
  return ["GSTIN,Supplier,Invoice No,Invoice Date,Taxable Value,IGST,CGST,SGST",
    ...xs.map((i) => [i.gstin, i.supplier, i.invoiceNo, d(i.date), i.taxable, i.igst, i.cgst, i.sgst].join(","))].join("\n");
}
