# Copilot Instructions for tiny-oss

This guide provides essential context and conventions for AI coding agents working on the `tiny-oss` project—a tiny object storage SDK focused on uploading, with drop-in entries for Aliyun OSS, Tencent Cloud COS, Huawei Cloud OBS, AWS S3 (and S3-compatible stores) and Azure Blob Storage. Each entry is a separate build (about 11kb min+gzipped for the full OSS entry; tree-shaking drops unused operations).

## Project Overview

- **Purpose:** Tiny object storage SDK focused on uploading. Functional API: every operation is a standalone function taking the client options as the first argument.
- **Core:** All operations are factories over a `Protocol` (see `src/protocol.ts`). Entry points bind a provider's protocol and export the operation functions — `src/index.ts` (OSS, default), `src/cos/index.ts`, `src/obs/index.ts`, `src/aws/index.ts`, `src/azure/index.ts`.
- **API:** `put`, `putSymlink` (OSS only), `signatureUrl`, `initMultipartUpload`, `uploadPart`, `completeMultipartUpload`, `abortMultipartUpload`, `listParts`, `listUploads`, `uploadPartCopy`, `multipartUpload`, `bindOptions`, `setTransport`/`getTransport`.
- **Types:** TypeScript; public types live in `src/types.ts` (namespace `TinyOSS`) and are re-exported from every entry.

## Key Files & Structure

- `src/protocol.ts`: The `Protocol` interface (request/signUrl plus provider constants) shared by every provider.
- `src/provider.ts`: The `tiny-oss/protocol` entry — operation factories (`createPut`, `createMultipartUpload`, …) and shared request helpers (`normalizeOptions`, `resolveTimeout`, `dataSize`).
- `src/ops/`: One file per operation factory (`put.ts`, `multipartUpload.ts`, `initMultipartUpload.ts`, …, `bindOptions.ts`), provider-agnostic.
- `src/<provider>/`: Provider implementations — `signature.ts`, `host.ts`, `request.ts`, `signatureUrl.ts`, `index.ts` (AWS adds `sha256.ts`; Azure adds `multipart.ts` for its block-blob primitives).
- `src/transport.ts` + `src/transports/`: Injectable network layer. Default is `XMLHttpRequest`; `fetch.ts` (Node.js/Service Worker) and `wx.ts` (WeChat mini program) are ready-made adapters.
- `src/types.ts`: Public type definitions (`TinyOSS` namespace).
- `src/utils/`, `src/digest.ts`: Shared helpers (options assertion, MD5, UTF-8, XML parsing, hash digest).
- `test/`: Vitest specs (`*.spec.ts`), integration specs (`*-integration.spec.ts`), type-level tests (`test-types-*.ts`), and the Koa test server (`server.ts`).
- `vite.config.ts` + `vite.<provider>.config.ts`: One lib build per entry, output to `dist/`.

## Developer Workflows

- **Build:** `npm run build` (Vite lib builds for the OSS/COS/OBS/AWS/Azure/protocol entries, then `dts-bundle-generator` emits `dist/*.d.ts`). Output: `dist/`.
- **Test:** `npm run test` (Vitest); `npm run test:ci` (headless browser); `npm run test:coverage`. Signature correctness is pinned by oracle tests against the official SDKs (`test/cos-signature.spec.ts`, `test/obs-signature.spec.ts`, `test/aws-signature.spec.ts`, and `npm run test:azure-oracle` for Azure).
- **Type check:** `npm run check:types` (tsc over `test/test-types-*.ts`).
- **Lint:** `npm run lint` (oxlint).
- **Serve Example:** `npm run serve` (Koa, via `tsx test/server.ts`).
- **Test Server:** `test/server.ts` (Koa; serves static files and config endpoints for integration tests).

## Patterns & Conventions

- **Options Validation:** Every operation validates the client options via `assertOptions` (`src/utils/index.ts`) — `accessKeyId`, `accessKeySecret`, and `bucket` or `endpoint` are required.
- **Transport:** All network requests go through the configured transport (`getTransport()`); adapters receive `(url, { method, headers, data, timeout, onprogress, total })` and resolve `{ data, headers, status, statusText }`.
- **Signatures:** Computed in-browser per provider — `src/aws/signature.ts` (SigV4, `UNSIGNED-PAYLOAD`), `src/cos/signature.ts` (COS V5), `src/obs/signature.ts` (OBS "obs" scheme), `src/azure/signature.ts` (SharedKey). Each must stay byte-identical to its official SDK (the oracle tests enforce this).
- **Progress Events:** Upload progress is handled via the `onprogress` callback in operation options; fetch/wx transports fire synthetic 0%/100% events.
- **Environment:** Browsers out of the box (`XMLHttpRequest`); Node.js and Service Workers use `fetchTransport`, WeChat mini programs use `wxRequestTransport`. Input data can be `Blob`/`ArrayBuffer`/`Uint8Array`/string.
- **Tree shaking:** Each entry is a self-contained build; keep provider-specific code out of shared modules so unused entries/operations are dropped.

## Integration Points

- **Aliyun OSS / Tencent COS / Huawei OBS / AWS S3 / Azure Blob:** All uploads and signed URLs are compatible with each vendor's REST API (S3-compatible stores such as MinIO, R2 and GCS use the AWS entry).
- **No Node.js OSS SDK:** All signing is native; the only server-side dependency is the test server's `ali-oss` STS emulation for integration tests.

## Examples

- See `README.md` for usage, per-provider options mapping, and the "Extension" section for building custom providers via `tiny-oss/protocol`.
- See `test/*.spec.ts` for integration and edge case tests.

---

For further details, consult the README or the source files referenced above. When in doubt, prefer minimal, tree-shakeable solutions and follow the patterns in `src/ops/` and `src/<provider>/`.
