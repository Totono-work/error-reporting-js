export type DiagnosticValue = string | number | boolean | null;
export type DiagnosticFields = Record<string, DiagnosticValue>;
export type ErrorScope = {
  severity?: "info" | "warning" | "error" | "fatal";
  tags?: DiagnosticFields;
  user?: { id?: string; name?: string; email?: string };
  request?: DiagnosticFields;
  fingerprint?: string[];
};
export interface ReportingOptions {
  key: string;
  release?: string;
  build?: string;
  environment?: string;
  device?: DiagnosticFields;
  allowIdentifiableUser?: boolean;
  allowedRequestFields?: string[];
  isApplicationFrame?: (file: string) => boolean;
  shouldSend?: (event: unknown) => boolean;
  fetch?: typeof fetch;
}
export interface ReportingClient {
  captureException(error: unknown, scope?: ErrorScope): string | undefined;
  captureMessage(message: string, scope?: ErrorScope): string | undefined;
  addBreadcrumb(category: string, message: string): void;
  setTag(key: string, value: DiagnosticValue): void;
  setUser(user?: ErrorScope["user"]): void;
  flush(timeoutMs?: number): Promise<boolean>;
  close(timeoutMs?: number): Promise<boolean>;
}
export function createClient(options: ReportingOptions & { platform: "web" | "node" }): ReportingClient;
