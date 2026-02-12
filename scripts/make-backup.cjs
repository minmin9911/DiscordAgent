const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(
    d.getMinutes(),
  )}${p(d.getSeconds())}`;
}

async function copySnapshot(src, dst) {
  await new Promise((resolve, reject) => {
    const rs = fs.createReadStream(src);
    const ws = fs.createWriteStream(dst);
    rs.on("error", reject);
    ws.on("error", reject);
    ws.on("finish", resolve);
    rs.pipe(ws);
  });
}

async function main() {
  const ts = stamp();
  const backupDir = path.join(process.cwd(), "backups");
  await fsp.mkdir(backupDir, { recursive: true });
  const zipPath = path.join(backupDir, `backup_${ts}.zip`);
  const tmpDir = path.join(backupDir, `tmp_${ts}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  const targets = [
    "src",
    "test",
    "scripts",
    "package.json",
    "package-lock.json",
    "README.md",
    "AGENTS.md",
    "tsconfig.json",
    "eslint.config.js",
    "vitest.config.ts",
    ".env.example",
    ".env",
  ].filter((p) => fs.existsSync(p));

  const db = path.join("data", "app.db");
  if (fs.existsSync(db)) {
    const snapshotDir = path.join(tmpDir, "data");
    await fsp.mkdir(snapshotDir, { recursive: true });
    const snapshot = path.join(snapshotDir, "app.db");
    await copySnapshot(db, snapshot);
    targets.push(snapshotDir);
  }

  if (targets.length === 0) {
    throw new Error("No backup targets found.");
  }

  const compressCmd =
    "Compress-Archive -Path " +
    targets.map((t) => `'${t.replace(/'/g, "''")}'`).join(",") +
    ` -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;

  execFileSync("powershell.exe", ["-NoLogo", "-Command", compressCmd], {
    stdio: "inherit",
  });

  await fsp.rm(tmpDir, { recursive: true, force: true });

  console.log(zipPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
