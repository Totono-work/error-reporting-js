#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";

async function main() {
  const [kind, path, ...args] = process.argv.slice(2);
  if (!["source_map", "dsym"].includes(kind) || !path) {
    throw new Error("usage: totono-error-artifact source_map FILE PLATFORM RELEASE BUILD BUNDLE_PATH | dsym FILE UUID ARCH");
  }
  const endpoint = new URL("/api/error-reporting/v1/artifacts", process.env.TOTONO_ERROR_ORIGIN);
  const key = process.env.TOTONO_ERROR_ARTIFACT_KEY;
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || !/^tr_art_[\w-]{43}$/.test(key ?? "")) {
    throw new Error("invalid_artifact_configuration");
  }
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > 16 * 1024 * 1024) throw new Error("invalid_file_size");
  const bytes = await readFile(path);
  if (bytes.length !== info.size) throw new Error("file_changed_during_read");
  async function post(value) {
    const response = await fetch(endpoint, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    if (!response.ok) throw new Error(`artifact_api_${response.status}`);
    return response.json();
  }
  const metadata = kind === "source_map"
    ? { platform: args[0], release: args[1], build: args[2], file: args[3] }
    : { uuid: args[0], arch: args[1] };
  const { id, upload } = await post({ action: kind, size: bytes.length, ...metadata });
  const body = new FormData();
  for (const [name, value] of Object.entries(upload.fields)) body.append(name, value);
  body.append("file", new Blob([bytes], { type: "application/octet-stream" }), "artifact");
  const response = await fetch(upload.url, { method: "POST", body, redirect: "error", signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`storage_upload_${response.status}`);
  await post({ action: "complete", id });
  console.log(id);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
