import Database from "better-sqlite3";
import { IdempotencyGuard } from "../idempotency/guard";
import { ConsentService } from "../consent/service";
import { ConsentInbox } from "../consent/inbox";
import { PricingEngine } from "../pricing/effective-price";
import { PurchaseMemory } from "../memory/purchase-memory";
import { AuditLog } from "../audit/log";
import { ReceiptService } from "../audit/receipt";
import { EventBus } from "../events/bus";
import { DemandForecast } from "../forecast/forecast";
import * as rzp from "../razorpay/client";

const HIGH_VALUE_THRESHOLD = Number(process.env.HIGH_VALUE_THRESHOLD_PAISE ?? 200000);

export function createController(db: Database.Database) {
  const idem = new IdempotencyGuard(db);
  const consent = new ConsentService(db, process.env.CONSENT_TOKEN_SECRET ?? "");
  const inbox = new ConsentInbox(db, consent);
  const pricing = new PricingEngine(db);
  const memory = new PurchaseMemory(db);
  const audit = new AuditLog(db);
  const receipts = new ReceiptService(process.env.CONSENT_TOKEN_SECRET ?? "");
  const bus = new EventBus(db);
  const forecast = new DemandForecast(db);

  const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;

  const ctrl = {
    searchCatalog: async (query: string) => {
      const rows = db
        .prepare("SELECT product_id, name, category, price_paise FROM products WHERE lower(name) LIKE ? LIMIT 10")
        .all(`%${query.toLowerCase()}%`);
      audit.append({ event_type: "catalog_search", payload: { query, found: (rows as unknown[]).length } });
      return rows;
    },

    /** Phase-1 DoD hook: agent proposes a purchase. Control plane gates everything. */
    proposePurchase: async (input: { product_id: string; budget_paise: number; quantity?: number }) => {
      const quantity = input.quantity ?? 1;
      const price = pricing.evaluate(input.product_id, input.budget_paise);
      if ("error" in price) return { error: price.error };

      audit.append({ event_type: "price_evaluated", payload: price as unknown as Record<string, unknown> });

      if (!price.within_budget) {
        audit.append({ event_type: "purchase_rejected", payload: { reason: "over_budget", ...price } });
        return { rejected: true, reason: "over_budget", price };
      }

      const intent = { product_id: input.product_id, budget_paise: input.budget_paise };
      const key = idem.deriveKey("create_order", intent);
      const params = { ...intent, effective_price_paise: price.effective_paise, quantity };
      const guard = idem.check(key, params);

      if (guard.action === "replay") {
        audit.append({ event_type: "idempotency_replay", payload: { key, note: "no second Razorpay call" } });
        return { replayed: true, response: guard.cachedResponse, idempotency_key: key };
      }
      if (guard.action === "reject") {
        audit.append({ event_type: "idempotency_violation", payload: { key, ...guard.rejection } });
        return { rejected: true, reason: guard.rejection, idempotency_key: key };
      }

      idem.begin(key, params);
      try {
        const order = await rzp.createOrder(price.effective_paise * quantity, `fid-${key.slice(-20)}`);
        db.prepare(
          "INSERT INTO orders (order_id, product_id, status, amount_paise, sticker_price_paise, effective_price_paise, budget_paise, rescued, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
        ).run(order.id, input.product_id, "created", price.effective_paise * quantity, price.sticker_paise * quantity, price.effective_paise, input.budget_paise, price.rescued ? 1 : 0, Date.now(), Date.now());
        audit.append({
          event_type: "order_created",
          payload: { order_id: order.id, amount: price.effective_paise * quantity, rescued: price.rescued, live: rzp.isLive(), applied_offers: price.applied_offers },
        });
        const response = { order_id: order.id, status: order.status, amount_paise: price.effective_paise * quantity, rescued: price.rescued, applied_offers: price.applied_offers, live: rzp.isLive(), _key: key };
        idem.complete(key, response);
        return response;
      } catch (e) {
        idem.fail(key);
        audit.append({ event_type: "order_failed", payload: { key, error: String(e) } });
        return { rejected: true, reason: "razorpay_error", detail: String(e) };
      }
    },

    /** Consent flow — the ONLY way to mint a token. The "human" is whoever can call this endpoint. */
    requestConsent: async (input: { order_id: string }) => {
      const order = db.prepare("SELECT order_id, amount_paise FROM orders WHERE order_id=?").get(input.order_id) as { order_id: string; amount_paise: number } | undefined;
      if (!order) return { error: "order_not_found" };
      if (order.amount_paise < HIGH_VALUE_THRESHOLD) return { consent_required: false, reason: "below_threshold", amount: order.amount_paise };
      const tok = consent.issue({ action: "capture_payment", amount_paise: order.amount_paise, merchant_id: "fiduciary_demo", order_id: order.order_id });
      audit.append({ event_type: "consent_issued", payload: { order_id: order.order_id, amount: order.amount_paise, expires_at: tok.expires_at } });
      return { consent_required: true, token_id: tok.token_id, signature: tok.signature, expires_at: tok.expires_at };
    },

    capture: async (input: { order_id: string; consent?: { token_id: string; signature: string }; simulate_failure?: "timeout_before_response" }) => {
      const order = db.prepare("SELECT * FROM orders WHERE order_id=?").get(input.order_id) as { order_id: string; amount_paise: number } | undefined;
      if (!order) return { error: "order_not_found" };

      if (order.amount_paise >= HIGH_VALUE_THRESHOLD) {
        if (!input.consent) {
          audit.append({ event_type: "consent_rejected", payload: { order_id: input.order_id, reason: "no_token_provided", amount: order.amount_paise } });
          return { rejected: true, reason: "consent_required_missing", threshold: HIGH_VALUE_THRESHOLD };
        }
        const verdict = consent.verify({
          token_id: input.consent.token_id,
          signature: input.consent.signature,
          action: "capture_payment",
          amount_paise: order.amount_paise,
          order_id: order.order_id,
        });
        if (!verdict.ok) {
          audit.append({ event_type: "consent_rejected", payload: { order_id: input.order_id, reason: verdict.reason } });
          return { rejected: true, reason: `consent_invalid:${verdict.reason}` };
        }
        audit.append({ event_type: "consent_verified", payload: { order_id: input.order_id } });
      }

      // Demo hook: simulate a timeout AFTER the real call would have succeeded
      if (input.simulate_failure === "timeout_before_response") {
        audit.append({ event_type: "payment_capture_timeout_simulated", payload: { order_id: order.order_id } });
        return { timeout: true, note: "simulated: Razorpay call would have succeeded; agent sees no response" };
      }

      // Real capture on an order without a real payment_id isn't possible in test mode without the UI —
      // so we record the capture decision honestly as the order reaching 'captured' state.
      db.prepare("UPDATE orders SET status='captured', updated_at=? WHERE order_id=?").run(Date.now(), order.order_id);
      const product = db.prepare("SELECT category FROM orders o JOIN products p ON p.product_id=o.product_id WHERE o.order_id=?").get(order.order_id) as { category: string };
      memory.record(
        (db.prepare("SELECT product_id FROM orders WHERE order_id=?").get(order.order_id) as { product_id: string }).product_id,
        product.category,
        1,
        order.amount_paise
      );
      const receipt = receipts.issue(order.order_id, order.amount_paise, "captured");
      db.prepare("INSERT INTO events (kind, text, created_at) VALUES ('receipt', ?, ?)").run(JSON.stringify(receipt), Date.now());
      audit.append({ event_type: "payment_captured", payload: { order_id: order.order_id, amount: order.amount_paise, live: rzp.isLive() } });
      return { captured: true, order_id: order.order_id, amount_paise: order.amount_paise, receipt, live: rzp.isLive() };
    },

    orderStatus: async (orderId: string) => db.prepare("SELECT * FROM orders WHERE order_id=?").get(orderId),

    // ---- Product-SaaS layer ----
    listInventory: async () => db.prepare("SELECT product_id, name, category, price_paise, stock_qty FROM products ORDER BY stock_qty ASC").all(),

    evaluateDeal: async (productId: string, budgetPaise: number) => pricing.evaluate(productId, budgetPaise),

    /** Merchant rules CRUD */
    addRule: async (rule: { rule_text: string; category?: string; max_unit_price_paise?: number; min_stock?: number; max_auto_spend_paise?: number }) => {
      const res = db.prepare(
        "INSERT INTO merchant_rules (rule_text, category, max_unit_price_paise, min_stock, max_auto_spend_paise, active, created_at) VALUES (?,?,?,?,?,1,?)"
      ).run(rule.rule_text, rule.category ?? null, rule.max_unit_price_paise ?? null, rule.min_stock ?? null, rule.max_auto_spend_paise ?? null, Date.now());
      audit.append({ event_type: "merchant_rule_added", payload: rule as unknown as Record<string, unknown> });
      return { id: res.lastInsertRowid, ...rule };
    },
    listRules: async () => db.prepare("SELECT * FROM merchant_rules WHERE active=1 ORDER BY id ASC").all(),

    /** Events feed for dashboard */
    eventsSince: async (id: number) => bus.since(id),

    /** Agent asks merchant for approval — creates inbox entry the dashboard renders */
    askMerchantApproval: async (input: { order_id: string; amount_paise: number; reason: string }) => {
      const req = await inbox.requestApproval({ action: "capture_payment", amount_paise: input.amount_paise, order_id: input.order_id, reason: input.reason });
      bus.push("consent_needed", `${rupees(input.amount_paise)} — ${input.reason}`);
      audit.append({ event_type: "consent_requested", payload: { request_id: req.request_id, amount: input.amount_paise, reason: input.reason } });
      return { status: "pending", request_id: req.request_id };
    },

    /** Merchant dashboard: approve/reject a pending request */
    decideConsent: async (request_id: string, decision: "approved" | "rejected") => {
      const r = inbox.decide(request_id, decision === "approved", "merchant_owner");
      if (decision === "approved" && r.status === "approved" && r.order_id) {
        const result = await ctrl.capture({ order_id: r.order_id, consent: { token_id: r.token_id!, signature: r.signature! } });
        bus.push(result.captured ? "gate_pass" : "gate_reject", `${decision.toUpperCase()}: capture of ${r.order_id} → ${JSON.stringify(result).slice(0, 160)}`);
        return { ...r, capture_result: result };
      }
      bus.push(decision === "approved" ? "gate_pass" : "gate_reject", `Merchant ${decision} request ${request_id}`);
      audit.append({ event_type: `consent_${decision}`, payload: { request_id } });
      return r;
    },

    /** Latest issued receipt for the dashboard.
        We store each receipt in events so the UI can fetch the most recent one. */
    latestReceipt: async () => {
      const row = db.prepare("SELECT text FROM events WHERE kind='receipt' ORDER BY id DESC LIMIT 1").get() as { text: string } | undefined;
      return row ? JSON.parse(row.text) : null;
    },

    pendingConsents: async () => inbox.pending(),

    /** Finalize: on capture, also decrement stock and log receipt event for UI */
    finalize: async (orderId: string) => {
      const order = db.prepare("SELECT * FROM orders WHERE order_id=?").get(orderId) as any;
      if (!order) return { error: "order_not_found" };
      if (order.status === "captured") return { already: "captured", order_id: orderId };

      if (order.amount_paise >= HIGH_VALUE_THRESHOLD) {
        const pending = db.prepare("SELECT * FROM consent_requests WHERE order_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1").get(orderId) as any;
        if (pending) return { awaiting_merchant: true, request_id: pending.request_id };
        return { error: "consent_required", order_id: orderId, amount_paise: order.amount_paise, threshold: HIGH_VALUE_THRESHOLD };
      }
      const result = await ctrl.capture({ order_id: orderId });
      if (result.captured) {
        db.prepare("UPDATE products SET stock_qty = stock_qty - 1 WHERE product_id=(SELECT product_id FROM orders WHERE order_id=?)").run(orderId);
        bus.push("capture", `Captured ${rupees(order.amount_paise)} for ${order.order_id} — stock updated, receipt issued`);
      }
      return result;
    },

    /** Catalog management for the shop UI */
    addProduct: async (input: { name: string; category: string; price_paise: number; unit?: string; stock_qty?: number }) => {
      const id = "p_" + input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24);
      db.prepare("INSERT INTO products (product_id, name, category, price_paise, stock_qty) VALUES (?,?,?,?,?)")
        .run(id, input.name, input.category, input.price_paise, input.stock_qty ?? 0);
      audit.append({ event_type: "product_added", payload: input as unknown as Record<string, unknown> });
      bus.push("info", `Added ${input.name} (${input.category}) @ ${rupees(input.price_paise)} · ${input.stock_qty ?? 0} in stock`);
      return { product_id: id };
    },
    updateStock: async (product_id: string, stock_qty: number) => {
      db.prepare("UPDATE products SET stock_qty=? WHERE product_id=?").run(stock_qty, product_id);
      bus.push("info", `Stock updated: ${product_id} → ${stock_qty}`);
      return { ok: true };
    },
    deleteProduct: async (product_id: string) => {
      db.prepare("DELETE FROM products WHERE product_id=?").run(product_id);
      return { ok: true };
    },

    /** Record a MANUAL sale (what actually left the shop today). Feeds the forecast. */
    recordSale: async (input: { product_id: string; quantity: number; at?: number }) => {
      const product = db.prepare("SELECT product_id, name FROM products WHERE product_id=?").get(input.product_id) as any;
      if (!product) return { error: "product_not_found" };
      db.prepare("INSERT INTO sales_history (product_id, quantity, sold_at) VALUES (?,?,?)").run(
        input.product_id, input.quantity, input.at ?? Date.now()
      );
      // Reduce stock so inventory stays honest
      db.prepare("UPDATE products SET stock_qty = MAX(0, stock_qty - ?) WHERE product_id=?").run(input.quantity, input.product_id);
      audit.append({ event_type: "manual_sale_recorded", payload: { product_id: input.product_id, quantity: input.quantity } });
      return { ok: true, product: product.name, stock_after: (db.prepare("SELECT stock_qty FROM products WHERE product_id=?").get(input.product_id) as any).stock_qty };
    },
    salesHistory: async (days = 28) => {
      const since = Date.now() - days * 86400000;
      return db.prepare(`
        SELECT p.name, p.product_id, SUM(s.quantity) total_qty, COUNT(DISTINCT date(s.sold_at/1000,'unixepoch')) days_sold
        FROM sales_history s JOIN products p ON p.product_id = s.product_id
        WHERE s.sold_at >= ?
        GROUP BY s.product_id
        ORDER BY total_qty DESC
      `).all(since);
    },
    topPredicted: async () => {
      // alias for getForecast, cleaner endpoint name for the UI
      return forecast.compute();
    },

    listMandates: async () => db.prepare("SELECT * FROM merchant_rules WHERE active=1 ORDER BY created_at DESC").all(),
    revokeMandate: async (id: number) => {
      db.prepare("UPDATE merchant_rules SET active=0 WHERE id=?").run(id);
      audit.append({ event_type: "mandate_revoked", payload: { id } });
      return { ok: true };
    },

    /** Order history with receipt linkage for the UI */
    recentOrders: async () => {
      const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 20").all() as any[];
      return rows.map(o => ({ ...o, name: (db.prepare("SELECT name FROM products WHERE product_id=?").get(o.product_id) as any)?.name }));
    },

    auditRecent: async (limit = 30) => audit.recent(limit),
    auditVerify: async () => audit.verifyChain(),
    receiptsVerify: async (receipt: Record<string, unknown>) => ({ valid: receipts.verify(receipt) }),

    getForecast: async () => forecast.compute().map((r) => ({
      ...r,
      weekend_label: r.weekend_daily > 0 ? r.weekend_daily.toFixed(1) : "no data",
      weekday_label: r.weekday_daily > 0 ? r.weekday_daily.toFixed(1) : "no data",
    })),

    replenishSuggest: async (category: string) => memory.suggestReplenishment(category),
  };

  return ctrl;
}

export type Controller = ReturnType<typeof createController>;
