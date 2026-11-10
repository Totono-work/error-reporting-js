# Totono Error Reporting for JavaScript

Install this SDK from GitHub with `npm install github:Totono-work/error-reporting-js`.

Initialize the browser entry point once during client startup.

```js
import { init } from "@totono/error-reporting/browser";
const reporting = init({
  origin: "https://totono.work",
  key: PUBLIC_INGESTION_KEY,
  release: BUILD_VERSION,
  environment: "production",
});
```

For a backend, use `@totono/error-reporting/node`. Use `withScope({ tags, user, request }, callback)` for request-local context. Capture handled errors with `captureException(error)`, and use `flush(timeoutMs)` before an orderly shutdown. Node fatal reporting is best effort. It preserves normal process exit behavior.

The React entry point exports `ErrorBoundary` with `client` and `fallback` props. The Next.js entry point exports `nextRequestError(client)` for the instrumentation hook.

The ingestion key grants write access only. Configure the browser origin in the project. Explicitly enable identifiable user context and allowlisted request fields both in the SDK and the project before sending them. Send only diagnostic data you are authorized to collect.
