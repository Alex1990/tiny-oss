# Upgrading to 1.0

This guide walks through migrating a tiny-oss 0.x application (latest release: 0.5.1) to 1.0.0.

tiny-oss 1.0 replaces the class-based API with a functional API. The `TinyOSS` class, the `new TinyOSS(...)` constructor and the `TinyOSS.*` namespace types are gone: every operation is a standalone function that takes the client options as its first argument, and all public types are top-level named exports. The SDK also grows from browser-only Aliyun OSS to multi-provider, multi-environment support — Tencent Cloud COS, Huawei Cloud OBS, AWS S3, Azure Blob Storage, plus Node.js, Service Workers and WeChat mini programs.

## Quick migration

Before (0.x):

```js
import TinyOSS from 'tiny-oss';

const oss = new TinyOSS({
  accessKeyId: 'your accessKeyId',
  accessKeySecret: 'your accessKeySecret',
  stsToken: 'security token',
  region: 'oss-cn-beijing',
  bucket: 'your bucket',
});

await oss.put('hello-world', blob);
```

After (1.0):

```js
import { put } from 'tiny-oss';

const options = {
  accessKeyId: 'your accessKeyId',
  accessKeySecret: 'your accessKeySecret',
  stsToken: 'security token',
  region: 'oss-cn-beijing',
  bucket: 'your bucket',
};

await put(options, 'hello-world', blob);
```

If you call operations from many places, `bindOptions` keeps the credentials in one place:

```js
import { put, bindOptions } from 'tiny-oss';

const upload = bindOptions(put, {
  accessKeyId: 'your accessKeyId',
  accessKeySecret: 'your accessKeySecret',
  region: 'oss-cn-beijing',
  bucket: 'your bucket',
});

await upload('hello-world', blob);
```

## Breaking changes

### 1. The `TinyOSS` class is removed

| 0.x | 1.0 |
| --- | --- |
| `oss.put(name, blob)` | `put(options, name, blob)` |
| `oss.putSymlink(name, target)` | `putSymlink(options, name, target)` |
| `oss.signatureUrl(name, opts)` | `signatureUrl(options, name, opts)` |

The options object is now required on every call, unless you bind it once with `bindOptions`. Other operations that were never on the 0.x class — the multipart and listing functions — use the same `options`-first convention.

### 2. Types are top-level named exports

Before:

```ts
import TinyOSS from 'tiny-oss';

const options: TinyOSS.TinyOSSOptions = { /* ... */ };
```

After:

```ts
import { put, type Options, type PutOptions, type Progress, type SignatureUrlOptions } from 'tiny-oss';
```

`TinyOSSOptions` is renamed to `Options`. The `Progress` type is new.

### 3. Progress callback shape changed

0.x passed the native `ProgressEvent`; 1.0 passes a plain object:

```ts
interface Progress {
  loaded: number;
  total: number;
  lengthComputable: boolean;
}
```

`lengthComputable` can be `false` for transports without native progress reporting (fetch, wx.request); those adapters fire a 0% event before sending and a 100% event after.

### 4. Input data widened

0.x accepted `Blob` only; 1.0 accepts `Blob | ArrayBuffer | Uint8Array | string`. WeChat mini programs pass `ArrayBuffer`.

### 5. Node.js and WeChat users must pick a transport

The default transport is `XMLHttpRequest` (browsers). In Node.js / Service Workers:

```js
import { put, setTransport, fetchTransport } from 'tiny-oss';

setTransport(fetchTransport);
```

In WeChat mini programs:

```js
import { put, setTransport, wxRequestTransport } from 'tiny-oss';

setTransport(wxRequestTransport);
```

### 6. Provider entry points

0.x was Aliyun OSS only, imported from the package root. 1.0 keeps OSS at the root and adds per-provider entries:

- `tiny-oss` — Aliyun OSS
- `tiny-oss/cos` — Tencent Cloud COS
- `tiny-oss/obs` — Huawei Cloud OBS
- `tiny-oss/aws` — AWS S3 and S3-compatible stores (MinIO, Cloudflare R2, Google Cloud Storage)
- `tiny-oss/azure` — Azure Blob Storage
- `tiny-oss/protocol` — the protocol layer for building custom providers

Each entry exports its own `setTransport`, `getTransport`, `bindOptions` and its operation types by name.

### 7. `Options` gained a field

`pathStyle?: boolean` — S3-style path addressing (bucket in the URL path), required for S3-compatible endpoints such as MinIO and Cloudflare R2. Ignored by OSS.

### 8. `secure` now defaults to `true`

0.x defaulted to `http://`; every 1.0 entry — OSS, COS, OBS, AWS, Azure — now defaults to HTTPS for requests and signed URLs. Pass `secure: false` explicitly when you connect to an HTTP-only endpoint (e.g. a local MinIO server).

### 9. `region` no longer has a default

0.x defaulted to `oss-cn-hangzhou`, and early 1.0 builds carried per-provider region defaults (`cn-north-4` for OBS, `us-east-1` for AWS). tiny-oss now ships no region default at all: every provider requires either `region` or `endpoint`, and omitting both throws `options.region is required (or set options.endpoint)`. If you relied on a default region, add `region` (or `endpoint`) to your options.

## New capabilities (no migration needed)

1.0 adds operations 0.x never had:

- `multipartUpload`, `initMultipartUpload`, `uploadPart`, `completeMultipartUpload`, `abortMultipartUpload`
- `listParts`, `listUploads`, `uploadPartCopy`

and two helpers: `bindOptions` (bind credentials to an operation once) and `setTransport`/`getTransport` (swap the network layer).

## Notes

- `put` still resolves to the parsed response body.
- All 0.x option fields (`accessKeyId`, `accessKeySecret`, `stsToken`, `bucket`, `endpoint`, `region`, `internal`, `secure`, `timeout`, `cname`) keep their meaning; the `secure` and `region` defaults did change — see items 8 and 9 above.
