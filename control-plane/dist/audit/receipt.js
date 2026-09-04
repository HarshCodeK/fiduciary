"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReceiptService = void 0;
const crypto_1 = __importDefault(require("crypto"));
/**
 * RECEIPT SERVICE — signed, offline-verifiable per-transaction receipt.
 * HMAC signature over {order_id, amount_paise, status, issued_at}. Verification needs
 * only the receipt JSON + the public verification endpoint; no DB access required.
 */
class ReceiptService {
    secret;
    constructor(secret) {
        this.secret = secret;
        if (!secret)
            throw new Error("receipt secret required");
    }
    issue(orderId, amountPaise, status) {
        const payload = { order_id: orderId, amount_paise: amountPaise, status, issued_at: Date.now() };
        const body = JSON.stringify(payload);
        const signature = crypto_1.default.createHmac("sha256", this.secret).update(body).digest("hex");
        return { ...payload, signature };
    }
    verify(receipt) {
        const { signature, ...payload } = receipt;
        const body = JSON.stringify(payload);
        const expected = crypto_1.default.createHmac("sha256", this.secret).update(body).digest("hex");
        const a = Buffer.from(expected);
        const b = Buffer.from(String(signature ?? ""));
        return a.length === b.length && crypto_1.default.timingSafeEqual(a, b);
    }
}
exports.ReceiptService = ReceiptService;
