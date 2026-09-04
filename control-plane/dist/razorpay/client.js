"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrder = createOrder;
exports.capturePayment = capturePayment;
exports.isLive = isLive;
const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const LIVE = Boolean(KEY_ID && KEY_SECRET);
const https_1 = __importDefault(require("https"));
function post(pathname, body) {
    return new Promise((resolve, reject) => {
        const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
        const data = JSON.stringify(body);
        const req = https_1.default.request({
            hostname: "api.razorpay.com",
            path: pathname,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${auth}`,
                "Content-Length": Buffer.byteLength(data),
            },
        }, (res) => {
            let buf = "";
            res.on("data", (c) => (buf += c));
            res.on("end", () => {
                if (!res.statusCode || res.statusCode >= 400) {
                    reject(new Error(`Razorpay HTTP ${res.statusCode}: ${buf.slice(0, 300)}`));
                    return;
                }
                resolve(JSON.parse(buf));
            });
        });
        req.on("error", reject);
        req.write(data);
        req.end();
    });
}
async function createOrder(amountPaise, receipt) {
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
async function capturePayment(paymentId, amountPaise) {
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
function isLive() {
    return LIVE;
}
