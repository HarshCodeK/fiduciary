import Database from "better-sqlite3";
import { sha256 } from "../lib/hash";

export interface AuditEvent {
  event_type: string;
  actor?: string;
  payload: Record<string, unknown>;
}

export class AuditLog {
  constructor(private db: Database.Database) {}

  append(ev: AuditEvent): void {
    const last = this.db
      .prepare("SELECT this_hash FROM audit_log ORDER BY seq DESC LIMIT 1")
      .get() as { this_hash: string } | undefined;
    const prevHash = last?.this_hash ?? "GENESIS";
    const payloadJson = JSON.stringify({ type: ev.event_type, actor: ev.actor ?? "agent", ...ev.payload });

    const insert = this.db.prepare(
      "INSERT INTO audit_log (event_type, actor, payload_json, prev_hash, this_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const seqRow = { payload: payloadJson };
    const tx = this.db.transaction(() => {
      const res = insert.run(ev.event_type, ev.actor ?? "agent", payloadJson, prevHash, "PENDING", Date.now());
      const seq = res.lastInsertRowid as number;
      const thisHash = sha256(prevHash + payloadJson + seq);
      this.db.prepare("UPDATE audit_log SET this_hash=? WHERE seq=?").run(thisHash, seq);
    });
    tx();
    void seqRow;
  }

  verifyChain(): { ok: boolean; brokenAt?: number; reason?: string } {
    const rows = this.db
      .prepare("SELECT seq, payload_json, prev_hash, this_hash FROM audit_log ORDER BY seq ASC")
      .all() as Array<{ seq: number; payload_json: string; prev_hash: string; this_hash: string }>;

    let prev = "GENESIS";
    for (const r of rows) {
      if (r.prev_hash !== prev) return { ok: false, brokenAt: r.seq, reason: "prev_hash mismatch" };
      const computed = sha256(prev + r.payload_json + r.seq);
      if (computed !== r.this_hash) return { ok: false, brokenAt: r.seq, reason: "payload tampered" };
      prev = r.this_hash;
    }
    return { ok: true };
  }

  recent(limit = 50): unknown[] {
    return this.db
      .prepare("SELECT seq, event_type, actor, payload_json, created_at FROM audit_log ORDER BY seq DESC LIMIT ?")
      .all(limit);
  }
}
