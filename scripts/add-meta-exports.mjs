// Add MetaFunction import + meta export to all 16 UI routes
import { readFileSync, writeFileSync } from "fs";

const routes = [
  { file: "app/routes/app._index.tsx", title: "Dashboard", importPattern: "LoaderFunctionArgs, ActionFunctionArgs" },
  { file: "app/routes/app.billing.tsx", title: "Billing & Plan", importPattern: "LoaderFunctionArgs" },
  { file: "app/routes/app.collections.tsx", title: "Collections", importPattern: "LoaderFunctionArgs, ActionFunctionArgs" },
  { file: "app/routes/app.collections.$id.tsx", title: "Collection Detail", importPattern: "LoaderFunctionArgs, ActionFunctionArgs" },
  { file: "app/routes/app.customers.tsx", title: "Customers", importPattern: "LoaderFunctionArgs" },
  { file: "app/routes/app.customers.$id.tsx", title: "Customer Detail", importPattern: "LoaderFunctionArgs, ActionFunctionArgs" },
  { file: "app/routes/app.emails.tsx", title: "Email Templates", importPattern: "LoaderFunctionArgs, ActionFunctionArgs" },
  { file: "app/routes/app.emails.$id.tsx", title: "Email Template", importPattern: "LoaderFunctionArgs, ActionFunctionArgs" },
  { file: "app/routes/app.invoices.tsx", title: "Invoices", importPattern: "LoaderFunctionArgs, ActionFunctionArgs" },
  { file: "app/routes/app.invoices.$id.tsx", title: "Invoice Detail", importPattern: "LoaderFunctionArgs, ActionFunctionArgs" },
  { file: "app/routes/app.invoices.new.tsx", title: "New Invoice", importPattern: "LoaderFunctionArgs, ActionFunctionArgs" },
  { file: "app/routes/app.replies.tsx", title: "Reply History", importPattern: "LoaderFunctionArgs, ActionFunctionArgs" },
  { file: "app/routes/app.rules.tsx", title: "Auto-Reply Rules", importPattern: "LoaderFunctionArgs, ActionFunctionArgs" },
  { file: "app/routes/app.rules.$id.tsx", title: "Rule Detail", importPattern: "LoaderFunctionArgs, ActionFunctionArgs" },
  { file: "app/routes/app.settings.tsx", title: "Settings", importPattern: "LoaderFunctionArgs, ActionFunctionArgs" },
  { file: "app/routes/app.tasks.tsx", title: "Collection Tasks", importPattern: "LoaderFunctionArgs, ActionFunctionArgs" },
];

let updated = 0;
let skipped = 0;

for (const r of routes) {
  let content = readFileSync(r.file, "utf8");

  // Step 1: Add MetaFunction to type import
  const oldImport = `import type { ${r.importPattern} } from "@remix-run/node";`;
  const newImport = `import type { ${r.importPattern}, MetaFunction } from "@remix-run/node";`;

  if (content.includes("MetaFunction")) {
    console.log(`SKIP ${r.file}: MetaFunction already present`);
    skipped++;
    continue;
  }

  if (!content.includes(oldImport)) {
    console.log(`WARN ${r.file}: import pattern not found → ${oldImport}`);
    continue;
  }

  content = content.replace(oldImport, newImport);

  // Step 2: Add meta export after the last @remix-run/node import
  if (!content.includes("export const meta")) {
    const lines = content.split("\n");
    let lastNodeImportLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('from "@remix-run/node"')) {
        lastNodeImportLine = i;
      }
    }

    if (lastNodeImportLine >= 0) {
      // Insert blank line + meta export after the node import
      const metaExport = `\nexport const meta: MetaFunction = () => [{ title: "TruCredit — ${r.title}" }];`;
      lines.splice(lastNodeImportLine + 1, 0, metaExport);
      content = lines.join("\n");
    }
  }

  writeFileSync(r.file, content);
  console.log(`OK ${r.file}: added meta → "${r.title}"`);
  updated++;
}

console.log(`\nDONE: ${updated} updated, ${skipped} skipped`);
