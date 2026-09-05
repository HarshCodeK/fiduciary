import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { migrate, seedCatalog, openDb } from "./db/index";
import { createController } from "./api/controller";
import { AgentLoop } from "./agent/loop";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

const DB_PATH = path.join(PROJECT_ROOT, "fiduciary.db");
if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = openDb(DB_PATH);
migrate(db);
seedCatalog(db);

import { EventBus } from "./events/bus";

const bus = new EventBus(db);
const app = Fastify({ logger: false });
const c = createController(db);
const agent = new AgentLoop(c, bus);

app.register(fastifyStatic, { root: path.join(PROJECT_ROOT, "control-plane", "src", "public"), prefix: "/" });

app.get("/health", async () => ({ ok: true, live: !!process.env.RAZORPAY_KEY_ID }));

// Agent-facing
app.post("/api/agent/message", async (req) => ({ reply: await agent.run((req.body as { message: string }).message) }));
app.post("/api/agent/search", async (req) => c.searchCatalog((req.body as { query: string }).query));
app.post("/api/agent/propose", async (req) => c.proposePurchase(req.body as { product_id: string; budget_paise: number; quantity?: number }));
app.post("/api/agent/request-consent", async (req) => c.requestConsent(req.body as { order_id: string }));
app.post("/api/agent/capture", async (req) => c.capture(req.body as any));
app.get("/api/agent/order/:id", async (req) => c.orderStatus((req.params as { id: string }).id));

// Merchant dashboard
app.get("/api/inventory", async () => c.listInventory());
app.post("/api/rules", async (req) => c.addRule(req.body as any));
app.get("/api/rules", async () => c.listRules());
app.get("/api/mandates", async () => c.listMandates());
app.post("/api/mandates/revoke", async (req) => c.revokeMandate((req.body as any).id));
app.get("/api/orders", async () => c.recentOrders());
app.get("/api/events", async (req) => c.eventsSince(Number((req.query as any).since ?? 0)));
app.get("/api/consents/pending", async () => c.pendingConsents());
app.post("/api/consents/decide", async (req) => c.decideConsent((req.body as any).request_id, (req.body as any).decision));
app.get("/api/stats", async () => {
  const res = db.prepare("SELECT COUNT(*) n, SUM(amount_paise) saved FROM orders WHERE rescued=1").get() as any;
  const captured = db.prepare("SELECT COUNT(*) n FROM orders WHERE status='captured'").get() as any;
  const rejected = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE event_type IN ('purchase_rejected','consent_rejected','idempotency_violation')").get() as any;
  return { rescued: res.n ?? 0, rescued_saved_paise: res.saved ?? 0, captured: captured.n ?? 0, rejected: rejected.n ?? 0 };
});

// Transparency
app.get("/api/audit", async (req) => c.auditRecent(Number((req.query as any).limit ?? 30)));
app.get("/api/audit/verify", async () => c.auditVerify());
app.post("/api/receipts/verify", async (req) => c.receiptsVerify(req.body as Record<string, unknown>));
app.get("/api/receipts/latest", async () => c.latestReceipt());
app.get("/api/replenish/:category", async (req) => c.replenishSuggest((req.params as any).category));

// Demo helper: deliberately tamper one audit row, then verify — returns the break point
app.post("/api/demo/tamper", async () => {
  const row = db.prepare("SELECT seq FROM audit_log ORDER BY seq ASC LIMIT 1 OFFSET 3").get() as { seq: number } | undefined;
  if (!row) return { ok: false, reason: "not enough events yet" };
  // Real tampering: rewrite history — change an amount inside a recorded event WITHOUT recomputing the chain.
  db.prepare("UPDATE audit_log SET payload_json = replace(payload_json, '\"amount\":', '\"amount\":9') WHERE seq=?").run(row.seq);
  const verify = await c.auditVerify() as any;
  return { tampered_seq: row.seq, ...verify };
});

const port = Number(process.env.PORT ?? 4100);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`\n✅ Fiduciary on http://localhost:${port}  — open this page.`);
  console.log(`   mode: ${process.env.RAZORPAY_KEY_ID ? "LIVE Razorpay test" : "simulated"} | agent: ${process.env.GROQ_API_KEY ? "Groq live" : "scripted"}\n`);
});
