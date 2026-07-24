// Shared CSV export utility — uses fetch() (App Bridge includes JWT auth header)
// instead of <a download> (browser navigation omits JWT, breaks unstable_newEmbeddedAuthStrategy)
export async function downloadCSV(url: string): Promise<string> {
  const res = await fetch(url);
  const contentType = res.headers.get("Content-Type") || "";

  // Guard: if server returned something other than CSV (e.g. auth redirect → HTML),
  // surface a clear error instead of downloading a broken file.
  if (!res.ok || !contentType.includes("text/csv")) {
    let detail = "";
    if (contentType.includes("text/html")) {
      detail = " Please reopen the app and try again.";
    } else if (res.status === 401 || res.status === 402) {
      const text = await res.text().catch(() => "");
      detail = ` ${text}`;
    } else {
      detail = ` (HTTP ${res.status})`;
    }
    throw new Error(`Export failed.${detail}`);
  }

  const blob = await res.blob();
  const filename =
    res.headers
      .get("Content-Disposition")
      ?.match(/filename="?([^"]+)"?/)?.[1] ?? "export.csv";

  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

  return filename;
}
