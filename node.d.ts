import type { ErrorScope, ReportingClient, ReportingOptions } from "./client.js";
export function init(options: ReportingOptions & { captureFatal?: boolean }): ReportingClient & {
  withScope<T>(scope: ErrorScope, callback: () => T): T;
};
