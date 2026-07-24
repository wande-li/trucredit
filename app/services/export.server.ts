// CSV Export Utility — generic, server-only
// Handles comma escaping, quote wrapping, BOM for Excel compatibility

/**
 * Encode a single CSV field value.
 * Wraps in double-quotes if the value contains comma, quote, or newline.
 * Escapes embedded double-quotes by doubling them (RFC 4180).
 */
function csvEscape(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Generate a CSV string from headers and rows.
 * Returns a UTF-8 string with BOM prefix for Excel compatibility.
 *
 * @param headers - Column header labels
 * @param rows - Array of string arrays (each inner array = one row)
 * @returns Full CSV string ready for Response body
 */
export function exportToCsv(headers: string[], rows: string[][]): string {
  const headerLine = headers.map(csvEscape).join(",");
  const dataLines = rows.map((row) => row.map(csvEscape).join(","));
  // BOM (U+FEFF) ensures Excel recognizes UTF-8 encoding
  return "\uFEFF" + [headerLine, ...dataLines].join("\n") + "\n";
}

/**
 * Build common CSV response headers for file download.
 * @param filename - The download filename (without .csv extension)
 */
export function csvResponseHeaders(filename: string): Record<string, string> {
  const safeFilename = filename.replace(/[^a-zA-Z0-9_\- ]/g, "_");
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${safeFilename}.csv"`,
    "Cache-Control": "no-cache, no-store, must-revalidate",
  };
}
