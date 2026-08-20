export interface ProgressMessageSendOptions {
  nonce: string;
  enforceNonce: true;
}

export interface ProgressMessageControllerOptions {
  executionId: string;
  send: (text: string, options: ProgressMessageSendOptions) => Promise<{ id: string }>;
  edit: (messageId: string, text: string) => Promise<void>;
  onError: (details: {
    operation: "progress_send" | "progress_edit" | "final_send" | "final_edit";
    messageId: string | null;
    error: unknown;
  }) => void;
}

export function getDiscordErrorCode(error: unknown): number | string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" || typeof code === "string" ? code : null;
}

export function isUnknownDiscordMessage(error: unknown): boolean {
  return getDiscordErrorCode(error) === 10_008;
}

export class ProgressMessageController {
  private messageId: string | null = null;
  private finalized = false;
  private pendingProgressText: string | null = null;
  private drainPromise: Promise<void> | null = null;
  private progressGeneration = 0;
  private readonly nonceBase: string;

  constructor(private readonly options: ProgressMessageControllerOptions) {
    this.nonceBase = options.executionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "execution";
  }

  update(text: string): Promise<void> {
    if (this.finalized) return Promise.resolve();
    this.pendingProgressText = text;
    if (!this.drainPromise) {
      this.drainPromise = this.drainProgress().finally(() => {
        this.drainPromise = null;
      });
    }
    return this.drainPromise;
  }

  async final(text: string): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    this.pendingProgressText = null;

    try {
      await this.drainPromise;
    } catch {
      // The final response must still be attempted after a progress-send failure.
    }

    if (this.messageId) {
      try {
        await this.options.edit(this.messageId, text);
        return;
      } catch (error) {
        this.options.onError({ operation: "final_edit", messageId: this.messageId, error });
      }
    }

    try {
      const sent = await this.options.send(text, this.buildSendOptions("final"));
      this.messageId = sent.id;
    } catch (error) {
      this.options.onError({ operation: "final_send", messageId: this.messageId, error });
      throw error;
    }
  }

  private async drainProgress(): Promise<void> {
    while (!this.finalized && this.pendingProgressText !== null) {
      const text = this.pendingProgressText;
      this.pendingProgressText = null;
      await this.applyProgress(text);
    }
  }

  private async applyProgress(text: string): Promise<void> {
    if (!this.messageId) {
      try {
        const sent = await this.options.send(
          text,
          this.buildSendOptions(`progress${this.progressGeneration}`),
        );
        this.messageId = sent.id;
      } catch (error) {
        this.options.onError({ operation: "progress_send", messageId: null, error });
        throw error;
      }
      return;
    }

    try {
      await this.options.edit(this.messageId, text);
    } catch (error) {
      const failedMessageId = this.messageId;
      this.options.onError({ operation: "progress_edit", messageId: failedMessageId, error });
      if (!isUnknownDiscordMessage(error)) return;

      this.progressGeneration += 1;
      try {
        const sent = await this.options.send(
          text,
          this.buildSendOptions(`progress${this.progressGeneration}`),
        );
        this.messageId = sent.id;
      } catch (sendError) {
        this.options.onError({ operation: "progress_send", messageId: failedMessageId, error: sendError });
        throw sendError;
      }
    }
  }

  private buildSendOptions(suffix: string): ProgressMessageSendOptions {
    return {
      nonce: `${this.nonceBase}-${suffix}`.slice(0, 25),
      enforceNonce: true,
    };
  }
}
