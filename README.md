# fiduciary

> **A trust layer for agentic commerce.**
> An AI buyer agent that searches a catalog and pays on Razorpay — but every money action passes through a control plane the agent cannot bypass. Idempotent, consent-gated, hash-chained audit, signed receipts.

![typescript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript&logoColor=white)
![fastify](https://img.shields.io/badge/Fastify-5+-000000?logo=fastify&logoColor=white)
![razorpay](https://img.shields.io/badge/Razorpay-test--mode-07263D?logo=razorpay&logoColor=white)
![license](https://img.shields.io/badge/license-MIT-lightgrey)
![tier](https://img.shields.io/badge/tier-A-E3B341)

---

## The thesis

> **The model is untrusted. The control plane is trusted.**
> The agent proposes; the plane disposes.

Agentic commerce is being built to let agents transact. The unsolved half is the control plane around those transactions — bounds, consent, idempotency, independent verification.

---

## Architecture

```
LLM agent (proposes purchases, NO Razorpay credentials)
        │  /api/agent/* only
        ▼
┌──────────────────── CONTROL PLANE ────────────────────┐
│                                                        │
│  1. Effective-price engine   sticker → real cost       │
│  2. Idempotency guard        key from intent, diff    │
│  3. Consent service          HMAC, single-use, TTL    │
│  4. Audit log                hash-chained, verifyable │
│  5. Receipts                 signed, offline-verifiable│
│                                                        │
└────────────────────────┬───────────────────────────────┘
                         ▼
           razorpay/client.ts — ONLY module that talks to Razorpay
```

---

## The 5 control plane components

### 1. Effective-price engine

Resolves offers to compute the real price. A ₹6,000 product with 20% HDFC offer = ₹4,800 effective. An agent with ₹5,000 budget would naively reject it; this engine rescues the deal.

```
sticker_paise: 600000
effective_paise: 480000  (after HDFC 20% offer)
within_budget: true      (budget was 500000)
rescued: true            (sticker > budget but effective <= budget)
```

### 2. Idempotency guard

The idempotency key is **derived deterministically** from `(action, product_id, budget)` — the agent cannot choose or change it.

| Scenario | Result |
|----------|--------|
| Same intent, retry | **Replay** — cached response, no second Razorpay call |
| Same key, mutated params | **Reject** — structured diff (`quantity: 1 → 100`) so agent self-corrects |
| New intent | **Execute** — fresh transaction |

### 3. Consent service

The agent **cannot** mint tokens. Only a human clicking "Approve" calls `issue()`.

- HMAC-signed (SHA-256, timing-safe compare)
- TTL-bound (5 min default)
- Single-use (marked used on verify)
- Amount-bound (₹500 token can't authorize ₹5,000 capture)

### 4. Audit log

Append-only, hash-chained SQLite. Every entry contains `prev_hash` and `this_hash = SHA256(prev_hash + payload_json + seq)`.

`verifyChain()` recomputes every hash on demand. Any tampering breaks the chain at the exact sequence number.

### 5. Receipts

HMAC-signed per-transaction receipt: `{order_id, amount_paise, status, issued_at, signature}`. Verification needs only the receipt JSON + the public endpoint — no DB access required.

---

## The 6 demo scenarios

| # | Scenario | What it proves |
|---|----------|----------------|
| 1 | Happy-path purchase | Search → price → order created on live Razorpay |
| 2 | Network timeout → agent retries twice | Same logical intent replays from cache; **no second Razorpay call** |
| 3 | Agent mutates quantity on retry | Rejected with structured diff so agent self-corrects |
| 4 | High-value capture without consent / forged token / token replay | All rejected; only fresh human-issued token allows capture |
| 5 | ₹6,000 product vs ₹5,000 budget | Effective-price engine rescues the deal |
| 6 | Audit verification | Chain verified live; every pass AND rejection recorded |

```bash
# Run all 6 scenarios
cd control-plane && npm install && npm run build
node -r dotenv/config dist/server.js          # terminal 1
node demo/run-demo.js                          # terminal 2
```

---

## Quickstart

```bash
cd control-plane
npm install
cp ../.env.example ../.env   # fill RAZORPAY_KEY_ID/SECRET (test mode)
npm run build
node -r dotenv/config dist/server.js
# server on http://localhost:4100
```

Open `frontend/index.html` for the transparency panel with live audit trail and "Verify chain" button.

---

## What this is NOT

- Test-mode Razorpay only (no live payments)
- Single-node SQLite (no horizontal scaling)
- Consent "UI" is an API call in this build (not a real page)
- Offer table is a deterministic fixture (not a live bank feed)

---

## Built at

**Razorpay AI Buildathon — Track 01: AI Growth & Agentic Commerce**

---

## License

MIT
