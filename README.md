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

## LICENSE

MIT
