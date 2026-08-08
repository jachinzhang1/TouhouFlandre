import fs from "node:fs";
import net from "node:net";

const DEFAULT_DATABASE_URL =
  "postgres://touhouflandre:touhouflandre-dev@127.0.0.1:5433/touhouflandre";

function readEnvFile(path) {
  if (!fs.existsSync(path)) return {};

  const result = {};
  const lines = fs.readFileSync(path, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }

  return result;
}

function waitForPort(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    function tryConnect() {
      const socket = net.createConnection({ host, port });
      socket.setTimeout(1000);

      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });

      function retry(error) {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(error);
          return;
        }
        setTimeout(tryConnect, 1000);
      }

      socket.once("error", retry);
      socket.once("timeout", () => retry(new Error("connection timed out")));
    }

    tryConnect();
  });
}

const fileEnv = readEnvFile(".env");
const databaseUrl = process.env.DATABASE_URL_PG || fileEnv.DATABASE_URL_PG || DEFAULT_DATABASE_URL;
const parsed = new URL(databaseUrl);
const host = parsed.hostname || "127.0.0.1";
const port = Number(parsed.port || 5432);

process.stdout.write(`waiting for Postgres at ${host}:${port} ...\n`);

try {
  await waitForPort(host, port, 30_000);
  process.stdout.write(`Postgres is reachable at ${host}:${port}\n`);
} catch (error) {
  process.stderr.write(
    `Postgres did not become reachable at ${host}:${port}: ${error.message}\n`,
  );
  process.exit(1);
}
