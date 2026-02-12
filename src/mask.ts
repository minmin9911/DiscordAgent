const patterns: RegExp[] = [
  /Authorization:\s*Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[A-Za-z0-9\-_.]{8,}/gi,
  /^([A-Z0-9_]*(SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*)\s*=\s*.+$/gm,
];

export function maskSecrets(input: string): string {
  let out = input;
  for (const p of patterns) {
    out = out.replace(p, "***REDACTED***");
  }
  return out;
}
