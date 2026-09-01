# AGENTS.md - Coding Guidelines for tiny-oss

tiny-oss is a tiny object storage SDK focused on uploading, with a functional API: every operation is a standalone function taking the client options as the first argument. Built-in entries: Aliyun OSS (default `tiny-oss`), Tencent Cloud COS, Huawei Cloud OBS, AWS S3 (plus S3-compatible stores), Azure Blob Storage. Runs in browsers (XHR by default), Node.js/Service Workers (fetch transport) and WeChat mini programs (wx transport).

## Architecture

- Every operation is a factory over a `Protocol` (`src/protocol.ts`). `src/ops/` holds one file per operation (`createPut`, `createMultipartUpload`, …); each entry (`src/index.ts`, `src/cos|obs|aws|azure/index.ts`) binds a provider's protocol and exports the operations.
- Network layer is injectable: `src/transport.ts` (XHR default) + `src/transports/` (fetch, wx).
- Public types live in `src/types.ts` under the `TinyOSS` namespace; entries also export `setTransport`, `getTransport`, `bindOptions`, `type TinyOSS`.
- `putSymlink` is OSS-only; the Azure entry omits `abortMultipartUpload`/`listParts`/`listUploads`/`uploadPartCopy`.

## Hard constraints

- Each signer must stay byte-identical to its official SDK — the oracle tests (`test/cos|obs|aws-signature.spec.ts`, `npm run test:azure-oracle`) pin them. Never change a signer without those passing.
- Entries must stay self-contained: keep provider-specific code in its own directory; shared modules must not reference unused signers (tree shaking depends on it).

## Quick notes

- Commands live in `package.json`; formatting/lint are handled by `.editorconfig` and `oxlint.json`.
- Integration specs (`test/*-integration.spec.ts`) need `npm run serve` first (Hono server on :8080, credentials from `.env`); signature/unit specs don't.
- Input data is `Blob | ArrayBuffer | Uint8Array | string`; mini programs pass `ArrayBuffer`.

## References

- Usage and per-provider options: `README.md`; building a custom provider: README "Extension" section and `src/provider.ts`.
