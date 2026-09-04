"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PricingEngine = void 0;
class PricingEngine {
    db;
    constructor(db) {
        this.db = db;
    }
    evaluate(productId, budgetPaise) {
        const product = this.db
            .prepare("SELECT product_id, category, price_paise FROM products WHERE product_id=?")
            .get(productId);
        if (!product)
            return { error: "product_not_found" };
        const offers = this.db
            .prepare("SELECT offer_id, type, value, max_discount_paise FROM offers WHERE active=1 AND (product_id=? OR category=?)")
            .all(productId, product.category);
        // Greedy best-combination: try each single offer (no stacking for hackathon simplicity)
        let best = product.price_paise;
        const applied = [];
        for (const o of offers) {
            let discount = 0;
            if (o.type === "percent") {
                discount = Math.floor((product.price_paise * o.value) / 100);
                if (o.max_discount_paise != null)
                    discount = Math.min(discount, o.max_discount_paise);
            }
            else {
                discount = o.value;
            }
            const candidate = product.price_paise - discount;
            if (candidate < best) {
                best = candidate;
                applied.length = 0;
                applied.push(o.offer_id);
            }
        }
        const within = best <= budgetPaise;
        const rescued = product.price_paise > budgetPaise && within;
        return {
            product_id: productId,
            sticker_paise: product.price_paise,
            effective_paise: best,
            applied_offers: applied,
            within_budget: within,
            budget_paise: budgetPaise,
            rescued,
        };
    }
}
exports.PricingEngine = PricingEngine;
