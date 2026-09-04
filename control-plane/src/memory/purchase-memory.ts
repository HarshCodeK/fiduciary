import Database from "better-sqlite3";

/**
 * PURCHASE MEMORY — bounded replenishment, never silent.
 * If a category repeats (2+ purchases), the agent MAY PROPOSE a replenishment
 * at the average quantity, but it still goes through consent + spend gates.
 */

export class PurchaseMemory {
  constructor(private db: Database.Database) {}

  record(productId: string, category: string, quantity: number, amountPaise: number): void {
    this.db
      .prepare("INSERT INTO purchase_history (product_id, category, quantity, amount_paise, purchased_at) VALUES (?,?,?,?,?)")
      .run(productId, category, quantity, amountPaise, Date.now());
  }

  suggestReplenishment(category: string): { category: string; suggested_quantity: number; based_on: number } | null {
    const rows = this.db
      .prepare("SELECT quantity FROM purchase_history WHERE category=? ORDER BY purchased_at DESC LIMIT 5")
      .all(category) as Array<{ quantity: number }>;
    if (rows.length < 2) return null;
    const avg = Math.round(rows.reduce((a, r) => a + r.quantity, 0) / rows.length);
    return { category, suggested_quantity: avg, based_on: rows.length };
  }
}
