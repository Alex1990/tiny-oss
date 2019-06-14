import ajax from './utils/ajax';
import {
  blobToBuffer,
  assertOptions,
  getContentMd5,
  getAuthorization,
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
          const authorization = getAuthorization({
            verb,
            contentMd5,
            headers,
            bucket,
            objectName,
            accessKeyId,
            accessKeySecret,
          });

          headers.Authorization = authorization;
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
}
