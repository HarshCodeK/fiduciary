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
    "INSERT INTO products (product_id, name, category, price_paise, stock_qty, supplier, supplier_price_paise) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  // [id, name, category, retail_paise, stock, supplier, wholesale_paise]
  const products: Array<[string, string, string, number, number, string, number]> = [
    ["p_apples", "Apples — Shimla (per kg)", "groceries", 24000, 20, "freshmandi", 16000],
    ["p_bananas", "Bananas — Robusta (dozen)", "groceries", 4500, 40, "freshmandi", 3000],
    ["p_milk", "Milk — Amul Taaza (litre)", "dairy", 6600, 38, "metromart", 5000],
    ["p_bread", "Bread — White Sandwich (400g)", "bakery", 4500, 12, "metromart", 3000],
    ["p_eggs", "Eggs — Desi (tray of 30)", "dairy", 22500, 6, "freshmandi", 18000],
    ["p_atta", "Atta — Aashirvaad Shudh 5kg", "groceries", 23500, 14, "valuetraders", 18000],
    ["p_rice", "Rice — Basmati (5 kg)", "groceries", 69500, 9, "valuetraders", 52000],
    ["p_dal", "Dal — Arhar (1 kg)", "groceries", 14500, 18, "valuetraders", 11000],
    ["p_sugar", "Sugar — Refined (1 kg)", "groceries", 4800, 22, "valuetraders", 3600],
    ["p_tea", "Tea — Tata Gold 500g", "beverages", 28000, 7, "valuetraders", 18000],
    ["p_onions", "Onions — Nashik (per kg)", "groceries", 3500, 25, "freshmandi", 2200],
    ["p_potatoes", "Potatoes — Local (per kg)", "groceries", 2800, 30, "freshmandi", 1800],
    ["p_oil", "Sunflower Oil — Fortune 1L", "groceries", 15500, 11, "valuetraders", 11500],
    ["p_flour", "Maida — 1kg", "groceries", 5200, 15, "valuetraders", 3800],
    ["p_soap", "Soap — Lux 100g", "personal_care", 3800, 30, "metromart", 2600],
    ["p_toothpaste", "Toothpaste — Colgate Strong 150g", "personal_care", 9500, 8, "metromart", 7000],
    ["p_headphones_pro", "Sony WH-1000XM5 Wireless Headphones", "electronics", 600000, 3, "metromart", 480000],
    ["p_keyboards", "Keychron K2 Mechanical Keyboard", "electronics", 850000, 4, "metromart", 650000],
  ];
  const tx = db.transaction(() => products.forEach((p) => insert.run(...p)));
  tx();

  // Seed 28 days of sales history so the demand forecast has real signal
  const sales = db.prepare("INSERT INTO sales_history (product_id, quantity, sold_at) VALUES (?,?,?)");
  const now = Date.now(), DAY = 86400000;
  const salesTx = db.transaction(() => {
    for (let d = 0; d < 28; d++) {
      const t = now - d * DAY;
      const dow = new Date(t).getDay();
      const wknd = (dow === 0 || dow === 6);
      sales.run("p_bread", wknd ? 3.8 : 1.6, t);
      sales.run("p_milk", wknd ? 2.2 : 1.5, t);
      sales.run("p_apples", wknd ? 2.6 : 1.2, t);
      sales.run("p_bananas", wknd ? 2.0 : 1.1, t);
      if (d % 2 === 0) sales.run("p_rice", 0.6, t);
      if (wknd) sales.run("p_eggs", 2.4, t);
      sales.run("p_tea", 0.6, t);
      if (wknd) sales.run("p_oil", 0.8, t);
      sales.run("p_sugar", 0.5, t);
      sales.run("p_onions", 0.9, t);
      sales.run("p_potatoes", 1.1, t);
    }
  });
  salesTx();

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
