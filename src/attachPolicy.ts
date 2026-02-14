export const ATTACH_MAX_BYTES = 8 * 1024 * 1024;
export const ATTACH_COMMAND_PREFIX = "!attach ";

export function extractAttachPaths(output: string): {
  paths: string[];
  cleanedOutput: string;
} {
  const paths: string[] = [];
  const kept: string[] = [];
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith(ATTACH_COMMAND_PREFIX)) {
      const path = trimmed.slice(ATTACH_COMMAND_PREFIX.length).trim();
      if (path.length > 0) paths.push(path);
      continue;
    }
    kept.push(line);
  }
  return {
    paths,
    cleanedOutput: kept.join("\n").trim(),
  };
}
