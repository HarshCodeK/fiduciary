import { createHash } from "crypto";

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf-8").digest("hex");
}

export function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const o = obj as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

export function paramsHash(params: Record<string, unknown>): string {
  return sha256(stableStringify(params));
}

export function diffParams(
  cached: Record<string, unknown>,
  incoming: Record<string, unknown>
): { changed: Array<{ field: string; cached: unknown; incoming: unknown }>; only_in_cached: string[]; only_in_incoming: string[] } {
  const keys = Array.from(new Set([...Object.keys(cached), ...Object.keys(incoming)])).sort();
  const changed: Array<{ field: string; cached: unknown; incoming: unknown }> = [];
  const onlyC: string[] = [];
  const onlyI: string[] = [];
  for (const k of keys) {
    if (!(k in incoming)) onlyC.push(k);
    else if (!(k in cached)) onlyI.push(k);
    else if (stableStringify(cached[k]) !== stableStringify(incoming[k]))
      changed.push({ field: k, cached: cached[k], incoming: incoming[k] });
  }
  return { changed, only_in_cached: onlyC, only_in_incoming: onlyI };
}
