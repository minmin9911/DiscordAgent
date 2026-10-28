import { open } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";

export const JSONL_MAX_LINE_BYTES = 64 * 1024 * 1024;

export interface JsonlReadSummary {
  latestLineNo: number;
  skippedLineCount: number;
  firstSkippedLineNo: number | null;
  lastSkippedLineNo: number | null;
}

export class JsonlLineTooLargeError extends Error {
  readonly code = "ERR_CODEX_JSONL_LINE_TOO_LARGE";
  constructor(readonly lineNo: number, readonly maxBytes: number) {
    super(`Codex JSONL line ${lineNo} exceeds ${maxBytes} bytes`);
  }
}

/** One reader per file; callers serialize reads and discard their state after errors. */
export class IncrementalJsonlReader {
  private offset = 0;
  private lineNo = 0;
  private fragments: Buffer[] = [];
  private fragmentBytes = 0;
  private skippingOversizedLine = false;
  private identity: string | null = null;
  private mtimeMs = 0;
  private checkpoint = Buffer.alloc(0);
  lastReadBytes = 0;

  constructor(
    readonly path: string,
    private readonly chunkBytes = 1024 * 1024,
    private readonly maxLineBytes = JSONL_MAX_LINE_BYTES,
  ) {}

  async read(
    onLine: (line: string, lineNo: number) => void,
    onReset: () => void,
    onSkippedLine?: (lineNo: number) => void,
  ): Promise<JsonlReadSummary> {
    let skippedLineCount = 0;
    let firstSkippedLineNo: number | null = null;
    let lastSkippedLineNo: number | null = null;
    const file = await open(this.path, "r");
    try {
      const stat = await file.stat();
      const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
      let changed = this.identity !== null && (this.identity !== identity
        || stat.size < this.offset || (stat.size === this.offset && stat.mtimeMs !== this.mtimeMs));
      if (!changed && this.checkpoint.length) {
        const checkpoint = Buffer.alloc(this.checkpoint.length);
        const read = await file.read(checkpoint, 0, checkpoint.length, this.offset - checkpoint.length);
        changed = read.bytesRead !== checkpoint.length || !checkpoint.equals(this.checkpoint);
      }
      if (changed) {
        this.offset = 0;
        this.lineNo = 0;
        this.fragments = [];
        this.fragmentBytes = 0;
        this.skippingOversizedLine = false;
        onReset();
      }
      this.identity = identity;
      this.lastReadBytes = 0;
      // Snapshot the size so an actively writing process cannot prolong this read forever.
      while (this.offset < stat.size) {
        const buffer = Buffer.allocUnsafe(Math.min(this.chunkBytes, stat.size - this.offset));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, this.offset);
        if (!bytesRead) break;
        let start = 0;
        while (start < bytesRead) {
          if (this.skippingOversizedLine) {
            const newline = buffer.indexOf(10, start);
            if (newline < 0 || newline >= bytesRead) break;
            this.skippingOversizedLine = false;
            this.lineNo += 1;
            skippedLineCount += 1;
            firstSkippedLineNo ??= this.lineNo;
            lastSkippedLineNo = this.lineNo;
            onSkippedLine?.(this.lineNo);
            start = newline + 1;
            continue;
          }
          const newline = buffer.indexOf(10, start);
          const end = newline < 0 || newline >= bytesRead ? bytesRead : newline;
          const length = end - start;
          if (this.fragmentBytes + length > this.maxLineBytes) {
            // Large image/tool payloads are not sync candidates; skip through their newline.
            this.fragments = [];
            this.fragmentBytes = 0;
            this.skippingOversizedLine = true;
            continue;
          }
          if (length) {
            this.fragments.push(Buffer.from(buffer.subarray(start, end)));
            this.fragmentBytes += length;
          }
          if (end === bytesRead) break;
          const line = Buffer.concat(this.fragments, this.fragmentBytes).toString("utf8");
          this.fragments = [];
          this.fragmentBytes = 0;
          this.lineNo += 1;
          onLine(line.endsWith("\r") ? line.slice(0, -1) : line, this.lineNo);
          start = end + 1;
        }
        this.offset += bytesRead;
        this.lastReadBytes += bytesRead;
        await setImmediate();
      }
      this.checkpoint = Buffer.alloc(Math.min(64, this.offset));
      if (this.checkpoint.length) {
        await file.read(this.checkpoint, 0, this.checkpoint.length, this.offset - this.checkpoint.length);
      }
      this.mtimeMs = stat.mtimeMs;
      return {
        latestLineNo: this.lineNo,
        skippedLineCount,
        firstSkippedLineNo,
        lastSkippedLineNo,
      };
    } finally {
      await file.close();
    }
  }
}
