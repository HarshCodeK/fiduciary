import Database from "better-sqlite3";
import { IdempotencyGuard } from "../idempotency/guard";
import { ConsentService } from "../consent/service";
import { PricingEngine } from "../pricing/effective-price";
import { PurchaseMemory } from "../memory/purchase-memory";
import { AuditLog } from "../audit/log";
import { ReceiptService } from "../audit/receipt";
import * as rzp from "../razorpay/client";

const HIGH_VALUE_THRESHOLD = Number(process.env.HIGH_VALUE_THRESHOLD_PAISE ?? 200000);

export function createController(db: Database.Database) {
  const idem = new IdempotencyGuard(db);
  const consent = new ConsentService(db, process.env.CONSENT_TOKEN_SECRET ?? "");
  const pricing = new PricingEngine(db);
  const memory = new PurchaseMemory(db);
  const audit = new AuditLog(db);
  const receipts = new ReceiptService(process.env.CONSENT_TOKEN_SECRET ?? "");

  return {
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
      audit.append({ event_type: "payment_captured", payload: { order_id: order.order_id, amount: order.amount_paise, live: rzp.isLive() } });
      return { captured: true, order_id: order.order_id, amount_paise: order.amount_paise, receipt, live: rzp.isLive() };
    },

    orderStatus: async (orderId: string) => db.prepare("SELECT * FROM orders WHERE order_id=?").get(orderId),

    auditRecent: async (limit = 30) => audit.recent(limit),
    auditVerify: async () => audit.verifyChain(),
    receiptsVerify: async (receipt: Record<string, unknown>) => ({ valid: receipts.verify(receipt) }),

    replenishSuggest: async (category: string) => memory.suggestReplenishment(category),
  };
}

export type Controller = ReturnType<typeof createController>;
