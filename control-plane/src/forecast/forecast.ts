import Database from "better-sqlite3";

/**
 * DEMAND FORECAST — the "pattern finding" layer.
 *
 * Reads sales_history and surfaces suggestions like:
 *   "Bread is going to sell out before Sunday. You sell ~2.4/day on weekends —
 *    with 3.2 in stock you'll run out in 1 day. Order 4 more."
 *
 * All output is EXPLAINED with the data backing it, never silently executed:
 * every proposal still goes through the gate chain (budget, consent, idempotency).
 */

export interface ForecastRow {
  product_id: string;
  name: string;
  category: string;
  stock: number;
  price_paise: number;
  avg_daily: number;           // mean units/day over the window
  weekend_daily: number;       // mean units/day on Sat+Sun
  weekday_daily: number;
  next_3d_expected: number;    // expected demand for the next 3 calendar days
  days_remaining: number;      // stock / next-3d-daily-rate (floored)
  alert: "RESTOCK_NOW" | "WATCH" | "OK";
  reason: string;
}

export class DemandForecast {
  constructor(private db: Database.Database) {}

  compute(windowDays = 28): ForecastRow[] {
    const products = this.db
      .prepare("SELECT product_id, name, category, price_paise, stock_qty FROM products")
      .all() as Array<{ product_id: string; name: string; category: string; price_paise: number; stock_qty: number }>;

    const since = Date.now() - windowDays * 86400000;
    const out: ForecastRow[] = [];

    for (const p of products) {
      const rows = this.db
        .prepare("SELECT quantity, sold_at FROM sales_history WHERE product_id=? AND sold_at>=?")
        .all(p.product_id, since) as Array<{ quantity: number; sold_at: number }>;

      if (!rows.length) continue;

      const perDay: Record<number, number> = {};
      rows.forEach((r) => {
        const d = new Date(r.sold_at).setHours(0, 0, 0, 0);
        perDay[d] = (perDay[d] ?? 0) + r.quantity;
      });
      const days = Object.keys(perDay).map(Number);
      const avg = days.reduce((a, d) => a + perDay[d], 0) / days.length;

      // Mean by weekend vs weekday for a real signal split
      let wkSum = 0, wkN = 0, wdSum = 0, wdN = 0;
      days.forEach((d) => {
        const dow = new Date(d).getDay();
        if (dow === 0 || dow === 6) { wkSum += perDay[d]; wkN++; } else { wdSum += perDay[d]; wdN++; }
      });
      const weekend = wkN ? wkSum / wkN : 0;
      const weekday = wdN ? wdSum / wdN : 0;
      const weekendLabel = wkN > 0 ? weekend.toFixed(1) : "no data";
      const weekdayLabel = wdN > 0 ? weekday.toFixed(1) : "no data";

      // Demand for the NEXT 3 days using what those calendar days look like historically
      let expected = 0;
      for (let i = 0; i < 3; i++) {
        const dow = new Date(Date.now() + i * 86400000).getDay();
        expected += dow === 0 || dow === 6 ? weekend : weekday;
      }
      const dailyRate = expected / 3;
      const daysRemaining = dailyRate > 0 ? p.stock_qty / dailyRate : 99;

      let alert: ForecastRow["alert"] = "OK";
      if (p.stock_qty <= 0 || daysRemaining <= 1) alert = "RESTOCK_NOW";
      else if (daysRemaining <= 3) alert = "WATCH";

      const reason =
        `${p.name}: ${(avg).toFixed(1)}/day avg (weekend: ${weekendLabel}, weekday: ${weekdayLabel}), ` +
        `${p.stock_qty} in stock → ${daysRemaining.toFixed(1)} days left.`;

      out.push({
        product_id: p.product_id,
        name: p.name,
        category: p.category,
        stock: p.stock_qty,
        price_paise: p.price_paise,
        avg_daily: +avg.toFixed(2),
        weekend_daily: +weekend.toFixed(2),
        weekday_daily: +weekday.toFixed(2),
        next_3d_expected: +expected.toFixed(2),
        days_remaining: +daysRemaining.toFixed(1),
        alert,
        reason,
      });
    }

    return out.sort((a, b) => a.days_remaining - b.days_remaining);
  }
}
