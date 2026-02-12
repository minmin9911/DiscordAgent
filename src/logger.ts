import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";

function dateStamp(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function createAppLogger(level: string): pino.Logger {
  const logDir = "logs";
  mkdirSync(logDir, { recursive: true });

  const lastRunPath = join(logDir, "last_run.log");
  const historyPath = join(logDir, `history-${dateStamp()}.log`);

  // 毎回起動時に last_run.log をリセット（デバッグ用使い捨て）。
  writeFileSync(lastRunPath, "", { encoding: "utf8", flag: "w" });

  const streams = [
    { stream: process.stdout },
    { stream: pino.destination({ dest: lastRunPath, sync: false }) },
    { stream: pino.destination({ dest: historyPath, sync: false }) },
  ];

  return pino(
    {
      level,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams),
  );
}
