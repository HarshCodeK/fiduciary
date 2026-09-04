import crypto from "crypto";

/**
 * RECEIPT SERVICE — signed, offline-verifiable per-transaction receipt.
 * HMAC signature over {order_id, amount_paise, status, issued_at}. Verification needs
 * only the receipt JSON + the public verification endpoint; no DB access required.
 */

export class ReceiptService {
  constructor(private secret: string) {
    if (!secret) throw new Error("receipt secret required");
  }

  issue(orderId: string, amountPaise: number, status: string): Record<string, unknown> {
    const payload = { order_id: orderId, amount_paise: amountPaise, status, issued_at: Date.now() };
    const body = JSON.stringify(payload);
    const signature = crypto.createHmac("sha256", this.secret).update(body).digest("hex");
    return { ...payload, signature };
  }

  verify(receipt: Record<string, unknown>): boolean {
    const { signature, ...payload } = receipt as { signature?: string } & Record<string, unknown>;
    const body = JSON.stringify(payload);
    const expected = crypto.createHmac("sha256", this.secret).update(body).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature ?? ""));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}
