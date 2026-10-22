import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase, runMigrations } from "./database.ts";

const db = openDatabase();
runMigrations(db);
const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? "127.0.0.1";
const app = createApp(db);
const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`Game API listening on http://${info.address}:${info.port}`);
});

function close(): void {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
