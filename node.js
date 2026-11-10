import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createClient } from "./client.js";

export function init(options) {
  const context = new AsyncLocalStorage();
  const client = createClient({ ...options, platform: "node", scope: () => context.getStore(), randomUUID });
  if (options.captureFatal !== false) {
    const onFatal = error => {
      client.captureException(error, { severity: "fatal" });
      void client.flush(250);
    };
    // The monitor observes exceptions without changing Node's exit behavior.
    process.on("uncaughtExceptionMonitor", onFatal);
    client.addCleanup(() => process.off("uncaughtExceptionMonitor", onFatal));
  }
  return Object.assign(client, {
    withScope(scope, callback) {
      const parent = context.getStore();
      return context.run({ ...parent, ...scope, tags: { ...parent?.tags, ...scope.tags } }, callback);
    },
  });
}
