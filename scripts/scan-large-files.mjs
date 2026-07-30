import fs from "fs";
import path from "path";

const target = process.argv[2] || "app";
const absTarget = path.resolve(target);

function walk(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "__tests__" && entry.name !== "build") {
        results.push(...walk(fullPath));
      }
    } else if (/\.(tsx?)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = walk(absTarget);
const large = [];
for (const f of files) {
  const content = fs.readFileSync(f, "utf-8");
  const lines = content.split("\n").length;
  if (lines > 200) {
    large.push({ lines, file: path.relative(absTarget, f) });
  }
}

large.sort((a, b) => b.lines - a.lines);
if (large.length === 0) {
  console.log("No files over 200 lines found.");
} else {
  for (const item of large) {
    console.log(`${item.lines.toString().padStart(5)} lines: ${item.file}`);
  }
}
