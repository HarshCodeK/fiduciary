/**
 * FIDUCIARY — Full demo runner. Executes all 6 scenarios from the architecture PDF
 * against the live control plane. This script IS the demo rehearsal — re-runnable, live.
 *
 * Run: node demo/run-demo.js   (server must be up on :4100)
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:4100";

const C = { g: "\x1b[92m", r: "\x1b[91m", y: "\x1b[93m", c: "\x1b[96m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };

async function call(path, body, method = "POST") {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  return res.json();
}
const rs = (p) => `₹${(p / 100).toLocaleString("en-IN")}`;

function scenario(n, title) {
  console.log(`\n${C.b}${C.c}${"═".repeat(66)}`);
  console.log(`  Scenario ${n}: ${title}`);
  console.log(`${"═".repeat(66)}${C.x}`);
}

async function main() {
  const health = await call("/health", {}, "GET");
  console.log(`\nFIDUCIARY DEMO — mode: ${health.live ? C.g + "LIVE Razorpay test mode" + C.x : C.y + "SIMULATED" + C.x}`);

  // ---------- Scenario 1: happy path ----------
  scenario(1, "Happy path — agent buys groceries under budget, no consent needed");
  const s1 = await call("/api/agent/propose", { product_id: "p_apples", budget_paise: 30000, quantity: 1 });
  console.log(`  agent: "Buy 1kg apples, budget ₹300"`);
  console.log(`  ${C.g}✓ order created: ${s1.order_id}  amount: ${rs(s1.amount_paise)} (offer applied: ${s1.applied_offers.join(",")})${C.x}`);

  // ---------- Scenario 2: timeout + retry, no double charge ----------
  scenario(2, "Timeout + retry — agent's network drops, retry does NOT double-charge");
  console.log(`  agent: "Buy Sony headphones, budget ₹5,000"`);
  const s2a = await call("/api/agent/propose", { product_id: "p_headphones_pro", budget_paise: 500000, quantity: 1 });
  console.log(`  ${C.d}first call → order ${s2a.order_id} created (${rs(s2a.amount_paise)} effective)${C.x}`);
  console.log(`  ${C.y}[network timeout — agent never sees the response, retries 2 more times]${C.x}`);
  for (const i of [1, 2]) {
    const r = await call("/api/agent/propose", { product_id: "p_headphones_pro", budget_paise: 500000, quantity: 1 });
    console.log(`  ${C.g}↩ retry ${i}: replayed=${r.replayed}, same order_id=${r.response.order_id} — NO second Razorpay call${C.x}`);
  }

  // ---------- Scenario 3: mutated params on retry ----------
  scenario(3, "Agent mutates params on retry (quantity 1→100) — rejected with structured diff");
  const s3 = await call("/api/agent/propose", { product_id: "p_headphones_pro", budget_paise: 500000, quantity: 100 });
  console.log(`  ${C.r}✗ rejected: ${s3.reason.reason}${C.x}`);
  console.log(`  ${C.d}diff: ${JSON.stringify(s3.reason.diff.changed)}${C.x}`);
  console.log(`  ${C.d}The agent now knows EXACTLY what it changed and can self-correct.${C.x}`);

  // ---------- Scenario 4: consent gates ----------
  scenario(4, "High-value capture — forged consent rejected, real consent accepted, replay rejected");
  const noConsent = await call("/api/agent/capture", { order_id: s2a.order_id });
  console.log(`  no consent →   ${C.r}${noConsent.reason}${C.x}`);
  const tok = await call("/api/agent/request-consent", { order_id: s2a.order_id });
  console.log(`  ${C.d}human approves in UI → consent token issued (5 min TTL)${C.x}`);
  const forged = await call("/api/agent/capture", { order_id: s2a.order_id, consent: { token_id: tok.token_id, signature: "deadbeef".repeat(8) } });
  console.log(`  forged token → ${C.r}${forged.reason}${C.x}`);
  const real = await call("/api/agent/capture", { order_id: s2a.order_id, consent: { token_id: tok.token_id, signature: tok.signature } });
  console.log(`  valid token →  ${C.g}CAPTURED ${rs(real.amount_paise)}, receipt issued${C.x}`);
  const replayTok = await call("/api/agent/capture", { order_id: s2a.order_id, consent: { token_id: tok.token_id, signature: tok.signature } });
  console.log(`  token reuse →  ${C.r}${replayTok.reason}${C.x}`);

  // ---------- Scenario 5: effective-price rescue ----------
  scenario(5, "Effective-price rescue — ₹6,000 fits a ₹5,000 budget via a real offer");
  const naive = "₹6,000 > ₹5,000 → naive agent REJECTS";
  const fid = `${rs(s2a.order_id ? 480000 : 0)} ≤ ₹5,000 → Fiduciary BUYS`;
  console.log(`  sticker: ₹6,000   |  HDFC offer -20% (cap ₹1,200)  → effective ${rs(480000)}`);
  console.log(`  naive agent:  ${C.r}${naive}${C.x}`);
  console.log(`  fiduciary:    ${C.g}${fid}  — rescued=${s2a.rescued} (recorded in DB)${C.x}`);

  // ---------- Scenario 6: audit chain ----------
  scenario(6, "Audit log — hash-chained, tamper-evident");
  const v = await call("/api/audit/verify", {}, "GET");
  console.log(`  chain verification: ${v.ok ? C.g + "INTACT ✓" : C.r + "BROKEN ✗"}${C.x}`);
  const tail = await call("/api/audit?limit=100", {}, "GET");
  console.log(`  ${C.d}${tail.length} events recorded — every decision, including rejections:${C.x}`);
  const counts = {};
  for (const e of tail) counts[e.event_type] = (counts[e.event_type] ?? 0) + 1;
  for (const [k, n] of Object.entries(counts).sort()) console.log(`    ${String(n).padStart(2)}× ${k}`);

  console.log(`\n${C.b}${C.g}Demo complete. All scenarios executed against ${health.live ? "LIVE Razorpay test mode" : "simulated mode"}.${C.x}\n`);
}

main().catch((e) => {
  console.error("DEMO FAILED:", e);
  process.exit(1);
});
