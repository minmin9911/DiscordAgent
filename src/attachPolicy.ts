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
      const argument = trimmed.slice(ATTACH_COMMAND_PREFIX.length).trim();
      // Strip only a matching outer pair; preserve spaces and quotes inside paths.
      const quote = argument[0];
      const path = argument.length >= 2 && (quote === '"' || quote === "'") && argument.endsWith(quote)
        ? argument.slice(1, -1) : argument;
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
