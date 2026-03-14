export function truncateExternalUserMessage(text: string, maxChars: number): string {
  const limit = Math.max(1, Math.trunc(maxChars));
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...(truncated, original=${text.length} chars)`;
}

