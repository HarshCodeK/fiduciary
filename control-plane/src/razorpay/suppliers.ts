import crypto from "crypto";
import Database from "better-sqlite3";

/**
 * SUPPLIER SPLIT ENGINE
 * When the agent restocks products across multiple suppliers, we:
 *   1. Group the cart by supplier
 *   2. Create ONE Razorpay order for the total
 *   3. Issue a per-supplier receipt so the merchant sees the split
 */
export interface Supplier {
  id: string;
  name: string;
  upi_id: string;           // real UPI handle we'd pay out to
  contact: string;
}

export const SUPPLIERS: Supplier[] = [
  { id: "metro-mart",   name: "MetroMart Wholesale", upi_id: "metromart@upi", contact: "orders@metromart.example" },
  { id: "freshmandi",   name: "FreshMandi",          upi_id: "freshmandi@upi", contact: "book@freshmandi.example" },
  { id: "valuetraders", name: "ValueTraders",        upi_id: "valuetraders@upi", contact: "support@valuetraders.example" },
];

export function splitBySupplier(db: Database.Database, items: Array<{ product_id: string; qty: number }>): Array<{ supplier: string; total_paise: number; lines: Array<{ name: string; qty: number; paise: number }> }> {
  const groups: Record<string, { total: number; lines: Array<{ name: string; qty: number; paise: number }> }> = {};
  for (const it of items) {
    const p = db.prepare("SELECT product_id, name, supplier, supplier_price_paise, price_paise FROM products WHERE product_id=?").get(it.product_id) as any;
    if (!p) continue;
    const supplier = p.supplier || "FiduciaryDirect";
    const price = p.supplier_price_paise ?? p.price_paise;
    const amt = price * it.qty;
    if (!groups[supplier]) groups[supplier] = { total: 0, lines: [] };
    groups[supplier].total += amt;
    groups[supplier].lines.push({ name: p.name, qty: it.qty, paise: amt });
  }
  return Object.entries(groups).map(([supplier, data]) => ({
    supplier,
    total_paise: data.total,
    lines: data.lines,
  }));
}
