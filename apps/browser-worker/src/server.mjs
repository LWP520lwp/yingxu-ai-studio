import { loadConfig } from "./config.mjs";
import { BrowserPool } from "./browser-pool.mjs";
import { createWorkerServer } from "./http-server.mjs";

const config = loadConfig();
if (process.platform !== "win32") process.umask(0o077);
const pool = new BrowserPool(config);
const server = createWorkerServer(config, pool);
server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"));
server.listen(config.port, config.host, () => process.stdout.write(`Browser worker listening on ${config.host}:${config.port}\n`));

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  server.close();
  void pool.closeAll().finally(() => process.exit(0));
});
