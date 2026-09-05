
const http = require("http");
const body = JSON.stringify({ message: process.argv[2] || "Check my stock. If apples are below 20 kg, order more. Never pay more than 30000 paise per order without asking me first." });
const req = http.request({ hostname: "127.0.0.1", port: 4100, path: "/api/agent/message", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (res) => {
  let b = ""; res.on("data", (c) => b += c); res.on("end", () => { console.log("AGENT:", b); });
});
req.on("error", (e) => console.error("ERR", e.message));
req.write(body); req.end();
