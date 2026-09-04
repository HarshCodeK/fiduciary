"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLog = void 0;
const hash_1 = require("../lib/hash");
class AuditLog {
    db;
    constructor(db) {
        this.db = db;
    }
    append(ev) {
        const last = this.db
            .prepare("SELECT this_hash FROM audit_log ORDER BY seq DESC LIMIT 1")
            .get();
        const prevHash = last?.this_hash ?? "GENESIS";
        const payloadJson = JSON.stringify({ type: ev.event_type, actor: ev.actor ?? "agent", ...ev.payload });
        const insert = this.db.prepare("INSERT INTO audit_log (event_type, actor, payload_json, prev_hash, this_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)");
        const seqRow = { payload: payloadJson };
        const tx = this.db.transaction(() => {
            const res = insert.run(ev.event_type, ev.actor ?? "agent", payloadJson, prevHash, "PENDING", Date.now());
            const seq = res.lastInsertRowid;
            const thisHash = (0, hash_1.sha256)(prevHash + payloadJson + seq);
            this.db.prepare("UPDATE audit_log SET this_hash=? WHERE seq=?").run(thisHash, seq);
        });
        tx();
        void seqRow;
    }
    verifyChain() {
        const rows = this.db
            .prepare("SELECT seq, payload_json, prev_hash, this_hash FROM audit_log ORDER BY seq ASC")
            .all();
        let prev = "GENESIS";
        for (const r of rows) {
            if (r.prev_hash !== prev)
                return { ok: false, brokenAt: r.seq, reason: "prev_hash mismatch" };
            const computed = (0, hash_1.sha256)(prev + r.payload_json + r.seq);
            if (computed !== r.this_hash)
                return { ok: false, brokenAt: r.seq, reason: "payload tampered" };
            prev = r.this_hash;
        }
        return { ok: true };
    }
    recent(limit = 50) {
        return this.db
            .prepare("SELECT seq, event_type, actor, payload_json, created_at FROM audit_log ORDER BY seq DESC LIMIT ?")
            .all(limit);
    }
}
exports.AuditLog = AuditLog;
