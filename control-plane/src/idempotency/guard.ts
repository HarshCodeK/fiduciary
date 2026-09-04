import Database from "better-sqlite3";
import { paramsHash, diffParams } from "../lib/hash";

/**
 * IDEMPOTENCY GUARD — the fix for the documented "agent retry duplicate charge" failure class.
 *
 * The idempotency key is DERIVED from (action, product_id, budget) — the agent does NOT choose it freely.
 * The key is stable: a retry of the same logical intent re-derives the SAME key even if the LLM rephrases.
 * A params_hash captures the ACTUAL parameters sent, so if the LLM mutates params on retry,
 * we reject with a structured diff instead of executing a second charge.
 */

export interface GuardResult {
  action: "execute" | "replay" | "reject";
  cachedResponse?: unknown;
  rejection?: { reason: string; diff?: unknown };
  key: string;
}

export class IdempotencyGuard {
  constructor(private db: Database.Database) {}

  deriveKey(action: string, orderIntent: { product_id: string; budget_paise: number }): string {
    // Deterministic: same logical intent → same key, no matter how the LLM phrases it.
    return `idem:${action}:${orderIntent.product_id}:${orderIntent.budget_paise}`;
  }

  check(key: string, params: Record<string, unknown>): GuardResult {
    const row = this.db
      .prepare("SELECT key, params_hash, status, params_json, response_json FROM idempotency_keys WHERE key = ?")
      .get(key) as { params_hash: string; status: string; params_json: string | null; response_json: string | null } | undefined;

    if (!row) return { action: "execute", key };

    const incomingHash = paramsHash(params);
    if (row.params_hash !== incomingHash) {
      let cachedParams: Record<string, unknown> = {};
      try { cachedParams = JSON.parse(row.params_json ?? "{}"); } catch {}
      return {
        action: "reject",
        key,
        rejection: {
          reason: "idempotency_key_reused_with_different_params",
          diff: diffParams(cachedParams, params),
        },
      };
    }

    if (row.status === "completed" && row.response_json) {
      return { action: "replay", key, cachedResponse: JSON.parse(row.response_json) };
    }
    if (row.status === "pending") {
      return { action: "reject", key, rejection: { reason: "request_in_progress" } };
    }
    return { action: "execute", key }; // previous attempt failed — allow retry
  }

  begin(key: string, params: Record<string, unknown>): void {
    this.db
      .prepare(
        "INSERT INTO idempotency_keys (key, params_hash, status, params_json, response_json, created_at) VALUES (?, ?, 'pending', ?, NULL, ?) ON CONFLICT(key) DO UPDATE SET params_hash=excluded.params_hash, status='pending', params_json=excluded.params_json"
      )
      .run(key, paramsHash(params), JSON.stringify(params), Date.now());
  }

  complete(key: string, response: Record<string, unknown>): void {
    this.db
      .prepare("UPDATE idempotency_keys SET status='completed', response_json=? WHERE key=?")
      .run(JSON.stringify(response), key);
  }

  fail(key: string): void {
    this.db.prepare("UPDATE idempotency_keys SET status='failed' WHERE key=?").run(key);
  }
}
