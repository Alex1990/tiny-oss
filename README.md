# tiny-oss

A tiny aliyun oss sdk for browser. Less than 10kb (min+gzipped).

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

```js
const oss = new TinyOSS({
  accessKeyId: 'your accessKeyId',
  accessKeySecret: 'your accessKeySecret',
  // Recommend to use the stsToken option in browser
  stsToken: 'security token',
  region: 'oss-cn-beijing',
  bucket: 'your bucket'
});

const blob = new Blob(['hello world'], { type: 'text/plain' });

// Upload
oss.put('hello-world', blob);
```

More options or methods see [API](#api).

## Compatibility

This package depends on some modern Web APIs, such as [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob), [Uint8Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array), [FileReader](https://developer.mozilla.org/en-US/docs/Web/API/FileReader), [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise).

So, it should work in the below browsers.

* Chrome >= 20
* Edge >= 12
* IE >= 10
* Firefox >= 4
* Safari >= 8
* Opera >= 11
* Android >= 4.4.4
* iOS >= 8

**For IE and low version FireFox, you should import a promise polyfill, such as [es6-promise](https://github.com/stefanpenner/es6-promise)**.

## API

```js
new TinyOSS(options)
```

### options

Please check [Browser.js offical document](https://help.aliyun.com/document_detail/64095.html?spm=a2c4g.11186623.6.1122.27976928XhTpTr).

* accessKeyId
* accessKeySecret
* stsToken
* bucket
* endpoint
* region
* secure
* timeout

### put(objectName, blob)

Upload the blob.

#### Arguments

* **objectName (String)**: The object name.
* **blob (Blob|File)**: The object to be uploaded.

#### Return

* **(Promise)**

### signatureUrl(objectName, options)

Get a signature url to download the file.

#### Arguments

* **objectName (String)**: The object name.
* **[options (Object)]**:
  + **[options.expires (Number)]**: The url expires (unit: seconds).

#### Return

* **(String)**

## LICENSE

MIT
