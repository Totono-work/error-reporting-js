export function nextRequestError(client) {
  return async function onRequestError(error, request) {
    const path = request?.path?.split(/[?#]/, 1)[0];
    if (path?.startsWith("/api/public/error-reporting/") || path?.startsWith("/api/cron/error-reporting")) return;
    client.captureException(error);
    await client.flush(1000);
  };
}
