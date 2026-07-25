// Fix: Move meta exports after ALL imports (not between import groups)
import { readFileSync, writeFileSync } from "fs";

const files = [
  "app/routes/app._index.tsx",
  "app/routes/app.billing.tsx",
  "app/routes/app.collections.tsx",
  "app/routes/app.collections.$id.tsx",
  "app/routes/app.customers.tsx",
  "app/routes/app.customers.$id.tsx",
  "app/routes/app.emails.tsx",
  "app/routes/app.emails.$id.tsx",
  "app/routes/app.invoices.tsx",
  "app/routes/app.invoices.$id.tsx",
  "app/routes/app.invoices.new.tsx",
  "app/routes/app.replies.tsx",
  "app/routes/app.rules.tsx",
  "app/routes/app.rules.$id.tsx",
  "app/routes/app.settings.tsx",
  "app/routes/app.tasks.tsx",
];

let fixed = 0;
for (const file of files) {
  let content = readFileSync(file, "utf8");
  
  if (!content.includes("export const meta:")) continue;
  
  // Extract meta line (it's a single line)
  const metaMatch = content.match(/^export const meta: MetaFunction = .+?;$/m);
  if (!metaMatch) {
    console.log(`SKIP ${file}: no meta export found`);
    continue;
  }
  
  const metaLine = metaMatch[0];
  
  // Remove the meta line
  content = content.replace("\n" + metaLine, "");
  
  // Find the last import statement
  const lines = content.split("\n");
  let lastImportLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("import ")) {
      lastImportLine = i;
    }
  }
  
  if (lastImportLine >= 0) {
    // Insert meta after last import + blank line
    lines.splice(lastImportLine + 1, 0, "", metaLine);
    content = lines.join("\n");
  }
  
  writeFileSync(file, content);
  console.log(`OK ${file}`);
  fixed++;
}

console.log(`\nFixed ${fixed} files`);
