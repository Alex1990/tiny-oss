import ajax from './utils/ajax';
import {
  unix,
  blobToBuffer,
  assertOptions,
  getContentMd5,
  getSignature,
} from './utils';

export default class TinyOSS {
  constructor(options = {}) {
    assertOptions(options);

    this.opts = Object.assign({
      region: 'oss-cn-hangzhou',
      internal: false,
      cname: false,
      secure: false,
      timeout: 60000,
    }, options);

    const {
      bucket,
      region,
      endpoint,
      internal,
    } = this.opts;

    this.host = '';

    if (endpoint) {
      this.host = endpoint;
    } else {
      let host = bucket;
      if (internal) {
        host += '-internal';
      }
      host += `.${region}.aliyuncs.com`;
      this.host = host;
    }
  }

  put(objectName, blob) {
    return new Promise((resolve, reject) => {
      blobToBuffer(blob)
        .then((buf) => {
          const verb = 'PUT';
          const contentMd5 = getContentMd5(buf);
          const contentType = blob.type;
          const headers = {
            'Content-Md5': contentMd5,
            'Content-Type': contentType,
            'x-oss-date': new Date().toGMTString(),
          };
          const {
            bucket,
            accessKeyId,
            accessKeySecret,
          } = this.opts;
          const signature = getSignature({
            verb,
            contentMd5,
            headers,
            bucket,
            objectName,
            accessKeyId,
            accessKeySecret,
          });

          headers.Authorization = `OSS ${accessKeyId}:${signature}`;
          const protocol = this.opts.secure ? 'https' : 'http';
          const url = `${protocol}://${this.host}/${objectName}`;

          return ajax(url, {
            method: verb,
            headers,
            data: blob,
            timeout: this.opts.timeout,
          });
        })
        .then(resolve)
        .catch(reject);
    });
  }

  signatureUrl(objectName, { expires = 3600 } = {}) {
    const {
      accessKeyId,
      accessKeySecret,
      bucket,
    } = this.opts;
    const expireUnix = unix() + expires;
    const signature = getSignature({
      type: 'url',
      verb: 'GET',
      accessKeyId,
      accessKeySecret,
      bucket,
      objectName,
      expires: expireUnix,
    });
    const protocol = this.opts.secure ? 'https' : 'http';
    let url = `${protocol}://${this.host}/${objectName}`;
    url += `?OSSAccessKeyId=${accessKeyId}`;
    url += `&Expires=${expireUnix}`;
    url += `&Signature=${encodeURIComponent(signature)}`;
    return url;
  }
}
