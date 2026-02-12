const Database = require("better-sqlite3");

const db = new Database("data/app.db");
const now = new Date().toISOString();
const timeoutSec = 3660;

const result = db
  .prepare(
    `UPDATE executions
     SET result_status='timeout', error_code='ERR_STALE_RUNNING_TIMEOUT', ended_at=?
     WHERE result_status='running'
       AND datetime(started_at) < datetime('now', printf('-%d seconds', ?))`,
  )
  .run(now, timeoutSec);

console.log(JSON.stringify({ updated: result.changes }, null, 2));
