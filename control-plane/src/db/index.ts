import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const DB_PATH = path.join(PROJECT_ROOT, "fiduciary.db");
const SCHEMA_PATH = path.resolve(PROJECT_ROOT, "control-plane", "src", "db", "schema.sql");

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
    "INSERT INTO products (product_id, name, category, price_paise, stock_qty) VALUES (?, ?, ?, ?, ?)"
  );
const products: Array<[string, string, string, number, number]> = [
    ["p_apples", "Apples — Shimla (per kg)", "groceries", 24000, 20],
    ["p_bananas", "Bananas — Robusta (dozen)", "groceries", 4500, 40],
    ["p_milk", "Milk — Amul Taaza (litre)", "dairy", 6600, 38],
    ["p_bread", "Bread — White Sandwich (400g)", "bakery", 4500, 12],
    ["p_eggs", "Eggs — Desi (tray of 30)", "dairy", 22500, 6],
    ["p_atta", "Atta — Aashirvaad Shudh 5kg", "groceries", 23500, 14],
    ["p_rice", "Rice — Basmati (5 kg)", "groceries", 69500, 9],
    ["p_dal", "Dal — Arhar (1 kg)", "groceries", 14500, 18],
    ["p_sugar", "Sugar — Refined (1 kg)", "groceries", 4800, 22],
    ["p_tea", "Tea — Tata Gold 500g", "beverages", 28000, 7],
    ["p_onions", "Onions — Nashik (per kg)", "groceries", 3500, 25],
    ["p_potatoes", "Potatoes — Local (per kg)", "groceries", 2800, 30],
    ["p_oil", "Sunflower Oil — Fortune 1L", "groceries", 15500, 11],
    ["p_flour", "Maida — 1kg", "groceries", 5200, 15],
    ["p_soap", "Soap — Lux 100g", "personal_care", 3800, 30],
    ["p_toothpaste", "Toothpaste — Colgate Strong 150g", "personal_care", 9500, 8],
    ["p_headphones_pro", "Sony WH-1000XM5 Wireless Headphones", "electronics", 600000, 3],
    ["p_keyboards", "Keychron K2 Mechanical Keyboard", "electronics", 850000, 4],
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
