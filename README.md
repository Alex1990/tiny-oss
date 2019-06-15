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
