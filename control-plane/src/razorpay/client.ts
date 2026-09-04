import Database from "better-sqlite3";

/**
 * RAZORPAY CLIENT — the ONLY module allowed to talk to Razorpay.
 * Agent never imports this. Control plane calls it after gates pass.
 * Test mode only (rzp_test_ keys). Simulated fallback when keys absent, clearly flagged.
 */

export interface RzpOrderResponse {
  id: string;
  status: string;
  amount: number;
  currency: string;
  simulated?: boolean;
  request_id?: string;
}

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const LIVE = Boolean(KEY_ID && KEY_SECRET);

import https from "https";

function post(pathname: string, body: Record<string, unknown>): Promise<RzpOrderResponse> {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "api.razorpay.com",
        path: pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`Razorpay HTTP ${res.statusCode}: ${buf.slice(0, 300)}`));
            return;
          }
          resolve(JSON.parse(buf));
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

export async function createOrder(amountPaise: number, receipt: string): Promise<RzpOrderResponse> {
  if (!LIVE) {
    return {
      id: "order_SIMULATED_" + Math.random().toString(16).slice(2, 14),
      status: "created",
      amount: amountPaise,
      currency: "INR",
      simulated: true,
    };
  }
  return post("/v1/orders", { amount: amountPaise, currency: "INR", receipt });
}

export async function capturePayment(paymentId: string, amountPaise: number): Promise<RzpOrderResponse> {
  if (!LIVE) {
    return {
      id: paymentId,
      status: "captured",
      amount: amountPaise,
      currency: "INR",
      simulated: true,
    };
  }
  return post(`/v1/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency: "INR" });
}

export function isLive(): boolean {
  return LIVE;
}
