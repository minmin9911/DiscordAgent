#!/usr/bin/env node
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

function parseArgs(argv) {
  const result = { db: "", triggerId: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k || !v) continue;
    if (k === "--db") {
      result.db = v;
      i += 1;
      continue;
    }
    if (k === "--trigger-id") {
      result.triggerId = v;
      i += 1;
    }
  }
  return result;
}

const args = parseArgs(process.argv);
if (!args.db || !args.triggerId) {
  console.error("usage: node trigger-fire.mjs --db <sqlite_path> --trigger-id <id>");
  process.exit(2);
}

const db = new Database(args.db);
try {
  const row = db.prepare("SELECT id, status FROM triggers WHERE id = ?").get(args.triggerId);
  if (!row || row.status !== "enabled") {
    process.exit(0);
  }
  db.prepare(
    "INSERT INTO trigger_fires (id, trigger_id, fired_at, status, processed_at, error_message) VALUES (?, ?, ?, 'pending', NULL, NULL)",
  ).run(randomUUID(), args.triggerId, new Date().toISOString());
} finally {
  db.close();
}
