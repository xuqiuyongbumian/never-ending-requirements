import { openDatabase, runMigrations } from "./database.ts";

const db = openDatabase();
try {
  const applied = runMigrations(db);
  console.log(applied.length ? `Applied migrations: ${applied.join(", ")}` : "Database is up to date.");
} finally {
  db.close();
}
