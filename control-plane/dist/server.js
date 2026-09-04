"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
const index_1 = require("./db/index");
const controller_1 = require("./api/controller");
dotenv_1.default.config({ path: path_1.default.join(__dirname, "..", "..", ".env") });
const DB_PATH = path_1.default.join(__dirname, "..", "..", "fiduciary.db");
if (!fs_1.default.existsSync(path_1.default.dirname(DB_PATH)))
    fs_1.default.mkdirSync(path_1.default.dirname(DB_PATH), { recursive: true });
const db = (0, index_1.openDb)(DB_PATH);
(0, index_1.migrate)(db);
(0, index_1.seedCatalog)(db);
const app = (0, fastify_1.default)({ logger: true });
const c = (0, controller_1.createController)(db);
app.get("/health", async () => ({ ok: true, live: process.env.RAZORPAY_KEY_ID ? true : false }));
// Agent-facing endpoints (the ONLY thing the agent can call)
app.post("/api/agent/search", async (req) => c.searchCatalog(req.body.query));
app.post("/api/agent/propose", async (req) => c.proposePurchase(req.body));
app.post("/api/agent/request-consent", async (req) => c.requestConsent(req.body));
app.post("/api/agent/capture", async (req) => c.capture(req.body));
app.get("/api/agent/order/:id", async (req) => c.orderStatus(req.params.id));
// Transparency endpoints
app.get("/api/audit", async (req) => c.auditRecent(Number(req.query.limit ?? 30)));
app.get("/api/audit/verify", async () => c.auditVerify());
app.post("/api/receipts/verify", async (req) => c.receiptsVerify(req.body));
app.get("/api/replenish/:category", async (req) => c.replenishSuggest(req.params.category));
const port = Number(process.env.PORT ?? 4100);
app.listen({ port, host: "127.0.0.1" }).then(() => {
    console.log(`\n✅ Fiduciary control plane listening on http://127.0.0.1:${port}`);
    console.log(`   live mode: ${process.env.RAZORPAY_KEY_ID ? "ON (Razorpay test mode)" : "OFF (simulated)"}\n`);
});
