import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DB_PATH = path.join(PROJECT_ROOT, "fiduciary.db");
const SCHEMA_PATH = path.resolve(PROJECT_ROOT, "src", "db", "schema.sql");

export function openDb(dbPath: string = DB_PATH): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  return db;
}

export function migrate(db: Database.Database): void {
  const sql = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(sql);
}

export function seedCatalog(db: Database.Database): void {
  const count = (db.prepare("SELECT COUNT(*) as n FROM products").get() as { n: number }).n;
  if (count > 0) return;
  const insert = db.prepare(
    "INSERT INTO products (product_id, name, category, price_paise) VALUES (?, ?, ?, ?)"
  );
  const products: Array<[string, string, string, number]> = [
    ["p_headphones_pro", "Sony WH-1000XM5 Wireless Headphones", "electronics", 600000], // ₹6000 — the demo piece
    ["p_headphones_basic", "boAt Rockerz 450", "electronics", 149900],
    ["p_mouse", "Logitech M331 Silent Mouse", "electronics", 79900],
    ["p_keyboard", "Keychron K2 Mechanical Keyboard", "electronics", 850000],
    ["p_apples", "Fresh Shimla Apples (1kg)", "groceries", 24000],
    ["p_rice", "India Gate Basmati Rice 5kg", "groceries", 69500],
    ["p_milk", "Amul Taaza Milk 1L", "groceries", 6600],
  ];
  const tx = db.transaction(() => products.forEach((p) => insert.run(...p)));
  tx();

  const insertOffer = db.prepare(
    "INSERT INTO offers (offer_id, product_id, category, type, value, max_discount_paise, active) VALUES (?, ?, ?, ?, ?, ?, 1)"
  );
  const offers: Array<[string, string | null, string | null, string, number, number | null]> = [
    ["offer_hdfc20", "p_headphones_pro", null, "percent", 20, 120000], // 20% off, max ₹1200
    ["offer_grocery10", null, "groceries", "percent", 10, null],
  ];
  const tx2 = db.transaction(() => offers.forEach((o) => insertOffer.run(...o)));
  tx2();
}
