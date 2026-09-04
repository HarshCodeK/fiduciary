"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.openDb = openDb;
exports.migrate = migrate;
exports.seedCatalog = seedCatalog;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const PROJECT_ROOT = path_1.default.resolve(__dirname, "..", "..");
const DB_PATH = path_1.default.join(PROJECT_ROOT, "fiduciary.db");
const SCHEMA_PATH = path_1.default.resolve(PROJECT_ROOT, "src", "db", "schema.sql");
function openDb(dbPath = DB_PATH) {
    const db = new better_sqlite3_1.default(dbPath);
    db.pragma("journal_mode = WAL");
    return db;
}
function migrate(db) {
    const sql = fs_1.default.readFileSync(SCHEMA_PATH, "utf-8");
    db.exec(sql);
}
function seedCatalog(db) {
    const count = db.prepare("SELECT COUNT(*) as n FROM products").get().n;
    if (count > 0)
        return;
    const insert = db.prepare("INSERT INTO products (product_id, name, category, price_paise) VALUES (?, ?, ?, ?)");
    const products = [
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
    const insertOffer = db.prepare("INSERT INTO offers (offer_id, product_id, category, type, value, max_discount_paise, active) VALUES (?, ?, ?, ?, ?, ?, 1)");
    const offers = [
        ["offer_hdfc20", "p_headphones_pro", null, "percent", 20, 120000], // 20% off, max ₹1200
        ["offer_grocery10", null, "groceries", "percent", 10, null],
    ];
    const tx2 = db.transaction(() => offers.forEach((o) => insertOffer.run(...o)));
    tx2();
}
