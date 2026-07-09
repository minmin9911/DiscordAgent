export interface ParsedOkCommand {
  minutes: number | null;
  prompt: string | null;
}

export function parseOkCommandBody(body: string): ParsedOkCommand {
  const trimmed = body.trim();
  if (!trimmed) {
    return { minutes: null, prompt: null };
  }

  const match = /^(\d+)(?:\s+(.*))?$/s.exec(trimmed);
  if (!match) {
    return { minutes: null, prompt: trimmed };
  }

  const minutes = Number(match[1]);
  const prompt = match[2]?.trim() || null;
  return { minutes, prompt };
}
