const Database = require("better-sqlite3");

const db = new Database("data/app.db");
const rows = db
  .prepare(
    `SELECT id, session_id, result_status, error_code, created_at, started_at, ended_at, command_text_masked
     FROM executions
     ORDER BY datetime(created_at) DESC
     LIMIT 120`,
  )
  .all();

console.log(JSON.stringify(rows, null, 2));
