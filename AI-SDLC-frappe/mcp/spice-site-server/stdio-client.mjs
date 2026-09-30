// Minimal MCP stdio client used by test-client.mjs and live-check.mjs: spawns server.mjs, writes one
// JSON-RPC message per line, and matches replies to requests by id. Any non-JSON line on stdout fails the run.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "server.mjs");

export function startServer(env = {}) {
  const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
  const pending = new Map();
  const lines = [];
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      lines.push(line);
      const msg = JSON.parse(line); // throws if the server writes anything but protocol messages to stdout
      const key = JSON.stringify(msg.id);
      pending.get(key)?.(msg);
      pending.delete(key);
    }
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const exited = new Promise((res) => child.on("exit", (code) => res(code)));
  return {
    lines,
    exited,
    get stderr() {
      return stderr;
    },
    send(msg) {
      child.stdin.write((typeof msg === "string" ? msg : JSON.stringify(msg)) + "\n");
    },
    request(id, method, params, timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout waiting for id ${id} (${method})`)), timeoutMs);
        pending.set(JSON.stringify(id), (m) => {
          clearTimeout(t);
          resolve(m);
        });
        this.send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
      });
    },
    raw(line, id) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout on raw line")), 5000);
        pending.set(JSON.stringify(id), (m) => {
          clearTimeout(t);
          resolve(m);
        });
        this.send(line);
      });
    },
    close() {
      child.stdin.end();
    },
  };
}

export const payload = (res) => JSON.parse(res.result.content[0].text);

export async function initialize(s, id = 0) {
  const r = await s.request(id, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "spice-site-client", version: "1.0.0" } });
  s.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  return r;
}
