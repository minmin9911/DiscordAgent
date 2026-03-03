import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import pino from "pino";

function dateStamp(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

class DailyHistoryStream {
  private currentStamp: string | null = null;
  private currentStream: WriteStream | null = null;

  constructor(private readonly logDir: string) {}

  write(chunk: string): void {
    const stamp = dateStamp(new Date());
    if (stamp !== this.currentStamp || !this.currentStream) {
      this.rotate(stamp);
    }
    this.currentStream?.write(chunk);
  }

  private rotate(stamp: string): void {
    if (this.currentStream) {
      this.currentStream.end();
      this.currentStream = null;
    }
    const path = join(this.logDir, `history-${stamp}.log`);
    this.currentStream = createWriteStream(path, {
      flags: "a",
      encoding: "utf8",
    });
    this.currentStamp = stamp;
  }
}

export function createAppLogger(level: string): pino.Logger {
  const logDir = "logs";
  mkdirSync(logDir, { recursive: true });

  const lastRunPath = join(logDir, "last_run.log");

  // 毎回起動時に last_run.log をリセット（デバッグ用使い捨て）。
  writeFileSync(lastRunPath, "", { encoding: "utf8", flag: "w" });

  const streams = [
    { stream: process.stdout },
    { stream: pino.destination({ dest: lastRunPath, sync: false }) },
    { stream: new DailyHistoryStream(logDir) },
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
