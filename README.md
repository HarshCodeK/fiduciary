# Fiduciary

**A trust layer for agentic commerce on Razorpay: bounded, consent-gated, idempotent, and verifiably receipted.**

An AI buyer agent that searches a catalog, decides what to buy, and pays on Razorpay test-mode APIs — but **every money action passes through a control plane the agent cannot bypass**. The agent never touches Razorpay credentials; it can only call gate-enforced internal endpoints.

Razorpay AI Buildathon — Track 01 (AI Growth & Agentic Commerce). Track bar: *"every money action explainable, bounded and gated… audit trail and one failure handled gracefully."* This project is that bar, as a product.

## Why this exists

Agentic-commerce infrastructure is being built to let agents transact; the unsolved half is the control plane around those transactions — bounds, consent, idempotency, independent verification. Our thesis: **the model is untrusted; the control plane is trusted.** The agent proposes; the plane disposes. A documented failure mode this design defends against: agent-level retry of a timed-out tool call creating duplicate payment intent unless idempotency is enforced above the tool layer.

## Architecture

```
LLM agent (proposes purchases, no Razorpay credentials)
        │  /api/agent/* only
        ▼
CONTROL PLANE (the product)
  1. Effective-price engine   sticker → real cost after offers
  2. Idempotency guard        key derived from intent, params_hash + diff on violation
  3. Consent service          HMAC-authenticated, single-use, TTL, amount-bound
  4. Audit log                append-only, hash-chained, verifyChain() on demand
  5. Receipts                 signed, offline-verifiable per transaction
        ▼
razorpay/client.ts — the ONLY module allowed to talk to Razorpay
```

## What to run

```bash
cd control-plane
npm install
cp ../.env.example ../.env   # fill RAZORPAY_KEY_ID/SECRET (test mode) + CONSENT_TOKEN_SECRET
npm run build
node -r dotenv/config dist/server.js   # control plane on :4100
```

Then, in a second terminal, the full live demo (all 6 judging scenarios):

```bash
node demo/run-demo.js
```

Customer transparency panel: open `frontend/index.html` in a browser while the demo runs — orders + audit trail update live, and the "Verify chain" button recomputes every hash on demand.

## The six demo scenarios

| # | Scenario | What it proves |
|---|----------|----------------|
| 1 | Happy-path purchase | Search → price → order created on live Razorpay |
| 2 | Network timeout → agent retries twice | Same logical intent replays from cache; **no second Razorpay call** |
| 3 | Agent mutates quantity on retry | Rejected with structured diff (`quantity: 1 → 100`) so the agent can self-correct |
| 4 | High-value capture without consent / forged token / token replay | All rejected; only a fresh human-issued token allows capture |
| 5 | ₹6,000 product vs ₹5,000 budget | Effective-price engine resolves the HDFC 20% offer → ₹4,800 → **purchased (rescued=true)** |
| 6 | Audit verification | Chain verified live; every pass *and* rejection is recorded |

## Revenue story (why Razorpay should care)

- **Recovered GMV:** scenario 5 is a sale a sticker-price agent demonstrably loses. Modeled assumption: if ~8% of agent-attempted purchases die at a budget check and effective-price rescues 15% of those, that's ~1.2 recovered transactions per 100 agent attempts — each one real volume on Razorpay rails.
- **Bounded replenishment:** purchase memory proposes re-orders of repeat categories — but always back through the same consent gates. Recurring volume without silent spending.
- **Enterprise trust substrate:** the same control plane can sit between any agent interface (including Razorpay's own MCP server) and payment execution, giving merchants deterministic controls and independently verifiable transaction history.

## Honest limits

Test-mode only. Single-node SQLite. Consent "UI" is an API call in this build. Offer table is a deterministic fixture, not a live bank-offer feed. Every simulated response carries a `simulated` flag — live and simulated never look identical on screen.
