# tiny-oss

专注于上传的极简对象存储 SDK：同一套核心 API 覆盖阿里云 OSS、腾讯云 COS、华为云 OBS、AWS S3（含 S3 兼容存储）与 Azure Blob Storage；支持浏览器、Node.js、Service Worker 与微信小程序；可通过自定义 provider 扩展。完整入口约 11kb (min+gzipped)——按需导入时 tree-shaking 会剔除未使用的操作，产物更小。

**[English](README.md) | 简体中文**

## 支持的存储服务

- [AWS S3（`tiny-oss/aws`）](#aws-s3) — SigV4 签名；同样适用于 S3 兼容存储，如 [MinIO、Cloudflare R2、Google Cloud Storage](#s3-compatible-stores-minio-cloudflare-r2-google-cloud-storage-)
- [阿里云 OSS（`tiny-oss`）](#使用) — 默认入口
- [腾讯云 COS（`tiny-oss/cos`）](#腾讯云-cos)
- [华为云 OBS（`tiny-oss/obs`）](#华为云-obs)
- [Azure Blob Storage（`tiny-oss/azure`）](#azure-blob-storage)

## 安装

pnpm

```sh
pnpm add tiny-oss
```

Npm

```sh
npm install tiny-oss
```

Yarn

```sh
yarn add tiny-oss
```

## 使用

每个操作都是独立函数，客户端配置作为第一个参数。只导入你需要的函数，打包器会摇树剔除其余代码——例如只调用 `put` 的打包产物不会包含分片上传相关代码。

### 基础使用

```js
import { put } from 'tiny-oss';

const blob = new Blob(['hello world'], { type: 'text/plain' });

// 上传
put(
  {
    accessKeyId: 'your accessKeyId',
    accessKeySecret: 'your accessKeySecret',
    // 推荐在浏览器端使用 stsToken 参数
    stsToken: 'security token',
    region: 'oss-cn-beijing',
    bucket: 'your bucket'
  },
  'hello-world',
  blob
);
```

可用函数：`put`、`putSymlink`、`signatureUrl`、`initMultipartUpload`、`uploadPart`、`completeMultipartUpload`、`abortMultipartUpload`、`listParts`、`listUploads`、`uploadPartCopy`、`multipartUpload`、`bindOptions`。

类型通过具名导入使用：`import { put, type TinyOSS } from 'tiny-oss'`。

### 绑定选项参数

如果不想每次调用都传认证等配置，可以用 `bindOptions` 绑定一次。它只引用你传入的操作函数，不会影响 tree shaking：

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

### 上传进度

你可以指定最后一个参数用于监听上传进度：

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

更多配置参数或方法参考 [API](#api)。

### 协议

`Protocol` 接口（`tiny-oss/protocol`）：

| 字段 | 含义 |
|---|---|
| `request(options, params)` | 签名并发送单个请求（走已配置的 transport），resolve `{ data, headers, status, statusText }` |
| `signUrl(options, objectName, urlOptions)` | 生成签名下载 URL |
| `metaPrefix` | 对象元数据头前缀，如 `'x-my-meta-'` |
| `copySourceHeader` / `copySourceRangeHeader` | `uploadPartCopy` 用的拷贝源头名 |
| `listUploadsMarkerKey` | 分页 marker 的 query 键（OSS 风格 `'marker'`、S3 风格 `'key-marker'`） |
| `supportsSymlink` | 是否导出 `putSymlink`（无软链接接口时置 `false`） |

`request` 收到 `{ verb, objectName, contentMd5, headers, subResource, data, timeout, onprogress }`；`subResource` 是操作拼好的 query 参数表（如 `{ uploads: '' }`、`{ partNumber, uploadId }`）——哪些参数参与签名由 request 实现决定。

共享辅助 `normalizeOptions`、`resolveTimeout`、`dataSize`（同样从 `tiny-oss/protocol` 导出）为 request 实现提供选项默认值、超时与载荷大小计算。由于每个入口独立构建，自定义 provider 不会撑大 OSS 产物——从自己的文件 import 即可。

### 兼容性

应该在大部分浏览器都能正常运行，也支持 Node.js、Service Worker 与微信小程序（见[非浏览器环境](#非浏览器环境)）。

这个包依赖一些现代 Web APIs，比如 [Blob](https://developer.mozilla.org/zh-CN/docs/Web/API/Blob), [Uint8Array](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array), [Promise](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Promise). 浏览器端默认使用 `XMLHttpRequest` 发起请求；其他环境可注入自己的传输层（见下）。

### 非浏览器环境

网络层是可注入的。浏览器默认使用 `XMLHttpRequest`；Service Worker 和微信小程序有现成的适配器：

```js
// Service Worker（或 Node.js）
import { setTransport, fetchTransport } from 'tiny-oss';
setTransport(fetchTransport);

// 微信小程序
import { setTransport, wxRequestTransport } from 'tiny-oss';
setTransport(wxRequestTransport);
```

输入数据支持 `Blob`、`ArrayBuffer`、`Uint8Array`、字符串四种类型（小程序没有 Blob，请传 `ArrayBuffer`）。

#### 微信小程序上传

```js
import { put, multipartUpload } from 'tiny-oss';

const arrayBuffer = getFileArrayBuffer(); // 例如 FileSystemManager.readFile 的结果

put(options, 'photo.jpg', arrayBuffer);
multipartUpload(options, 'video.mp4', arrayBuffer, { partSize: 1024 * 1024 });
```

#### 自定义 transport

其他环境可以给 `setTransport` 传入自己的函数。它接收 `(url, { method, headers, data, timeout, onprogress, total })`，必须 resolve 为 `{ data, headers, status, statusText }`，失败时 reject：

```js
setTransport(async (url, { method, headers, data, timeout }) => {
  // 适配你的平台的请求 API
});
```

#### 进度事件

`onprogress` 回调收到 `{ loaded, total, lengthComputable }`。浏览器上报真实的上传进度（`lengthComputable: true`）。`fetch` 和 `wx.request` 无法上报中间进度，这类适配器会在发送前触发一次 `0%`、完成后触发一次 `100%` 事件，`lengthComputable: false`——可用于切换"上传中"状态，不要用来渲染百分比。

## 供应商

### AWS S3

同一套操作通过独立入口支持 AWS S3（`tiny-oss/aws`）。每个入口自包含：按需导入即可让 OSS 产物不携带 COS/OBS/S3 签名代码（反之亦然）。

```js
import { put, multipartUpload, signatureUrl } from 'tiny-oss/aws';

put(
  {
    accessKeyId: '你的 Access Key ID',
    accessKeySecret: '你的 Secret Access Key',
    // 推荐在浏览器端使用 stsToken 参数
    stsToken: 'security token',
    region: 'us-west-2',
    bucket: 'your-bucket'
  },
  'hello-world',
  blob
);
```

AWS 入口导出与 OSS 入口相同的全部函数，唯独没有 `putSymlink`（S3 无软链接接口）。options 字段对应关系：

| option | OSS | AWS S3 |
|---|---|---|
| `accessKeyId` | 阿里云 AccessKeyId | AWS Access Key ID |
| `accessKeySecret` | 阿里云 AccessKeySecret | AWS Secret Access Key |
| `region` | `oss-cn-beijing` | 如 `us-east-1`、`ap-southeast-1` |
| `bucket` | `my-bucket` | 普通 bucket 名 |
| `stsToken` | OSS STS token | AWS 临时密钥 SessionToken（`x-amz-security-token`） |
| `endpoint` / `secure` / `timeout` | 相同 | 相同 |

注意事项：

- 浏览器上传 S3 需要在存储桶配置跨域规则（允许你的站点并暴露 `ETag` 响应头以支持分片上传），推荐使用临时密钥（STS）而非永久密钥。
- 签名器实现 SigV4 并使用 `UNSIGNED-PAYLOAD`（官方 SDK 对 S3 默认不签名 body），与 `aws-sdk` v2 逐字节一致。
- 签名对时间敏感，客户端时钟偏差会导致 403 `RequestTimeTooSkewed`。

#### S3 兼容存储（MinIO、Cloudflare R2、Google Cloud Storage 等）

S3 兼容存储使用 SigV4，`tiny-oss/aws` 入口**零额外代码**即可接入——只需把 `endpoint` 指向存储并开启 `pathStyle`（这类存储把 bucket 放在 URL 路径中，对应官方 SDK 的 `forcePathStyle`）：

```js
import { put, signatureUrl, multipartUpload } from 'tiny-oss/aws';

// MinIO
await put(
  {
    accessKeyId: 'minioadmin',
    accessKeySecret: 'minioadmin',
    region: 'us-east-1',
    bucket: 'my-bucket',
    endpoint: 'minio.example.com', // 不要带协议前缀
    pathStyle: true,
  },
  'hello-world',
  blob
);

// Cloudflare R2 —— region 固定为 'auto'
await put(
  {
    accessKeyId: '你的 R2 Access Key ID',
    accessKeySecret: '你的 R2 Secret Access Key',
    region: 'auto',
    bucket: 'my-bucket',
    endpoint: '<accountid>.r2.cloudflarestorage.com',
    pathStyle: true,
  },
  'hello-world',
  blob
);

// Google Cloud Storage —— XML API 的 AWS SigV4 兼容模式。
// 先在控制台创建 HMAC key；region 固定为 'auto'。
await put(
  {
    accessKeyId: '你的 GCS HMAC Access ID',
    accessKeySecret: '你的 GCS HMAC Secret',
    region: 'auto',
    bucket: 'my-bucket',
    endpoint: 'storage.googleapis.com',
    pathStyle: true,
  },
  'hello-world',
  blob
);
```

`endpoint` 不能带协议前缀（`http://`/`https://`）——由 `secure` 选项决定。所有操作（上传、分片、列举、拷贝、签名 URL）在这些存储上原样可用。

并非所有存储都讲 S3 方言：Azure Blob Storage 使用自成一派的 SharedKey 签名与不同的分片模型（Block Blob），不在 AWS 入口覆盖范围内。

### 腾讯云 COS

同一套操作通过独立入口支持腾讯云 COS。OSS 入口完全不引用 COS 代码，反之亦然——按需导入即可让 OSS 产物不携带 COS 签名代码（反之亦然）。

```js
import { put, multipartUpload, signatureUrl } from 'tiny-oss/cos';

put(
  {
    accessKeyId: '你的 SecretId',
    accessKeySecret: '你的 SecretKey',
    // 推荐在浏览器端使用 stsToken 参数
    stsToken: 'security token',
    region: 'ap-guangzhou',
    bucket: 'your-bucket-1250000000' // COS 的 bucket 名必须带 APPID 后缀
  },
  'hello-world',
  blob
);
```

COS 入口导出与 OSS 入口相同的全部函数，唯独没有 `putSymlink`（COS 无软链接接口）。options 字段对应关系：

| option | OSS | COS |
|---|---|---|
| `accessKeyId` | 阿里云 AccessKeyId | 腾讯云 SecretId |
| `accessKeySecret` | 阿里云 AccessKeySecret | 腾讯云 SecretKey |
| `region` | `oss-cn-beijing` | 如 `ap-guangzhou` |
| `bucket` | `my-bucket` | 必须带 APPID 后缀，如 `examplebucket-1250000000` |
| `stsToken` | OSS STS token | COS 临时密钥 SecurityToken（`x-cos-security-token`） |
| `endpoint` / `secure` / `timeout` | 相同 | 相同 |

注意事项：

- 与 OSS 一样，浏览器上传 COS 需要在存储桶配置跨域规则，并推荐使用临时密钥（CAM STS）而非永久密钥。
- 分片上传需要存储桶 CORS 规则暴露 `ETag` 响应头。
- COS 签名对时间敏感，客户端时钟偏差会导致 403 `RequestTimeTooSkewed`。

### 华为云 OBS

同一套操作通过独立入口支持华为云 OBS（`tiny-oss/obs`）。每个入口自包含：按需导入即可让 OSS 产物不携带 COS/OBS 签名代码（反之亦然）。

```js
import { put, multipartUpload, signatureUrl } from 'tiny-oss/obs';

put(
  {
    accessKeyId: '你的 Access Key Id',
    accessKeySecret: '你的 Secret Access Key',
    // 推荐在浏览器端使用 stsToken 参数
    stsToken: 'security token',
    region: 'cn-north-4',
    bucket: 'your-bucket' // OBS 的 bucket 名不带任何后缀
  },
  'hello-world',
  blob
);
```

OBS 入口导出与 OSS 入口相同的全部函数，唯独没有 `putSymlink`（OBS 无软链接接口）。options 字段对应关系：

| option | OSS | OBS |
|---|---|---|
| `accessKeyId` | 阿里云 AccessKeyId | 华为云 Access Key Id |
| `accessKeySecret` | 阿里云 AccessKeySecret | 华为云 Secret Access Key |
| `region` | `oss-cn-beijing` | 如 `cn-north-4`、`cn-east-3` |
| `bucket` | `my-bucket` | 普通 bucket 名（无 APPID 后缀） |
| `stsToken` | OSS STS token | OBS 临时密钥 SecurityToken（`x-obs-security-token`） |
| `endpoint` / `secure` / `timeout` | 相同 | 相同 |

注意事项：

- 浏览器上传 OBS 需要在存储桶配置跨域规则（允许你的站点并暴露 `ETag` 响应头以支持分片上传），推荐使用临时密钥（IAM 委托）而非永久密钥。
- OBS 签名对时间敏感（`x-obs-date` 头），客户端时钟偏差会导致 403 `RequestTimeTooSkewed`。
- OBS 签名器使用 OBS 的 "obs" 签名方案，与官方 `esdk-obs-browserjs` 逐字节一致。

### Azure Blob Storage

Azure Blob Storage 不使用 SigV4，也不使用以上任何签名方案：它使用自成一派的 **SharedKey** 授权，分片模型也不同（Block Blob）。专用入口（`tiny-oss/azure`）实现了这两点，API 保持一致：

```js
import { put, multipartUpload, signatureUrl } from 'tiny-oss/azure';

put(
  {
    accessKeyId: '你的存储账号名',
    accessKeySecret: '你的 base64 账号密钥',
    bucket: 'your-container'
  },
  'hello-world',
  blob
);
```

Azure 入口导出 `put`、`signatureUrl`、`initMultipartUpload`、`uploadPart`、`completeMultipartUpload`、`multipartUpload` 与 `bindOptions`。选项映射：

| option | OSS | Azure Blob |
|---|---|---|
| `accessKeyId` | 阿里云 AccessKeyId | 存储账号名 |
| `accessKeySecret` | 阿里云 AccessKeySecret | **base64 编码**的账号密钥（SharedKey 要求先 base64 解码再签名） |
| `bucket` | `my-bucket` | 容器名 |
| `region` | `oss-cn-beijing` | 不使用（Blob 服务无 region 概念） |
| `stsToken` | OSS STS token | 不使用（改用 SAS 或存储访问策略） |
| `endpoint` / `secure` / `timeout` | 相同 | 相同（`secure` 默认为 `true`） |

说明：

- 每个请求都带 `x-ms-date` 与 `x-ms-version`；StringToSign 采用 12 字段 SharedKey 格式，含 canonicalized `x-ms-*` 头与 canonicalized resource，与 `@azure/storage-common` 及 MSDN 官方示例逐字节一致（由 `npm run test:azure-oracle` 持续验证）。
- `signatureUrl` 返回 service SAS（`sv=2020-12-06`、`sr=b`），与 `@azure/storage-blob` 的 `generateBlobSASQueryParameters` 逐字节一致；立即生效，`method: 'PUT'` 授予写权限。
- `multipartUpload` 走 Azure 的 Block Blob 模型：并行 `Put Block`（`?comp=block&blockid=<base64>`）+ 一次 `Put Block List`（`?comp=blocklist`）提交。Azure 没有服务端上传会话，因此 `abortMultipartUpload`、`listParts`、`listUploads`、`uploadPartCopy` 有意缺席。
- 传给 `multipartUpload` 的 meta 在最终的 Put Block List 上生效（Azure 在该请求设置 blob 元数据）。
- 浏览器上传需要在容器配置跨域规则（允许你的站点并暴露 `ETag` 响应头以支持分片上传）。
- 只在 HTTPS 下使用 SharedKey/SAS 流程；账号密钥是根凭据——面向用户场景优先使用服务端生成的 SAS。

## 扩展

每个操作都是基于 `Protocol` 的工厂——这就是扩展点。接入一个新存储只需要实现两个函数（`request`、`signUrl`）并填写五个常量，所有操作（上传、分片、列举、拷贝……）即全部可用。内置实现是最佳参考配方：`src/cos/`、`src/obs/`、`src/aws/`（S3 形态，各自带签名器）与 `src/azure/`（非 S3 形态——接口见[协议](#协议)章节）。

### 组装自定义 provider

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
    // 1. 拼 URL：host + '/' + objectName + 子资源 query
    // 2. 签名：由 verb/日期/头/query 计算你的 Authorization 头
    // 3. return getTransport()(url, { method, headers, data, timeout });
    //    （import { getTransport } from 'tiny-oss'）
  },
  signUrl(options, objectName, urlOptions) { /* 签名 URL 字符串 */ },
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

### 向仓库贡献 provider

参照 `src/aws/` 布局：`src/<provider>/{signature,host,request,signatureUrl,index}.ts`，然后加 Vite 构建（`vite.<provider>.config.ts`）、`package.json` 的 `exports` 条目与 `build:types:<provider>`。签名必须与官方 SDK 对齐——`test/cos-signature.spec.ts`、`test/obs-signature.spec.ts`、`test/aws-signature.spec.ts` 用各自官方 SDK 作 oracle 钉死签名器。

如果目标存储的分片接口不是 S3 形态（如 Azure 的 Block Blob），不要强行套 `createInitMultipartUpload`/`createUploadPart`/`createCompleteMultipartUpload`：写同签名的 provider 专用原语，经 `createMultipartUpload` 注入（见 `src/azure/multipart.ts`）。没有对应 API 的操作（如 Azure 的 `listUploads`）直接从入口省略。

## API

### options

每个操作的第一个参数。只有 `accessKeyId` 与 `accessKeySecret` 必填，其余均可选：

```ts
interface TinyOSSOptions {
  accessKeyId: string;        // 你的阿里云 AccessKeyId
  accessKeySecret: string;    // 你的阿里云 AccessKeySecret
  stsToken?: string;          // 临时凭证（浏览器端推荐使用）
  bucket?: string;            // 要访问的 bucket
  endpoint?: string;          // OSS 地域域名，优先于 region
  region?: string;            // bucket 所在地域，默认为 'oss-cn-hangzhou'
  internal?: boolean;         // 是否通过阿里云内网访问，默认为 false
  secure?: boolean;           // 使用 HTTPS（true）还是 HTTP（false），默认为 false
  timeout?: string | number;  // 所有操作的实例级超时，默认为 60s
  cname?: boolean;            // 使用自定义域名
  pathStyle?: boolean;        // S3 风格路径寻址（bucket 放在 URL 路径中）；S3 兼容端点（如 MinIO、Cloudflare R2）需要开启
}
```

### put(options, objectName, blob, putOptions)

上传。

```ts
put(
  options: TinyOSS.TinyOSSOptions,
  objectName: string,
  blob: TinyOSS.BlobLike | string, // BlobLike = Blob | ArrayBuffer | Uint8Array
  putOptions?: TinyOSS.PutOptions  // { onprogress?: (e: TinyOSS.Progress) => any }
): Promise<any>
```

#### 参数

* **options** (Object)：客户端配置，见上。
* **objectName** (String)：对象名称。
* **blob** (Blob|File|ArrayBuffer|Uint8Array|String)：被上传的对象。
* **putOptions?** (Object)：可选的上传选项。
  + **onprogress?** (Function)：上传进度事件监听器，接受一个 [progress event](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/progress_event) 对象作为参数。

#### 返回值

* **(Promise)**

### putSymlink(options, objectName, targetObjectName)

创建一个软链接。

```ts
putSymlink(
  options: TinyOSS.TinyOSSOptions,
  objectName: string,
  targetObjectName: string
): Promise<any>
```

#### 参数

* **options** (Object)：客户端配置，见上。
* **objectName** (String)：软链接对象名称。
* **targetObjectName** (String)：软链接目标对象名称。

#### 返回值

* **(Promise)**

### signatureUrl(options, objectName, urlOptions)

获取一个签名的 URL，可用于下载文件。

```ts
signatureUrl(
  options: TinyOSS.TinyOSSOptions,
  objectName: string,
  urlOptions?: TinyOSS.SignatureUrlOptions // { expires?: number; method?: HTTPMethods; response?: ResponseHeaderType }
): string
```

#### 参数

* **options** (Object)：客户端配置，见上。
* **objectName** (String)：对象名称。
* **urlOptions?** (Object)：可选的签名选项。
  + **expires?** (Number)：URL 过期时间（单位：秒），默认为 1800。

#### 返回值

* **(String)**

## 许可证协议

MIT
