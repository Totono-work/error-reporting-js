import { Component, type ReactNode } from "react";
import type { ReportingClient } from "./client.js";
export class ErrorBoundary extends Component<{ client: ReportingClient; fallback?: ReactNode; children?: ReactNode }> {}
