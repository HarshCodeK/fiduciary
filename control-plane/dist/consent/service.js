"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsentService = void 0;
const crypto_1 = __importDefault(require("crypto"));
/**
 * CONSENT TOKEN SERVICE
 * The agent CANNOT mint tokens. Only a human clicking "Approve" on the consent UI
 * calls issue(). Tokens are HMAC-authenticated, TTL-bound, single-use, and bound to
 * the exact (action, amount, order_id) they authorize — an agent cannot stretch a
 * ₹500 token to justify a ₹5,000 capture.
 */
class ConsentService {
    db;
    secret;
    ttlMs;
    constructor(db, secret, ttlMs = 5 * 60 * 1000) {
        this.db = db;
        this.secret = secret;
        this.ttlMs = ttlMs;
        if (!secret)
            throw new Error("CONSENT_TOKEN_SECRET is required");
    }
    sign(payload) {
        return crypto_1.default.createHmac("sha256", this.secret).update(payload).digest("hex");
    }
    issue(input) {
        const tokenId = crypto_1.default.randomUUID();
        const now = Date.now();
        const body = `${input.action}|${input.amount_paise}|${input.merchant_id}|${input.order_id}|${now}`;
        const signature = this.sign(tokenId + "|" + body);
        this.db
            .prepare("INSERT INTO consent_tokens (token_id, action, amount_paise, merchant_id, order_id, issued_at, expires_at, used, signature) VALUES (?,?,?,?,?,?,?,0,?)")
            .run(tokenId, input.action, input.amount_paise, input.merchant_id, input.order_id, now, now + this.ttlMs, signature);
        return { token_id: tokenId, signature, expires_at: now + this.ttlMs };
    }
    verify(input) {
        const row = this.db
            .prepare("SELECT * FROM consent_tokens WHERE token_id=?")
            .get(input.token_id);
        if (!row)
            return { ok: false, reason: "token_not_found" };
        if (row.used)
            return { ok: false, reason: "token_already_used" };
        if (Date.now() > row.expires_at)
            return { ok: false, reason: "token_expired" };
        if (row.order_id !== input.order_id)
            return { ok: false, reason: "token_order_mismatch" };
        if (row.action !== input.action)
            return { ok: false, reason: "token_action_mismatch" };
        if (row.amount_paise !== input.amount_paise)
            return { ok: false, reason: "token_amount_mismatch" };
        const body = `${row.action}|${row.amount_paise}|${row.merchant_id}|${row.order_id}|${row.issued_at}`;
        const expected = this.sign(input.token_id + "|" + body);
        const a = Buffer.from(expected);
        const b = Buffer.from(input.signature);
        if (a.length !== b.length || !crypto_1.default.timingSafeEqual(a, b))
            return { ok: false, reason: "signature_invalid" };
        if (row.signature !== input.signature)
            return { ok: false, reason: "signature_mismatch_stored" };
        // single-use
        this.db.prepare("UPDATE consent_tokens SET used=1 WHERE token_id=?").run(input.token_id);
        return { ok: true };
    }
}
exports.ConsentService = ConsentService;
