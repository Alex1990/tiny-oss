# AGENTS.md - Coding Guidelines for tiny-oss

This document provides essential context and conventions for AI coding agents working on the `tiny-oss` project—a tiny object storage SDK focused on uploading, with drop-in entries for Aliyun OSS, Tencent Cloud COS, Huawei Cloud OBS, AWS S3 (and S3-compatible stores) and Azure Blob Storage. Each entry is a separate build (about 11kb min+gzipped for the full OSS entry; tree-shaking drops unused operations).

## Project Overview

- **Purpose:** Tiny object storage SDK focused on uploading. Functional API: every operation is a standalone function taking the client options as the first argument.
- **Language:** TypeScript with strict mode enabled
- **Module System:** ES modules (ESNext)
- **Target:** ES2020 (tsconfig), es2015 (Vite build target)
- **Node Version:** ^20.19.0 || >=22.12.0
- **Architecture:** All operations are factories over a `Protocol` (`src/protocol.ts`). Entry points bind a provider's protocol and export the operation functions — `src/index.ts` (OSS, default), `src/cos/index.ts`, `src/obs/index.ts`, `src/aws/index.ts`, `src/azure/index.ts`. `putSymlink` is OSS-only; the Azure entry additionally omits `abortMultipartUpload`, `listParts`, `listUploads` and `uploadPartCopy` (no server-side upload sessions, block-blob model).

## Build/Lint/Test Commands

```bash
# Build the project
npm run build              # Full build: Vite lib builds for all entries (OSS/COS/OBS/AWS/Azure/protocol) + dts-bundle-generator types
npm run build:types        # Generate TypeScript declarations only
npm run clean              # Remove dist/ directory

# Type checking
npm run check:types        # Type check test files with tsc --noEmit

# Linting
npm run lint               # Run oxlint on src/ and test/

# Testing
npm run test               # Run vitest (watch mode)
npm run test:coverage      # Run tests with coverage report
npm run test:ci            # Run tests headless (for CI): vitest run --browser.headless
npm run test:ci:coverage   # Run headless tests with coverage
npm run test:azure-oracle  # Pin the Azure signer against @azure/storage-common/storage-blob

# Run a single test file
npx vitest run test/index.spec.ts --browser.headless

# Run a single test case (use .only or filter)
npx vitest run --browser.headless -t "put"

# Development
npm run dev                # Start Vite dev server
npm run serve              # Start test server (required for integration tests)
```

**Important:** Integration specs (`test/*-integration.spec.ts`) require the test server running (`npm run serve`) — they hit real storage endpoints via localhost:8080 using credentials from `.env`. Signature/unit specs run without it.

## Code Style Guidelines

### Formatting
- **Indentation:** 2 spaces (see .editorconfig)
- **Line endings:** LF
- **Charset:** UTF-8
- **Trailing whitespace:** Trimmed
- **Final newline:** Required

### Imports & Exports
- Use ES module syntax (`import`/`export`)
- Prefer named imports from utility modules; there is no default-export class (functional API)
- Import order: external deps first, then internal modules
- Every entry re-exports the shared surface — `setTransport`, `getTransport`, `fetchTransport`, `wxRequestTransport`, `bindOptions`, `type TinyOSS` — so callers can import from `tiny-oss[/<provider>]` only

### Types & Naming
- Use PascalCase for interfaces and types (e.g., `TinyOSSOptions`, `PutOptions`)
- Use camelCase for variables, functions, methods
- Use SCREAMING_SNAKE_CASE for constants
- Prefer explicit types over `any`
- Public types live in `src/types.ts` under the `TinyOSS` namespace (e.g., `TinyOSS.PutOptions`)

### Error Handling
- Throw descriptive errors for invalid options — `assertOptions` (`src/utils/index.ts`) requires `accessKeyId`, `accessKeySecret`, and `bucket` or `endpoint`
- Return rejected Promises for async failures
- Use type assertions sparingly (`as Type`)

### Code Patterns
- Prefer `async/await` over Promise chains for new code
- Use JSDoc comments on exported functions with @param/@return where non-obvious
- Use optional chaining (`?.`) and nullish coalescing (`??`)
- Minimize external dependencies (keep bundle small)

### Transports & Environments
- All network requests go through the configured transport (`getTransport()`, default `XMLHttpRequest`); adapters receive `(url, { method, headers, data, timeout, onprogress, total })` and resolve `{ data, headers, status, statusText }`
- Browsers work out of the box; Node.js/Service Workers use `fetchTransport` (`src/transports/fetch.ts`), WeChat mini programs use `wxRequestTransport` (`src/transports/wx.ts`) — those fire synthetic 0%/100% progress events with `lengthComputable: false`
- Input data is `Blob | ArrayBuffer | Uint8Array | string` (mini programs pass `ArrayBuffer`)
- Keep provider-specific code inside the provider directory so unused entries/operations are tree-shaken

### Signatures
- Each provider signer must stay byte-identical to its official SDK: `src/aws/signature.ts` (SigV4, `UNSIGNED-PAYLOAD`), `src/cos/signature.ts` (COS V5), `src/obs/signature.ts` (OBS "obs" scheme), `src/azure/signature.ts` (SharedKey). The oracle tests (`test/cos-signature.spec.ts`, `test/obs-signature.spec.ts`, `test/aws-signature.spec.ts`, `npm run test:azure-oracle`) enforce this — never change a signer without them passing.

### Testing
- Vitest with Playwright browser provider (chromium), config in `vitest.config.ts`
- Tests use `describe` and `it` blocks; assertions use `expect().toBe()`, `expect().toHaveProperty()`, etc.
- Integration specs require the test server on :8080 with credentials from `.env`; signature/unit specs (e.g., `test/*-signature.spec.ts`, `test/digest.spec.ts`) do not
- Test server (`test/server.ts`, Hono) exposes `/api/oss-config`, `/api/cos-config`, `/api/obs-config`, `/api/aws-config`, `/api/azure-config` and `/api/sts` (ali-oss STS emulation)

### Linting Rules
- Oxlint configuration in `oxlint.json`
- Disabled rules: `no-cond-assign`, `no-plusplus`, `no-bitwise`
- Staged files auto-fixed on commit via husky/lint-staged

## Key Files

- `src/protocol.ts` - The `Protocol` interface (request/signUrl plus provider constants) shared by every provider
- `src/provider.ts` - The `tiny-oss/protocol` entry: operation factories (`createPut`, `createMultipartUpload`, …) and shared request helpers (`normalizeOptions`, `resolveTimeout`, `dataSize`)
- `src/ops/` - One file per operation factory (`put.ts`, `multipartUpload.ts`, `initMultipartUpload.ts`, `uploadPart.ts`, `completeMultipartUpload.ts`, `abortMultipartUpload.ts`, `listParts.ts`, `listUploads.ts`, `uploadPartCopy.ts`, `putSymlink.ts`, `signatureUrl.ts`, `bindOptions.ts`)
- `src/<provider>/` - Provider implementations: `signature.ts`, `host.ts`, `request.ts`, `signatureUrl.ts`, `index.ts` (AWS adds `sha256.ts`; Azure adds `multipart.ts` for block-blob primitives)
- `src/transport.ts` + `src/transports/` - Injectable network layer (XHR default, fetch, wx)
- `src/types.ts` - Public type definitions (`TinyOSS` namespace)
- `src/utils/`, `src/digest.ts` - Shared helpers (assertOptions, MD5, UTF-8, XML parsing, hashing)
- `src/index.ts` - OSS entry point (default)
- `test/` - Vitest specs, integration specs, `test-types-*.ts`, Hono test server (`server.ts`)
- `vite.config.ts` + `vite.<provider>.config.ts` - One lib build per entry, output to `dist/`

## Integration Points

- All uploads and signed URLs are compatible with each vendor's REST API; S3-compatible stores (MinIO, R2, GCS) use the AWS entry with `endpoint` + `pathStyle`
- All signing is native; the only server-side dependency is the test server's ali-oss STS emulation
- Prefer minimal, tree-shakeable solutions; follow the patterns in `src/ops/` and `src/<provider>/`
