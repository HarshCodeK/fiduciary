import Fastify from "fastify";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { migrate, seedCatalog, openDb } from "./db/index";
import { createController } from "./api/controller";

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

const DB_PATH = path.join(__dirname, "..", "..", "fiduciary.db");
if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = openDb(DB_PATH);
migrate(db);
seedCatalog(db);

const app = Fastify({ logger: true });
const c = createController(db);

app.get("/health", async () => ({ ok: true, live: process.env.RAZORPAY_KEY_ID ? true : false }));

// Agent-facing endpoints (the ONLY thing the agent can call)
app.post("/api/agent/search", async (req) => c.searchCatalog((req.body as { query: string }).query));
app.post("/api/agent/propose", async (req) => c.proposePurchase(req.body as { product_id: string; budget_paise: number; quantity?: number }));
app.post("/api/agent/request-consent", async (req) => c.requestConsent(req.body as { order_id: string }));
app.post("/api/agent/capture", async (req) => c.capture(req.body as { order_id: string; consent?: { token_id: string; signature: string }; simulate_failure?: "timeout_before_response" }));
app.get("/api/agent/order/:id", async (req) => c.orderStatus((req.params as { id: string }).id));

// Transparency endpoints
app.get("/api/audit", async (req) => c.auditRecent(Number((req.query as { limit?: string }).limit ?? 30)));
app.get("/api/audit/verify", async () => c.auditVerify());
app.post("/api/receipts/verify", async (req) => c.receiptsVerify(req.body as Record<string, unknown>));
app.get("/api/replenish/:category", async (req) => c.replenishSuggest((req.params as { category: string }).category));

const port = Number(process.env.PORT ?? 4100);
app.listen({ port, host: "127.0.0.1" }).then(() => {
  console.log(`\n✅ Fiduciary control plane listening on http://127.0.0.1:${port}`);
  console.log(`   live mode: ${process.env.RAZORPAY_KEY_ID ? "ON (Razorpay test mode)" : "OFF (simulated)"}\n`);
});
