import { createClient } from "./client.js";

export function init(options) {
  // Preserve queued reports from clients already using the Totono collector.
  const storageKey = `totono:error-reporting:v1:https://totono.work:${options.key}`;
  const client = createClient({
    ...options,
    platform: "web",
    storage: options.storage ?? {
      load: () => JSON.parse(window.localStorage.getItem(storageKey) ?? "[]"),
      save: queue => queue.length ? window.localStorage.setItem(storageKey, JSON.stringify(queue)) : window.localStorage.removeItem(storageKey),
    },
  });
  if (options.captureGlobalErrors !== false) {
    const onError = event => client.captureException(event.error ?? {
      name: "Error", message: event.message, stack: `at ${event.filename}:${event.lineno}:${event.colno}`,
    });
    const onRejection = event => client.captureException(event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    client.addCleanup(() => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    });
  }
  return client;
}
