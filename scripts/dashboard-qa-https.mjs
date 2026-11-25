// Loopback-only runner for WebKit QA: production Secure cookies need HTTPS.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import next from "next";

if (process.env.SUPABASE_URL !== "http://127.0.0.1:3283" || process.env.DISABLE_EMAIL_SENDING !== "true") {
  throw new Error("This HTTPS runner requires the isolated dashboard fixture.");
}
const gitOpenSSL = join(process.env.ProgramFiles || "C:/Program Files", "Git", "usr", "bin", "openssl.exe");
const openssl = process.platform === "win32" && existsSync(gitOpenSSL) ? gitOpenSSL : "openssl";
const dir = mkdtempSync(join(tmpdir(), "solar-qa-tls-"));
const keyPath = join(dir, "key.pem");
let credentials;
try {
  const cert = execFileSync(openssl, [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", keyPath,
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  credentials = { cert, key: readFileSync(keyPath) };
} finally {
  if (existsSync(keyPath)) unlinkSync(keyPath);
  rmdirSync(dir);
}
const app = next({ dev: false, hostname: "localhost", port: 3183 });
await app.prepare();
createServer(credentials, app.getRequestHandler()).listen(3183, "127.0.0.1");
