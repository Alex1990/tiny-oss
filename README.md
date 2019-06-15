# tiny-oss

A tiny aliyun oss sdk for browser. Less than 10kb (min+gziped).

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
  region: 'oss-cn-beijing',
  bucket: 'your bucket'
});

const blob = new Blob(['hello world'], { type: 'text/plain' });

// Upload
oss.put('hello-world', blob);
```

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

* accessKeyId
* accessKeySecret
* region
* bucket
* endpoint

### put(objectName, blob)

Upload the blob. It returns a Promise object, if the blob is uploaded, the Promise object will be resolved. It some error happened, the Promise object will be rejected with an Error.

* **objectName**: The file name.
* **blob**: The file.

### signatureUrl(objectName, options)

Get a signature url to download file.

* **objectName**: The file name.
* **options**:
  + **options.expires**: The url will be expired after `expires` seconds.

## LICENSE

MIT
