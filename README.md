# Totono Error Reporting for JavaScript

Install this SDK from the npm registry.

```sh
npm install @totono/error-reporting
```

Initialize the browser entry point once during client startup.

```js
import { init } from "@totono/error-reporting/browser";
const reporting = init({
  key: PUBLIC_INGESTION_KEY,
  release: BUILD_VERSION,
  environment: "production",
});
```

For a backend, use `@totono/error-reporting/node`. Use `withScope({ tags, user, request }, callback)` for request-local context. Capture handled errors with `captureException(error)`, and use `flush(timeoutMs)` before an orderly shutdown. Node fatal reporting is best effort. It preserves normal process exit behavior.

The React entry point exports `ErrorBoundary` with `client` and `fallback` props. The Next.js entry point exports `nextRequestError(client)` for the instrumentation hook.

The SDK sends reports to Totono automatically. The project key is public and write-only. You can embed it in your app. Configure the browser origin in the project. Explicitly enable identifiable user context and allowlisted request fields both in the SDK and the project before sending them. Send only diagnostic data you are authorized to collect.

## Upload source maps for symbolication

Generate source maps for the bundles you deploy. Keep the `.map` files out of your public assets and upload them from CI using the project's artifact key as the `TOTONO_ERROR_ARTIFACT_KEY` secret.

```sh
npx totono-error-artifact source_map dist/app.js.map web "$RELEASE" "" /assets/app.js
```

Upload one map per bundle or chunk. Use `web` for browser bundles and `node` for server bundles. Pass the same `release` and `build` values used to initialize the SDK. Pass `""` for `build` if you omit it in the SDK. Reports without a release use `unknown`.

Use the generated JavaScript file's path as it appears in the reported stack frame. For example, use `/assets/app.js` for `https://example.com/assets/app.js`.

### Automate uploads in CI

Set `RELEASE` in your build job and use its value for `BUILD_VERSION` when you initialize the SDK. If you also set the SDK's `build` option, expose that same value as `TOTONO_ERROR_BUILD`. Make `TOTONO_ERROR_ARTIFACT_KEY` available to the upload step as a CI secret.

Run this Bash step from the application directory after `npm ci` and the production build, before publishing the assets. This example assumes the build writes maps to `dist/assets` and serves the matching bundles under `/assets/`.

```bash
set -euo pipefail
shopt -s nullglob
: "${RELEASE:?Set RELEASE to the value used by the SDK}"

maps=(dist/assets/*.js.map)
if [[ -z ${maps[0]:-} ]]; then
  echo "No source maps found in dist/assets" >&2
  exit 1
fi

for map in "${maps[@]}"; do
  bundle=${map#dist}
  ./node_modules/.bin/totono-error-artifact source_map \
    "$map" web "$RELEASE" "${TOTONO_ERROR_BUILD:-}" "${bundle%.map}"
done
```

Adjust the glob and bundle paths to match your build output and reported stack frames. If you also build server bundles, run a separate upload step with `node` and the paths from server stack frames. Publish the generated JavaScript without the `.map` files.
