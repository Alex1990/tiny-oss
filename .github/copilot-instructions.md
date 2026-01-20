# Copilot Instructions for tiny-oss

This guide provides essential context and conventions for AI coding agents working on the `tiny-oss` project—a minimal browser SDK for Aliyun OSS uploads.

## Project Overview

- **Purpose:** Tiny, browser-focused Aliyun OSS SDK for uploading files. Emphasizes minimal size (<10kb gzipped) and modern browser compatibility.
- **Core:** All main logic is in `src/TinyOSS.js` (class `TinyOSS`).
- **API:** Exposes `put`, `putSymlink`, and `signatureUrl` methods for uploading and signed URL generation.
- **Utils:** Helpers in `src/utils/` (e.g., `ajax.js` for XHR, `index.js` for crypto/signature helpers).

## Key Files & Structure

- `src/TinyOSS.js`: Main SDK logic and entry point.
- `src/utils/`: Utility functions (AJAX, MD5, signature, etc.).
- `test/`: Contains tests (`index.spec.js`), a Koa-based mock server (`server.js`), and HTML test runners.
- `webpack.config.js`: UMD build config; outputs to `dist/`.
- `package.json`: Scripts for build, test, lint, and serve. See below for workflow details.

## Developer Workflows

- **Build:**
  - `npm run build` (cleans, builds ES, CommonJS, UMD, and minified UMD bundles)
  - Output: `dist/`, `lib/`, `es/`
- **Test:**
  - `npm run test` (builds, starts test server, runs Karma tests)
  - `npm run test:watch` (watch mode)
  - `npm run test:cov` (with coverage)
  - Test server: `test/server.js` (Koa, serves static and OSS config endpoints)
- **Lint:**
  - `npm run lint` (uses Airbnb base ESLint config)
- **Serve Example:**
  - `npm run serve` (serves project root via Koa)

## Patterns & Conventions

- **Options Validation:** All `TinyOSS` instances require explicit options (see README and `assertOptions`).
- **AJAX:** Uses custom XHR wrapper (`src/utils/ajax.js`) for all network requests.
- **Signature Generation:** OSS signatures are computed in-browser using helpers in `src/utils/`.
- **Progress Events:** Upload progress is handled via the `onprogress` callback in `put` options.
- **Environment:** Modern browsers only; polyfill `Promise` for IE/old Firefox.
- **Testing:** Tests use Mocha, Chai, and Karma. Test server provides `/api/oss-config` and `/api/sts` endpoints for integration.

## Integration Points

- **Aliyun OSS:** All uploads and signed URLs are compatible with Aliyun OSS REST API.
- **No Node.js OSS SDK:** All logic is browser-native; no server-side dependencies for core SDK.
- **Test Server:** Uses `ali-oss` for STS token emulation in tests only.

## Examples

- See `README.md` for usage and API examples.
- See `test/index.spec.js` for integration and edge case tests.

---

For further details, consult the README or source files referenced above. When in doubt, prefer minimal, browser-compatible solutions and follow the patterns in `TinyOSS.js` and `utils/`.
