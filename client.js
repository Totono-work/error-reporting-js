const ingestionEndpoint = "https://totono.work/api/public/error-reporting/v1/events";
const MAX_AGE = 30 * 86_400_000;
const MAX_QUEUE = 50;
const MAX_BYTES = 900_000;
const privateField = /cookie|authorization|password|secret|token|session|credential|api[-_ ]?key|^body$|^headers$/i;

function cleanText(value, limit, allowEmail = false) {
  const safe = String(value ?? "")
    .replace(/\b(?:set-cookie|cookie|authorization)\s*[:=][^\r\n]*/gi, "[redacted]")
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, "[redacted]")
    .replace(/\b(?:cookie|authorization|password|secret|token|session|credential|api[-_ ]?key)\s*[:=]\s*[^\s,;]+/gi, "[redacted]")
    .replace(/\b(?:ttr|tta|tr_art)_[a-z0-9_-]+/gi, "[redacted]")
    .replace(/https?:\/\/[^\s<>"']+/gi, value => {
      try {
        const url = new URL(value);
        return url.origin + url.pathname;
      } catch {
        return "[redacted]";
      }
    });
  return (allowEmail ? safe : safe.replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+/g, "[redacted]")).slice(0, limit);
}

function cleanFields(input, allow = () => true) {
  return Object.fromEntries(Object.entries(input ?? {}).filter(([key, value]) =>
    key.length > 0 && key.length <= 64 && !privateField.test(key) && allow(key) &&
    (value === null || typeof value === "string" || typeof value === "boolean" || Number.isFinite(value)),
  ).slice(0, 32).map(([key, value]) => [key, typeof value === "string" ? cleanText(value, 512) : value]));
}

function parseFrames(stack, inApp) {
  return String(stack ?? "").split("\n").flatMap(row => {
    const match = row.trim().match(/^(?:at\s+(?:(.*?)\s+\()?|(.*?)@)([^\s()]+):(\d+):(\d+)\)?$/);
    if (!match) return [];
    const [, nodeFunction, browserFunction, path, line, column] = match;
    const file = cleanText(path.split(/[?#]/, 1)[0], 512);
    const rowNumber = Number(line);
    const colNumber = Number(column);
    if (rowNumber < 1 || rowNumber > 10_000_000 || colNumber > 10_000_000) return [];
    return [{
      file, function: cleanText(nodeFunction || browserFunction, 256), line: rowNumber, column: colNumber,
      inApp: inApp ? !!inApp(file) : !/(?:node_modules|^node:|^native$)/.test(file),
    }];
  }).slice(0, 100);
}

function collectExceptions(value, inApp) {
  const chain = [];
  const seen = new Set();
  let current = value;
  while (chain.length < 8 && !seen.has(current)) {
    seen.add(current);
    const object = current && typeof current === "object" ? current : null;
    chain.unshift({
      type: cleanText(object?.name || "Error", 160) || "Error",
      message: cleanText(object?.message ?? current, 2048),
      frames: parseFrames(object?.stack, inApp),
    });
    if (!object || object.cause === undefined) break;
    current = object.cause;
  }
  return chain;
}

function cleanUser(user, identifiable) {
  return user ? {
    id: cleanText(user.id, 200) || undefined,
    ...(identifiable ? {
      name: cleanText(user.name, 200) || undefined,
      email: cleanText(user.email, 254, true) || undefined,
    } : {}),
  } : undefined;
}

export function createClient(options) {
  if (!/^ttr_[\w-]{43}$/.test(options.key)) throw new TypeError("invalid_ingestion_key");
  const transport = options.fetch ?? globalThis.fetch.bind(globalThis);
  const allowedFields = new Set(options.allowedRequestFields);
  const encoder = new TextEncoder();
  const fresh = event => Number.isFinite(Date.parse(event.timestamp)) && Date.parse(event.timestamp) > Date.now() - MAX_AGE;
  const recentObjects = new WeakSet();
  const cleanups = new Set();
  const breadcrumbs = [];
  let tags = {};
  let user;
  let queue = [];
  let timer;
  let pending;
  let closed = false;
  let failures = 0;
  let retryAt = 0;

  try {
    const restored = options.storage?.load();
    if (Array.isArray(restored)) queue = restored.filter(event => event && fresh(event)).slice(-MAX_QUEUE);
  } catch {
    // Reporting must remain usable when local storage is blocked or full.
  }

  function persist() {
    try { options.storage?.save(queue); } catch {}
  }

  function schedule(delay = 1000) {
    if (closed || !queue.length || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, Math.max(delay, retryAt - Date.now()));
    timer.unref?.();
  }

  function captureException(value, context = {}) {
    if (closed) return;
    try {
      if (value && typeof value === "object") {
        if (recentObjects.has(value)) return;
        recentObjects.add(value);
      }
      const scoped = { ...options.scope?.(), ...context };
      const event = {
        id: (options.randomUUID ?? (() => globalThis.crypto.randomUUID()))(),
        timestamp: new Date().toISOString(), platform: options.platform,
        release: cleanText(options.release, 100) || "unknown", build: cleanText(options.build, 100),
        environment: cleanText(options.environment ?? "production", 64), severity: scoped.severity ?? "error",
        exceptions: collectExceptions(value, options.isApplicationFrame), breadcrumbs: breadcrumbs.slice(),
        tags: cleanFields({ ...tags, ...scoped.tags }), device: cleanFields(options.device),
        user: cleanUser(scoped.user ?? user, options.allowIdentifiableUser === true),
        request: cleanFields(scoped.request, key => allowedFields.has(key)),
        fingerprint: scoped.fingerprint?.slice(0, 8).map(value => cleanText(value, 128)).filter(Boolean),
      };
      if (!event.fingerprint?.length) delete event.fingerprint;
      if (options.shouldSend?.(structuredClone(event)) === false) return;
      const size = encoder.encode(JSON.stringify(event)).length;
      if (size > MAX_BYTES) return;
      queue = [...queue.filter(fresh), event].slice(-MAX_QUEUE);
      while (queue.length > 1 && encoder.encode(JSON.stringify(queue)).length > MAX_BYTES) queue.shift();
      persist();
      schedule();
      return event.id;
    } catch {
      return undefined;
    }
  }

  async function send(timeout) {
    if (Date.now() < retryAt) return false;
    const deadline = Date.now() + timeout;
    queue = queue.filter(fresh);
    persist();
    while (queue.length && Date.now() < deadline) {
      const batch = queue.slice(0, 10);
      const ids = new Set(batch.map(event => event.id));
      try {
        const response = await transport(ingestionEndpoint, {
          method: "POST", credentials: "omit", redirect: "error",
          headers: { "Content-Type": "application/json", "X-Totono-Error-Key": options.key },
          body: JSON.stringify({ version: 1, events: batch }),
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        });
        if (response.status === 429 || response.status >= 500) {
          const seconds = Number(response.headers.get("Retry-After"));
          if (seconds > 0) retryAt = Date.now() + Math.min(seconds, 86_400) * 1000;
          throw new Error("retry");
        }
        if (response.status !== 202 && response.status !== 400 && response.status !== 413) {
          retryAt = Date.now() + 60_000;
          return false;
        }
        queue = queue.filter(event => !ids.has(event.id));
        persist();
        failures = 0;
        retryAt = 0;
      } catch {
        failures++;
        retryAt = Math.max(retryAt, Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(failures, 6)));
        return false;
      }
    }
    return queue.length === 0;
  }

  function flush(timeout = 5000) {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!pending) pending = send(timeout).finally(() => {
      pending = undefined;
      schedule();
    });
    return pending;
  }

  schedule();
  return {
    captureException,
    captureMessage(message, context) { return captureException({ name: "Message", message }, context); },
    addBreadcrumb(category, message) {
      breadcrumbs.push({ timestamp: new Date().toISOString(), category: cleanText(category, 80), message: cleanText(message, 512) });
      if (breadcrumbs.length > 50) breadcrumbs.shift();
    },
    setTag(key, value) { tags = cleanFields({ ...tags, [key]: value }); },
    setUser(value) { user = cleanUser(value, options.allowIdentifiableUser === true); },
    addCleanup(callback) { cleanups.add(callback); },
    flush,
    async close(timeout) {
      closed = true;
      for (const callback of cleanups) callback();
      cleanups.clear();
      return flush(timeout);
    },
  };
}
