import type { ReportingClient, ReportingOptions } from "./client.js";
export function init(options: ReportingOptions & { captureGlobalErrors?: boolean }): ReportingClient;
