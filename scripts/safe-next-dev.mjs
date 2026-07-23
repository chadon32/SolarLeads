import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const DEFAULT_PORT = Number(process.env.PORT || 3000);

function getPort(args) {
  const portIndex = args.findIndex((arg) => arg === "--port" || arg === "-p");
  if (portIndex >= 0 && args[portIndex + 1]) {
    return Number(args[portIndex + 1]);
  }

  const inlinePort = args.find((arg) => arg.startsWith("--port="));
  if (inlinePort) {
    return Number(inlinePort.split("=")[1]);
  }

  return DEFAULT_PORT;
}

function hasArg(args, name) {
  return args.includes(name) || args.some((arg) => arg.startsWith(`${name}=`));
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, "127.0.0.1");
  });
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: npm run dev -- [--port 3001] [--turbo|--webpack]");
  console.log("Starts one guarded Next.js dev server and refuses to stack another on the same port.");
  process.exit(0);
}

const port = getPort(args);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${port}`);
  process.exit(1);
}

const available = await isPortAvailable(port);

if (!available) {
  console.log(`Port ${port} is already in use. No new Next.js dev server was started.`);
  console.log("Stop the existing server first, or start this project on another port.");
  process.exit(0);
}

const nextArgs = ["node_modules/next/dist/bin/next", "dev"];

if (!hasArg(args, "--turbo") && !hasArg(args, "--webpack")) {
  nextArgs.push("--webpack");
}

nextArgs.push(...args);

console.log(`Starting guarded Next.js dev server on port ${port}.`);
console.log(nextArgs.includes("--webpack") ? "Bundler: webpack" : "Bundler: Next.js default");

const hasInteractiveOutput = Boolean(process.stdout.isTTY && process.stderr.isTTY);
const logDir = process.env.SOLARTELLIGENCE_DEV_LOG_DIR || path.join(process.cwd(), ".dev-logs");
fs.mkdirSync(logDir, { recursive: true });
const logPrefix = path.join(logDir, `solartelligence-${port}`);
const stdio = hasInteractiveOutput
  ? "inherit"
  : [
      "ignore",
      fs.openSync(`${logPrefix}.out.log`, "a"),
      fs.openSync(`${logPrefix}.err.log`, "a"),
    ];

const child = spawn(process.execPath, nextArgs, {
  stdio,
  env: {
    ...process.env,
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || "1",
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
