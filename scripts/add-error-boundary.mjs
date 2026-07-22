import fs from "fs";

const files = [
  "app/routes/app.tasks.tsx",
  "app/routes/app.rules.$id.tsx",
  "app/routes/app.replies.tsx",
  "app/routes/app.invoices.new.tsx",
  "app/routes/app.invoices.$id.tsx",
  "app/routes/app.emails.tsx",
  "app/routes/app.emails.$id.tsx",
  "app/routes/app.customers.new.tsx",
  "app/routes/app.customers.$id.tsx",
  "app/routes/app.collections.$id.tsx",
];

const importLine =
  'import RouteErrorBoundary from "~/components/RouteErrorBoundary";\n';
const exportBlock = `\n// Route-level ErrorBoundary
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
`;

for (const f of files) {
  try {
    let content = fs.readFileSync(f, "utf-8");

    if (content.includes("export function ErrorBoundary")) {
      console.log(`${f} — ALREADY HAS, skipped`);
      continue;
    }

    // Add import after the last import line
    if (!content.includes("RouteErrorBoundary")) {
      const lines = content.split("\n");
      let lastImportIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^import\s/.test(lines[i]) || /^import\{/.test(lines[i])) {
          lastImportIdx = i;
        }
      }
      if (lastImportIdx >= 0) {
        lines.splice(lastImportIdx + 1, 0, importLine.trimEnd());
        content = lines.join("\n");
      }
    }

    // Add ErrorBoundary export at the end
    content = content.trimEnd() + "\n" + exportBlock + "\n";
    fs.writeFileSync(f, content);
    console.log(`${f} — DONE`);
  } catch (e) {
    console.log(`${f} — ERROR: ${e.message}`);
  }
}

console.log("\nAll done.");
