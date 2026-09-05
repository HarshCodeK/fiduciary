import Database from "better-sqlite3";
import crypto from "crypto";
import { ConsentService } from "../consent/service";

export interface ConsentRequest {
  request_id: string;
  status: "pending" | "approved" | "rejected";
  action: string;
  amount_paise: number;
  order_id?: string;
  reason: string;
  token_id?: string;
  signature?: string;
  created_at: number;
  decided_at?: number;
}

export class ConsentInbox {
  constructor(private db: Database.Database, private consent: ConsentService) {}

  /** Agent side: request merchant approval. Returns the refreshed request after waiting. */
  async requestApproval(input: { action: string; amount_paise: number; order_id?: string; reason: string }): Promise<ConsentRequest> {
    const requestId = crypto.randomUUID();
    this.db.prepare(
      "INSERT INTO consent_requests (request_id,status,action,amount_paise,order_id,reason,created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(requestId, "pending", input.action, input.amount_paise, input.order_id ?? null, input.reason, Date.now());
    return this.get(requestId);
  }

  get(requestId: string): ConsentRequest {
    return this.db.prepare("SELECT * FROM consent_requests WHERE request_id=?").get(requestId) as ConsentRequest;
  }

  pending(): ConsentRequest[] {
    return this.db.prepare("SELECT * FROM consent_requests WHERE status='pending' ORDER BY created_at ASC").all() as ConsentRequest[];
  }

  /** Merchant side: approve/reject. On approve, mints the actual consent token. */
  decide(requestId: string, approved: boolean, merchantId: string): ConsentRequest {
    const r = this.get(requestId);
    if (!r) throw new Error("request_not_found");
    if (r.status !== "pending") return r;
    if (approved) {
      const tok = this.consent.issue({ action: r.action, amount_paise: r.amount_paise, merchant_id: merchantId, order_id: r.order_id ?? "" });
      this.db.prepare(
        "UPDATE consent_requests SET status='approved', token_id=?, signature=?, decided_at=? WHERE request_id=?"
      ).run(tok.token_id, tok.signature, Date.now(), requestId);
    } else {
      this.db.prepare("UPDATE consent_requests SET status='rejected', decided_at=? WHERE request_id=?").run(Date.now(), requestId);
    }
    return this.get(requestId);
  }
}
