import Groq from "groq-sdk";
import { EventBus } from "../events/bus";
import type { Controller } from "../api/controller";

const PROJECT_ROOT = require("path").resolve(__dirname, "..", "..", "..");
require("dotenv").config({ path: require("path").join(PROJECT_ROOT, ".env") });

const _groqKey = process.env.GROQ_API_KEY;
if (!_groqKey) throw new Error("GROQ_API_KEY missing — check .env at " + PROJECT_ROOT);

/**
 * THE AGENT. A real LLM (Groq) that can ONLY act through the control plane.
 * It has no Razorpay credentials anywhere — all it can do is call these tools.
 * Every money decision it proposes is judged by the control plane gates.
 */

const groq = new Groq({});

const TOOLS: any[] = [
  {
    type: "function",
    function: {
      name: "demand_forecast",
      description: "Get predicted demand per product for the next few days based on actual sales history. Returns rows sorted by urgency — the 'bread is going to run out before Sunday' signal. Use this before deciding to restock.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "add_mandate",
      description: "Register a standing rule the merchant grants you. Call this whenever the merchant states a new policy in the form: subject/category, restock trigger (min stock), per-unit price cap, auto-approve spend cap. Returns the registered mandate.",
      parameters: {
        type: "object",
        properties: {
          rule_text: { type: "string", description: "The rule in the merchant's own words, verbatim" },
          category: { type: "string" },
          max_unit_price_paise: { type: "integer" },
          min_stock: { type: "number" },
          max_auto_spend_paise: { type: "integer" },
        },
        required: ["rule_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_inventory",
      description: "List all products with current stock levels. Call this first to know what's low.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_catalog",
      description: "Search products by name query (e.g. 'headphones'). Returns matching products with price and stock.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "evaluate_deal",
      description: "Check if a product fits a budget after applying offers/coupons. Returns sticker price, effective price, whether it's within budget, and whether it was rescued by an offer.",
      parameters: {
        type: "object",
        properties: { product_id: { type: "string" }, budget_paise: { type: "integer" } },
        required: ["product_id", "budget_paise"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "place_order",
      description: "Place a purchase order for a product. Amount charged = effective price × quantity. Idempotent — retrying the same purchase is safe. If the total is above the merchant's auto-approve threshold, this returns consent_needed and you must call request_merchant_approval.",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string" },
          quantity: { type: "integer" },
          budget_paise: { type: "integer", description: "Max the merchant allows for unit price" },
        },
        required: ["product_id", "quantity", "budget_paise"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_merchant_approval",
      description: "Ask the human merchant to approve a spend. Provide a short, honest reason. Blocks (returns pending) — the merchant will approve or reject in their dashboard.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string" },
          amount_paise: { type: "integer" },
          reason: { type: "string" },
        },
        required: ["order_id", "amount_paise", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finalize_order",
      description: "Finalize a created order after any needed consent. Records to purchase memory and decrements stock.",
      parameters: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] },
    },
  },
];

const SYSTEM = `You are Fiduciary, an autonomous purchasing agent for a small shop owner in India.

Your job: keep the shop stocked according to the merchant's rules, and never spend money unsafely.

Rules of behavior:
1. If the merchant gave you a standing rule, call add_mandate first so it's visible and revocable.
2. Then call demand_forecast to predict what will run out next — proactive beats reactive. Mention the data when you decide.
3. Check inventory to confirm current stock.
4. Before buying, call evaluate_deal for the effective price (sticker lies; offers can rescue a deal).
5. To buy, call place_order. If the answer is consent_needed, call request_merchant_approval with an honest reason, then STOP. Never fake approval.
6. Never retry a purchase with changed parameters — the control plane rejects and explains the diff; accept it.
7. Sound like a smart ops assistant: quantities, ₹, explicit statuses. If nothing is due, say so and stop — correct inaction is a win.`;

export class AgentLoop {
  constructor(private controller: Controller, private bus: EventBus) {}

  async run(userMessage: string): Promise<string> {
    this.bus.push("agent_thought", `Merchant: "${userMessage}"`);
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: userMessage },
    ];

    for (let round = 0; round < 8; round++) {
      const res = await groq.chat.completions.create({
        model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens: 800,
      });
      const msg = res.choices[0]?.message;
      if (!msg) break;
      messages.push(msg);

      if (!msg.tool_calls?.length) {
        const text = msg.content ?? "(no reply)";
        this.bus.push("agent_thought", `Agent: ${text}`);
        return text;
      }

      for (const tc of msg.tool_calls) {
        const name = tc.function.name;
        const args = JSON.parse(tc.function.arguments || "{}");
        this.bus.push("agent_thought", `→ ${name}(${JSON.stringify(args)})`);
        const out = await this.callTool(name, args);
        this.bus.push("gate_pass", out instanceof Object ? JSON.stringify(out).slice(0, 300) : String(out));
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
      }
    }
    const final = "I've taken several steps — check the dashboard for details.";
    this.bus.push("agent_thought", `Agent: ${final}`);
    return final;
  }

  private async callTool(name: string, args: any): Promise<any> {
    const c = this.controller;
    switch (name) {
      case "check_inventory":
        return c.listInventory();
      case "search_catalog":
        return c.searchCatalog(args.query ?? "");
      case "evaluate_deal":
        return c.evaluateDeal(args.product_id, args.budget_paise);
      case "place_order":
        return await c.proposePurchase({ product_id: args.product_id, budget_paise: args.budget_paise, quantity: args.quantity });
      case "request_merchant_approval":
        return await c.askMerchantApproval({ order_id: args.order_id, amount_paise: args.amount_paise, reason: args.reason });
      case "finalize_order":
        return await c.finalize(args.order_id);
      case "add_mandate":
        return await (c as any).addRule({ rule_text: args.rule_text, category: args.category, max_unit_price_paise: args.max_unit_price_paise, min_stock: args.min_stock, max_auto_spend_paise: args.max_auto_spend_paise });
      case "demand_forecast":
        return await (c as any).getForecast();
      default:
        return { error: `unknown tool ${name}` };
    }
  }
}
