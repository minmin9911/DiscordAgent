export function sanitizeAttachmentFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

export function buildPromptWithIncomingAttachments(
  userContent: string,
  absolutePaths: string[],
): string {
  if (absolutePaths.length === 0) return userContent;
  const latestPath = absolutePaths[absolutePaths.length - 1] ?? "";
  const lines = [
    userContent,
    "",
    "受信した添付ファイル（絶対パス）:",
    ...absolutePaths.map((p) => `- ${p}`),
    "",
    `latest_attachment_path: ${latestPath}`,
    "ユーザーが「このファイル」「これ」「そのファイル」と言った場合は latest_attachment_path を参照対象として扱ってください。",
    "参照が必要な依頼では、先に該当ファイルを確認してから回答してください。",
  ];
  return lines.join("\n").trim();
}
