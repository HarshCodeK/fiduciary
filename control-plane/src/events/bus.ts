import Database from "better-sqlite3";

/** Live event feed for the dashboard — every agent thought & gate decision, streamable. */
export class EventBus {
  constructor(private db: Database.Database) {}

  push(kind: string, text: string): void {
    this.db.prepare("INSERT INTO events (kind, text, created_at) VALUES (?,?,?)").run(kind, text, Date.now());
  }

  since(id: number): Array<{ id: number; kind: string; text: string; created_at: number }> {
    return this.db.prepare("SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT 200").all(id) as any;
  }

  latest(n = 50): Array<{ id: number; kind: string; text: string; created_at: number }> {
    return this.db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(n) as any;
  }
}
