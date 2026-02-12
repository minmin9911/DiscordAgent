const fs = require("node:fs");
const path = require("node:path");

const target = path.join(process.cwd(), "src", "buildInfo.ts");
const src = fs.readFileSync(target, "utf8");

const re = /export const BUILD_NUMBER = (\d+);/;
const match = src.match(re);
if (!match) {
  console.error("BUILD_NUMBER が見つかりません");
  process.exit(1);
}

const current = Number(match[1]);
const next = current + 1;
const updated = src.replace(re, `export const BUILD_NUMBER = ${next};`);
fs.writeFileSync(target, updated, "utf8");
console.log(`BUILD_NUMBER: ${current} -> ${next}`);
