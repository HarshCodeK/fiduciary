"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256 = sha256;
exports.stableStringify = stableStringify;
exports.paramsHash = paramsHash;
exports.diffParams = diffParams;
const crypto_1 = require("crypto");
function sha256(s) {
    return (0, crypto_1.createHash)("sha256").update(s, "utf-8").digest("hex");
}
function stableStringify(obj) {
    if (obj === null || typeof obj !== "object")
        return JSON.stringify(obj);
    if (Array.isArray(obj))
        return "[" + obj.map(stableStringify).join(",") + "]";
    const o = obj;
    const keys = Object.keys(o).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}
function paramsHash(params) {
    return sha256(stableStringify(params));
}
function diffParams(cached, incoming) {
    const keys = Array.from(new Set([...Object.keys(cached), ...Object.keys(incoming)])).sort();
    const changed = [];
    const onlyC = [];
    const onlyI = [];
    for (const k of keys) {
        if (!(k in incoming))
            onlyC.push(k);
        else if (!(k in cached))
            onlyI.push(k);
        else if (stableStringify(cached[k]) !== stableStringify(incoming[k]))
            changed.push({ field: k, cached: cached[k], incoming: incoming[k] });
    }
    return { changed, only_in_cached: onlyC, only_in_incoming: onlyI };
}
