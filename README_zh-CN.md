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

### 基础使用

```js
const oss = new TinyOSS({
  accessKeyId: 'your accessKeyId',
  accessKeySecret: 'your accessKeySecret',
  // 推荐在浏览器端使用 stsToken 参数
  stsToken: 'security token',
  region: 'oss-cn-beijing',
  bucket: 'your bucket'
});

const blob = new Blob(['hello world'], { type: 'text/plain' });

// 上传
oss.put('hello-world', blob);
```

### 上传进度

你可以指定第三个参数用于监听上传进度：

```js
// Upload progress
oss.put('hello-world', blob, {
  onprogress (e) {
    console.log('total: ', e.total, ', uploaded: ', e.loaded);
  }
});
```

### 函数式 API（支持 tree shaking）

每个操作也都以独立函数形式导出，客户端配置作为第一个参数。只导入你需要的函数，打包器会摇树剔除其余代码——例如只调用 `put` 的打包产物不会包含分片上传相关代码：

```js
import { put } from 'tiny-oss';

put(
  {
    accessKeyId: 'your accessKeyId',
    accessKeySecret: 'your accessKeySecret',
    // 建议在浏览器中使用 stsToken
    stsToken: 'security token',
    region: 'oss-cn-beijing',
    bucket: 'your bucket'
  },
  'hello-world',
  new Blob(['hello world'], { type: 'text/plain' })
);
```

可用函数：`put`、`putSymlink`、`signatureUrl`、`initMultipartUpload`、`uploadPart`、`completeMultipartUpload`、`abortMultipartUpload`、`listParts`、`listUploads`、`uploadPartCopy`、`multipartUpload`。每个函数与同名类方法行为一致，仅多了一个置于首位的客户端配置参数。

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

更多配置参数或方法参考 [API](#api)。

## 兼容性

应该在大部分浏览器都能正常运行。

这个包依赖一些现代 Web APIs，比如 [Blob](https://developer.mozilla.org/zh-CN/docs/Web/API/Blob), [Uint8Array](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array), [FileReader](https://developer.mozilla.org/zh-CN/docs/Web/API/FileReader), [Promise](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Promise).

## 接口

```js
new TinyOSS(options)
```

### options

请参考[Browser.js 官方文档](https://help.aliyun.com/document_detail/64095.html?spm=a2c4g.11186623.6.1122.27976928XhTpTr)关于配置项的说明。

* accessKeyId
* accessKeySecret
* stsToken
* bucket
* endpoint
* region
* secure
* timeout

### put(objectName, blob, options)

上传。

#### 参数

* **objectName (String)**：对象名称。
* **blob (Blob|File)**: 被上传的对象。
* **[options (Object)]**
  + **[onprogress (Function)]**: 上传进度事件监听器，接受一个 [progress event](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/progress_event) 对象作为参数。

#### 返回值

* **(Promise)**

### putSymlink(objectName, targetObjectName)

创建一个软链接。

#### 参数

* **objectName (String)**: 软链接对象名称。
* **targetObjectName (String)**: 软链接目标对象名称。

#### 返回值

* **(Promise)**

### signatureUrl(objectName, options)

获取一个签名的 URL，可用于下载文件。

#### 参数

* **objectName (String)**: 对象名称。
* **[options (Object)]**:
  + **[options.expires (Number)]**: URL 过期时间（单位：秒）。

#### 返回值

* **(String)**

## 许可证协议

MIT
