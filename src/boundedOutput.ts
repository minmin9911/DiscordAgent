/** Keep only a diagnostic tail, independently of the lifetime of an execution. */
export class BoundedTextTail {
  private value = "";
  private truncated = false;
  constructor(readonly maxChars = 64 * 1024) {
    if (!Number.isSafeInteger(maxChars) || maxChars < 1) throw new Error("Invalid tail limit");
  }
  append(text: string): void {
    this.truncated ||= this.value.length + text.length > this.maxChars;
    this.value = (this.value + text.slice(-this.maxChars)).slice(-this.maxChars);
  }
  get text(): string { return (this.truncated ? "[Earlier diagnostic output omitted]\n" : "") + this.value; }
}

/** Decode complete UTF-8 lines without ever retaining an unbounded partial line. */
export class BoundedLineDecoder {
  private fragments: Buffer[] = [];
  private bytes = 0;
  private skipping = false;
  constructor(
    private readonly onLine: (line: string) => void,
    private readonly onOversized: () => void,
    readonly maxBytes = 8 * 1024 * 1024,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid line limit");
  }
  get bufferedBytes(): number { return this.bytes; }
  write(chunk: Buffer): void {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline;
      if (!this.skipping) {
        if (this.bytes + end - start > this.maxBytes) {
          this.fragments = [];
          this.bytes = 0;
          this.skipping = true;
          this.onOversized();
        } else if (end > start) {
          this.fragments.push(Buffer.from(chunk.subarray(start, end)));
          this.bytes += end - start;
          if (this.fragments.length >= 256) this.fragments = [Buffer.concat(this.fragments, this.bytes)];
        }
      }
      if (newline < 0) return;
      if (!this.skipping) this.flush();
      this.skipping = false;
      start = newline + 1;
    }
  }
  end(): void {
    if (!this.skipping && this.bytes) this.flush();
    this.fragments = [];
    this.bytes = 0;
    this.skipping = false;
  }
  private flush(): void {
    const text = Buffer.concat(this.fragments, this.bytes).toString("utf8").replace(/\r$/, "");
    this.fragments = [];
    this.bytes = 0;
    this.onLine(text);
  }
}
