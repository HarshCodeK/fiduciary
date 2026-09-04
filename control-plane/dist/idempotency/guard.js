"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdempotencyGuard = void 0;
const hash_1 = require("../lib/hash");
class IdempotencyGuard {
    db;
    constructor(db) {
        this.db = db;
    }
    deriveKey(action, orderIntent) {
        // Deterministic: same logical intent → same key, no matter how the LLM phrases it.
        return `idem:${action}:${orderIntent.product_id}:${orderIntent.budget_paise}`;
    }
    check(key, params) {
        const row = this.db
            .prepare("SELECT key, params_hash, status, params_json, response_json FROM idempotency_keys WHERE key = ?")
            .get(key);
        if (!row)
            return { action: "execute", key };
        const incomingHash = (0, hash_1.paramsHash)(params);
        if (row.params_hash !== incomingHash) {
            let cachedParams = {};
            try {
                cachedParams = JSON.parse(row.params_json ?? "{}");
            }
            catch { }
            return {
                action: "reject",
                key,
                rejection: {
                    reason: "idempotency_key_reused_with_different_params",
                    diff: (0, hash_1.diffParams)(cachedParams, params),
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
    begin(key, params) {
        this.db
            .prepare("INSERT INTO idempotency_keys (key, params_hash, status, params_json, response_json, created_at) VALUES (?, ?, 'pending', ?, NULL, ?) ON CONFLICT(key) DO UPDATE SET params_hash=excluded.params_hash, status='pending', params_json=excluded.params_json")
            .run(key, (0, hash_1.paramsHash)(params), JSON.stringify(params), Date.now());
    }
    complete(key, response) {
        this.db
            .prepare("UPDATE idempotency_keys SET status='completed', response_json=? WHERE key=?")
            .run(JSON.stringify(response), key);
    }
    fail(key) {
        this.db.prepare("UPDATE idempotency_keys SET status='failed' WHERE key=?").run(key);
    }
}
exports.IdempotencyGuard = IdempotencyGuard;
