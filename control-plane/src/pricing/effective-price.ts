import Database from "better-sqlite3";

/**
 * EFFECTIVE-PRICE ENGINE
 * sticker price ≠ true cost. A naive agent rejects ₹6,000 against a ₹5,000 budget.
 * We resolve offers (percent / flat, product-scoped or category-wide) and compute the
 * effective price the customer actually pays. If effective ≤ budget → approve; mark rescued.
 */

export interface PriceDecision {
  product_id: string;
  sticker_paise: number;
  effective_paise: number;
  applied_offers: string[];
  within_budget: boolean;
  budget_paise: number;
  rescued: boolean; // true if sticker > budget but effective ≤ budget
}

export class PricingEngine {
  constructor(private db: Database.Database) {}

  evaluate(productId: string, budgetPaise: number): PriceDecision | { error: string } {
    const product = this.db
      .prepare("SELECT product_id, category, price_paise FROM products WHERE product_id=?")
      .get(productId) as { product_id: string; category: string; price_paise: number } | undefined;
    if (!product) return { error: "product_not_found" };

    const offers = this.db
      .prepare(
        "SELECT offer_id, type, value, max_discount_paise FROM offers WHERE active=1 AND (product_id=? OR category=?)"
      )
      .all(productId, product.category) as Array<{ offer_id: string; type: string; value: number; max_discount_paise: number | null }>;

    // Greedy best-combination: try each single offer (no stacking for hackathon simplicity)
    let best = product.price_paise;
    const applied: string[] = [];
    for (const o of offers) {
      let discount = 0;
      if (o.type === "percent") {
        discount = Math.floor((product.price_paise * o.value) / 100);
        if (o.max_discount_paise != null) discount = Math.min(discount, o.max_discount_paise);
      } else {
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
