# tiny-oss

用于浏览器端的阿里云 OSS 极简版 SDK，专注于上传功能。小于 10kb (min+gzipped)。

**[English](README.md) | 简体中文**

## 安装

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

### 绑定配置一次

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

## 兼容性

应该在大部分浏览器都能正常运行。

这个包依赖一些现代 Web APIs，比如 [Blob](https://developer.mozilla.org/zh-CN/docs/Web/API/Blob), [Uint8Array](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array), [Promise](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Promise). 浏览器端默认使用 `XMLHttpRequest` 发起请求；其他环境可注入自己的传输层（见下）。

## 非浏览器环境

网络层是可注入的。浏览器默认使用 `XMLHttpRequest`；Service Worker 和微信小程序有现成的适配器：

```js
// Service Worker（或 Node.js）
import { setTransport, fetchTransport } from 'tiny-oss';
setTransport(fetchTransport);

// 微信小程序
import { setTransport, wxRequestTransport } from 'tiny-oss';
setTransport(wxRequestTransport);
```

输入数据支持 `Blob`、`ArrayBuffer`、`Uint8Array` 三种类型（小程序没有 Blob，请传 `ArrayBuffer`）。

### 微信小程序上传

```js
import { put, multipartUpload } from 'tiny-oss';

const arrayBuffer = getFileArrayBuffer(); // 例如 FileSystemManager.readFile 的结果

put(options, 'photo.jpg', arrayBuffer);
multipartUpload(options, 'video.mp4', arrayBuffer, { partSize: 1024 * 1024 });
```

### 自定义 transport

其他环境可以给 `setTransport` 传入自己的函数。它接收 `(url, { method, headers, data, timeout, onprogress, total })`，必须 resolve 为 `{ data, headers, status, statusText }`，失败时 reject：

```js
setTransport(async (url, { method, headers, data, timeout }) => {
  // 适配你的平台的请求 API
});
```

### 进度事件

`onprogress` 回调收到 `{ loaded, total, lengthComputable }`。浏览器上报真实的上传进度（`lengthComputable: true`）。`fetch` 和 `wx.request` 无法上报中间进度，这类适配器会在发送前触发一次 `0%`、完成后触发一次 `100%` 事件，`lengthComputable: false`——可用于切换"上传中"状态，不要用来渲染百分比。

## 接口

### options

每个操作的第一个参数。请参考[Browser.js 官方文档](https://help.aliyun.com/document_detail/64095.html?spm=a2c4g.11186623.6.1122.27976928XhTpTr)关于配置项的说明。

* accessKeyId
* accessKeySecret
* stsToken
* bucket
* endpoint
* region
* secure
* timeout

### put(options, objectName, blob, putOptions)

上传。

#### 参数

* **options (Object)**：客户端配置，见上。
* **objectName (String)**：对象名称。
* **blob (Blob|File)**: 被上传的对象。
* **[putOptions (Object)]**
  + **[onprogress (Function)]**: 上传进度事件监听器，接受一个 [progress event](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/progress_event) 对象作为参数。

#### 返回值

* **(Promise)**

### putSymlink(options, objectName, targetObjectName)

创建一个软链接。

#### 参数

* **options (Object)**：客户端配置，见上。
* **objectName (String)**: 软链接对象名称。
* **targetObjectName (String)**: 软链接目标对象名称。

#### 返回值

* **(Promise)**

### signatureUrl(options, objectName, urlOptions)

获取一个签名的 URL，可用于下载文件。

#### 参数

* **options (Object)**：客户端配置，见上。
* **objectName (String)**: 对象名称。
* **[urlOptions (Object)]**:
  + **[expires (Number)]**: URL 过期时间（单位：秒）。

#### 返回值

* **(String)**

## 许可证协议

MIT
