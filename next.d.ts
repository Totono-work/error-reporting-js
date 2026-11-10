import type { ReportingClient } from "./client.js";
export function nextRequestError(client: ReportingClient): (error: unknown, request?: { path?: string }) => Promise<void>;
