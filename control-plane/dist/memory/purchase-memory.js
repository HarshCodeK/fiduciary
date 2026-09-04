"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PurchaseMemory = void 0;
/**
 * PURCHASE MEMORY — bounded replenishment, never silent.
 * If a category repeats (2+ purchases), the agent MAY PROPOSE a replenishment
 * at the average quantity, but it still goes through consent + spend gates.
 */
class PurchaseMemory {
    db;
    constructor(db) {
        this.db = db;
    }
    record(productId, category, quantity, amountPaise) {
        this.db
            .prepare("INSERT INTO purchase_history (product_id, category, quantity, amount_paise, purchased_at) VALUES (?,?,?,?,?)")
            .run(productId, category, quantity, amountPaise, Date.now());
    }
    suggestReplenishment(category) {
        const rows = this.db
            .prepare("SELECT quantity FROM purchase_history WHERE category=? ORDER BY purchased_at DESC LIMIT 5")
            .all(category);
        if (rows.length < 2)
            return null;
        const avg = Math.round(rows.reduce((a, r) => a + r.quantity, 0) / rows.length);
        return { category, suggested_quantity: avg, based_on: rows.length };
    }
}
exports.PurchaseMemory = PurchaseMemory;
