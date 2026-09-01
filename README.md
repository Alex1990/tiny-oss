# tiny-oss

A tiny aliyun oss sdk for browser which focus on uploading. Less than 10kb (min+gzipped). Also ships Tencent Cloud COS (`tiny-oss/cos`), Huawei Cloud OBS (`tiny-oss/obs`), AWS S3 (`tiny-oss/aws`) and Azure Blob Storage (`tiny-oss/azure`) entry points with the same API — see [Tencent Cloud COS](#tencent-cloud-cos), [Huawei Cloud OBS](#huawei-cloud-obs), [AWS S3](#aws-s3) and [Azure Blob Storage](#azure-blob-storage).

**English | [简体中文](README_zh-CN.md)**

## Installation

Npm

```sh
npm install tiny-oss
```

Yarn

```sh
yarn add tiny-oss
```

## Usage

Every operation is a standalone function taking the client options as the first argument. Import only what you use and bundlers tree-shake the rest, so a bundle that only calls `put` does not carry the multipart code.

### Basic

```js
import { put } from 'tiny-oss';

const blob = new Blob(['hello world'], { type: 'text/plain' });

// Upload
put(
  {
    accessKeyId: 'your accessKeyId',
    accessKeySecret: 'your accessKeySecret',
    // Recommend to use the stsToken option in browser
    stsToken: 'security token',
    region: 'oss-cn-beijing',
    bucket: 'your bucket'
  },
  'hello-world',
  blob
);
```

Available functions: `put`, `putSymlink`, `signatureUrl`, `initMultipartUpload`, `uploadPart`, `completeMultipartUpload`, `abortMultipartUpload`, `listParts`, `listUploads`, `uploadPartCopy`, `multipartUpload`, `bindOptions`.

Types are available via named imports: `import { put, type TinyOSS } from 'tiny-oss'`.

## Tencent Cloud COS

The same operations are available for Tencent Cloud COS through a separate entry point. The OSS entry never references COS code and vice versa, so importing only what you use keeps the OSS bundle free of COS signing code (and the other way around).

```js
import { put, multipartUpload, signatureUrl } from 'tiny-oss/cos';

put(
  {
    accessKeyId: 'your SecretId',
    accessKeySecret: 'your SecretKey',
    // Recommend to use the stsToken option in browser
    stsToken: 'security token',
    region: 'ap-guangzhou',
    bucket: 'your-bucket-1250000000' // COS bucket names include the APPID suffix
  },
  'hello-world',
  blob
);
```

The COS entry exports everything the OSS entry does except `putSymlink` (COS has no symlink API). Options map as:

| option | OSS | COS |
|---|---|---|
| `accessKeyId` | Aliyun AccessKeyId | Tencent SecretId |
| `accessKeySecret` | Aliyun AccessKeySecret | Tencent SecretKey |
| `region` | `oss-cn-beijing` | e.g. `ap-guangzhou` |
| `bucket` | `my-bucket` | must include the APPID suffix, e.g. `examplebucket-1250000000` |
| `stsToken` | OSS STS token | COS temporary-credential SecurityToken (`x-cos-security-token`) |
| `endpoint` / `secure` / `timeout` | same | same |

Notes:

- Like OSS, browser uploads to COS require a CORS rule on the bucket, and temporary credentials (CAM STS) are recommended over permanent keys.
- Set the bucket CORS rule to expose the `ETag` response header for multipart uploads.
- COS signatures are time-sensitive; a skewed client clock yields 403 `RequestTimeTooSkewed`.

## Huawei Cloud OBS

The same operations are also available for Huawei Cloud OBS through a third entry point (`tiny-oss/obs`). Each entry is self-contained: importing only what you use keeps the OSS bundle free of COS/OBS signing code and vice versa.

```js
import { put, multipartUpload, signatureUrl } from 'tiny-oss/obs';

put(
  {
    accessKeyId: 'your Access Key Id',
    accessKeySecret: 'your Secret Access Key',
    // Recommend to use the stsToken option in browser
    stsToken: 'security token',
    region: 'cn-north-4',
    bucket: 'your-bucket' // OBS bucket names carry no suffix
  },
  'hello-world',
  blob
);
```

The OBS entry exports everything the OSS entry does except `putSymlink` (OBS has no symlink API). Options map as:

| option | OSS | OBS |
|---|---|---|
| `accessKeyId` | Aliyun AccessKeyId | Huawei Cloud Access Key Id |
| `accessKeySecret` | Aliyun AccessKeySecret | Huawei Cloud Secret Access Key |
| `region` | `oss-cn-beijing` | e.g. `cn-north-4`, `cn-east-3` |
| `bucket` | `my-bucket` | plain bucket name (no APPID suffix) |
| `stsToken` | OSS STS token | OBS temporary-credential SecurityToken (`x-obs-security-token`) |
| `endpoint` / `secure` / `timeout` | same | same |

Notes:

- Browser uploads to OBS require the bucket's CORS rule to allow your origin and expose the `ETag` response header for multipart uploads; temporary credentials (IAM agency) are recommended over permanent keys.
- OBS signatures are time-sensitive (the `x-obs-date` header); a skewed client clock yields `403 RequestTimeTooSkewed`.
- The OBS signer uses the OBS "obs" signature scheme, matching the official `esdk-obs-browserjs` byte for byte.

## AWS S3

The same operations are available for AWS S3 through a fourth entry point (`tiny-oss/aws`). Each entry is self-contained: importing only what you use keeps the OSS bundle free of COS/OBS/S3 signing code and vice versa.

```js
import { put, multipartUpload, signatureUrl } from 'tiny-oss/aws';

put(
  {
    accessKeyId: 'your Access Key ID',
    accessKeySecret: 'your Secret Access Key',
    // Recommend to use the stsToken option in browser
    stsToken: 'security token',
    region: 'us-west-2',
    bucket: 'your-bucket'
  },
  'hello-world',
  blob
);
```

The AWS entry exports everything the OSS entry does except `putSymlink` (S3 has no symlink API). Options map as:

| option | OSS | AWS S3 |
|---|---|---|
| `accessKeyId` | Aliyun AccessKeyId | AWS Access Key ID |
| `accessKeySecret` | Aliyun AccessKeySecret | AWS Secret Access Key |
| `region` | `oss-cn-beijing` | e.g. `us-east-1`, `ap-southeast-1` |
| `bucket` | `my-bucket` | plain bucket name |
| `stsToken` | OSS STS token | AWS temporary-credential SessionToken (`x-amz-security-token`) |
| `endpoint` / `secure` / `timeout` | same | same |

Notes:

- Browser uploads to S3 require the bucket's CORS rule to allow your origin and expose the `ETag` response header for multipart uploads; temporary credentials (STS) are recommended over permanent keys.
- The signer implements SigV4 with `UNSIGNED-PAYLOAD` (the official SDK disables body signing for S3), so it is byte-identical to `aws-sdk` v2.
- Signatures are time-sensitive; a skewed client clock yields `403 RequestTimeTooSkewed`.

## Azure Blob Storage

Azure Blob Storage speaks neither SigV4 nor any of the other schemes above: it uses its own **SharedKey** authorization and a different multipart model (block blobs). A dedicated entry point (`tiny-oss/azure`) implements both, so the API stays the same:

```js
import { put, multipartUpload, signatureUrl } from 'tiny-oss/azure';

put(
  {
    accessKeyId: 'your storage account name',
    accessKeySecret: 'your base64 account key',
    bucket: 'your-container'
  },
  'hello-world',
  blob
);
```

The Azure entry exports `put`, `signatureUrl`, `initMultipartUpload`, `uploadPart`, `completeMultipartUpload`, `multipartUpload` and `bindOptions`. Options map as:

| option | OSS | Azure Blob |
|---|---|---|
| `accessKeyId` | Aliyun AccessKeyId | storage account name |
| `accessKeySecret` | Aliyun AccessKeySecret | the **base64** account key (used after base64-decoding, per SharedKey) |
| `bucket` | `my-bucket` | container name |
| `region` | `oss-cn-beijing` | not used (no region concept in the Blob service) |
| `stsToken` | OSS STS token | not used (use a SAS or stored access policy instead) |
| `endpoint` / `secure` / `timeout` | same | same (`secure` defaults to `true`) |

Notes:

- Every request carries `x-ms-date` and `x-ms-version`; the StringToSign is the 12-field SharedKey format with canonicalized `x-ms-*` headers and the canonicalized resource, verified byte-for-byte against `@azure/storage-common` and the MSDN example.
- `signatureUrl` returns a service SAS (`sv=2020-12-06`, `sr=b`), byte-identical to `@azure/storage-blob`'s `generateBlobSASQueryParameters`. It is valid immediately; `method: 'PUT'` grants write.
- `multipartUpload` uses Azure's block-blob model: parallel `Put Block` (`?comp=block&blockid=<base64>`) calls followed by a single `Put Block List` (`?comp=blocklist`). There is no server-side upload session, so `abortMultipartUpload`, `listParts`, `listUploads` and `uploadPartCopy` are intentionally absent.
- Metadata passed to `multipartUpload` is applied on the final Put Block List, which is where Azure sets blob metadata.
- Browser uploads require the container's CORS rule to allow your origin and expose the `ETag` response header for `multipartUpload`.
- Use the shared-key (or SAS) flow only over HTTPS; the account key is a root credential — for anything user-facing prefer a server-generated SAS.

### S3-compatible stores (MinIO, Cloudflare R2, Google Cloud Storage, …)

S3-compatible stores speak SigV4, so the `tiny-oss/aws` entry works with **zero extra code** — just point the `endpoint` at the store and enable `pathStyle` (these stores address buckets in the URL path, like the official SDK's `forcePathStyle`):

```js
import { put, signatureUrl, multipartUpload } from 'tiny-oss/aws';

// MinIO
await put(
  {
    accessKeyId: 'minioadmin',
    accessKeySecret: 'minioadmin',
    region: 'us-east-1',
    bucket: 'my-bucket',
    endpoint: 'minio.example.com', // no protocol prefix
    pathStyle: true,
  },
  'hello-world',
  blob
);

// Cloudflare R2 — region is always 'auto'
await put(
  {
    accessKeyId: 'your R2 Access Key ID',
    accessKeySecret: 'your R2 Secret Access Key',
    region: 'auto',
    bucket: 'my-bucket',
    endpoint: '<accountid>.r2.cloudflarestorage.com',
    pathStyle: true,
  },
  'hello-world',
  blob
);

// Google Cloud Storage — XML API's AWS SigV4-compatible mode.
// Create an HMAC key in the Cloud Console first; region is 'auto'.
await put(
  {
    accessKeyId: 'your GCS HMAC access id',
    accessKeySecret: 'your GCS HMAC secret',
    region: 'auto',
    bucket: 'my-bucket',
    endpoint: 'storage.googleapis.com',
    pathStyle: true,
  },
  'hello-world',
  blob
);
```

The endpoint must not carry a protocol (`http://`/`https://`) — the `secure` option selects it. Every operation (`put`, multipart, list, copy, signed URLs) works unchanged against these stores.

Not every store speaks S3: Azure Blob Storage uses its own SharedKey signing and a different multipart model (block blobs), so it is not covered by the AWS entry.

## Adding another object storage

Every operation is a factory over a `Protocol` — the extension point. A provider only has to implement two functions (`request`, `signUrl`) and fill in five constants; all operations (`put`, multipart, list, copy, …) then work unchanged. The built-in providers are the reference recipes: `src/cos/`, `src/obs/`, `src/aws/`.

The `Protocol` interface (`tiny-oss/protocol`):

| field | meaning |
|---|---|
| `request(options, params)` | Sign and send one request through the configured transport; resolve `{ data, headers, status, statusText }` |
| `signUrl(options, objectName, urlOptions)` | Build a signed download URL |
| `metaPrefix` | Object metadata header prefix, e.g. `'x-my-meta-'` |
| `copySourceHeader` / `copySourceRangeHeader` | Header names for `uploadPartCopy` |
| `listUploadsMarkerKey` | Query key for the list-uploads marker (`'marker'` OSS-style, `'key-marker'` S3-style) |
| `supportsSymlink` | Whether `putSymlink` is exported (`false` when the provider has no symlink API) |

`request` receives `{ verb, objectName, contentMd5, headers, subResource, data, timeout, onprogress }`; `subResource` is the query-parameter map the operations build (`{ uploads: '' }`, `{ partNumber, uploadId }`, …) — the request implementation decides which of them participate in the signature.

### Composing a custom provider

```js
import {
  createPut,
  createInitMultipartUpload,
  createUploadPart,
  createCompleteMultipartUpload,
  createMultipartUpload,
  createListUploads,
  type Protocol,
} from 'tiny-oss/protocol';

const myProtocol = {
  request(options, params) {
    // 1. build the URL: host + '/' + objectName + sub-resource query
    // 2. sign: compute your Authorization header from verb/date/headers/query
    // 3. return getTransport()(url, { method, headers, data, timeout });
    //    (import { getTransport } from 'tiny-oss')
  },
  signUrl(options, objectName, urlOptions) { /* signed URL string */ },
  metaPrefix: 'x-my-meta-',
  copySourceHeader: 'x-my-copy-source',
  copySourceRangeHeader: 'x-my-copy-source-range',
  listUploadsMarkerKey: 'marker',
  supportsSymlink: false,
};

const put = createPut(myProtocol);
const initMultipartUpload = createInitMultipartUpload(myProtocol);
const uploadPart = createUploadPart(myProtocol);
const completeMultipartUpload = createCompleteMultipartUpload(myProtocol);
const multipartUpload = createMultipartUpload(myProtocol, {
  initMultipartUpload,
  uploadPart,
  completeMultipartUpload,
});

export { put, multipartUpload, signatureUrl: myProtocol.signUrl };
```

The shared helpers `normalizeOptions`, `resolveTimeout` and `dataSize` (also exported from `tiny-oss/protocol`) cover option defaults, timeout and payload sizing for the `request` implementation. Because each entry is a separate build, a custom provider never inflates the OSS bundle — import it from its own file.

### Contributing a provider to the repo

Follow the `src/aws/` layout: `src/<provider>/{signature,host,request,signatureUrl,index}.ts`, then add the Vite build (`vite.<provider>.config.ts`), the `package.json` `exports` entry and `build:types:<provider>`. Signing must match the official SDK — the tests in `test/cos-signature.spec.ts`, `test/obs-signature.spec.ts` and `test/aws-signature.spec.ts` pin each signer against its official SDK as an oracle.

If the target storage's multipart API is not S3-shaped (e.g. Azure's block blobs), don't force it through `createInitMultipartUpload`/`createUploadPart`/`createCompleteMultipartUpload`: write provider-specific primitives with the same signatures and inject them via `createMultipartUpload` (see `src/azure/multipart.ts`). Operations that have no counterpart — like `listUploads` for Azure — are simply omitted from the entry.

### Binding options once

To avoid passing the credentials on every call, bind them once with `bindOptions`. It only references the operation you give it, so tree shaking is unaffected:

```js
import { put, bindOptions } from 'tiny-oss';

const upload = bindOptions(put, {
  accessKeyId: 'your accessKeyId',
  accessKeySecret: 'your accessKeySecret',
  stsToken: 'security token',
  region: 'oss-cn-beijing',
  bucket: 'your bucket'
});

upload('hello-world', new Blob(['hello world'], { type: 'text/plain' }));
```

### Upload progress

You can specify the last parameter to monitor the upload progress data:

```js
put(
  options,
  'hello-world',
  blob,
  {
    onprogress (e) {
      console.log('total: ', e.total, ', uploaded: ', e.loaded);
    }
  }
);
```

More options or methods see [API](#api).

## Compatibility

It should work in most browsers.

This package depends on some Web APIs, such as [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob), [Uint8Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array), [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise). In browsers it uses `XMLHttpRequest` for network requests; other environments inject their own transport (see below).

## Non-browser environments

The network layer is injectable. Browsers use `XMLHttpRequest` by default;
Service Workers and WeChat mini programs have ready-made adapters:

```js
// Service Worker (or Node.js)
import { setTransport, fetchTransport } from 'tiny-oss';
setTransport(fetchTransport);

// WeChat mini program
import { setTransport, wxRequestTransport } from 'tiny-oss';
setTransport(wxRequestTransport);
```

The input data types are environment agnostic: `Blob`, `ArrayBuffer` and
`Uint8Array` are all accepted (mini programs don't have `Blob`, so pass
`ArrayBuffer`).

### WeChat mini program upload

```js
import { put, multipartUpload } from 'tiny-oss';

const arrayBuffer = getFileArrayBuffer(); // e.g. from FileSystemManager.readFile

put(options, 'photo.jpg', arrayBuffer);
multipartUpload(options, 'video.mp4', arrayBuffer, { partSize: 1024 * 1024 });
```

### Custom transport

For other environments, pass your own function to `setTransport`. It receives
`(url, { method, headers, data, timeout, onprogress, total })` and must
resolve with `{ data, headers, status, statusText }`, rejecting on failure:

```js
setTransport(async (url, { method, headers, data, timeout }) => {
  // adapt to your platform's request API
});
```

### Progress events

`onprogress` receives `{ loaded, total, lengthComputable }`. Browsers report
real upload progress (`lengthComputable: true`). `fetch` and `wx.request`
cannot report intermediate progress, so those adapters fire a `0%` event
before sending and a `100%` event after, with `lengthComputable: false` — use
them to toggle a loading state, not to render a percentage.

## API

### options

The first argument of every operation. Please check [Browser.js offical document](https://help.aliyun.com/document_detail/64095.html?spm=a2c4g.11186623.6.1122.27976928XhTpTr).

* accessKeyId
* accessKeySecret
* stsToken
* bucket
* endpoint
* region
* secure
* timeout

### put(options, objectName, blob, putOptions)

Upload the blob.

#### Arguments

* **options (Object)**: The client options, see above.
* **objectName (String)**: The object name.
* **blob (Blob|File)**: The object to be uploaded.
* **[putOptions (Object)]**
  + **[onprogress (Function)]**: The upload progress event listener receiving an [progress event](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/progress_event) object as an parameter.

#### Return

* **(Promise)**

### putSymlink(options, objectName, targetObjectName)

Create a symlink.

#### Arguments

* **options (Object)**: The client options, see above.
* **objectName (String)**: The symlink object name.
* **targetObjectName (String)**: The target object name.

#### Return

* **(Promise)**

### signatureUrl(options, objectName, urlOptions)

Get a signature url to download the file.

#### Arguments

* **options (Object)**: The client options, see above.
* **objectName (String)**: The object name.
* **[urlOptions (Object)]**:
  + **[expires (Number)]**: The url expires (unit: seconds).

#### Return

* **(String)**

## LICENSE

MIT
