import ajax from './utils/ajax';
import {
  unix,
  blobToBuffer,
  assertOptions,
  getContentMd5,
  getSignature,
} from './utils';

declare namespace TinyOSS {
  export interface TinyOSSOptions {
    accessKeyId: string; // access secret you create
    accessKeySecret: string; // access secret you create
    stsToken?: string; // used by temporary authorization
    bucket?: string; //  the default bucket you want to access If you don't have any bucket, please use putBucket() create one first.
    endpoint?: string; // oss region domain. It takes priority over region.
    region?: string; // the bucket data region location, please see Data Regions, default is oss-cn-hangzhou.
    internal?: boolean; //  access OSS with aliyun internal network or not, default is false. If your servers are running on aliyun too, you can set true to save lot of money.
    secure?: boolean; // instruct OSS client to use HTTPS (secure: true) or HTTP (secure: false) protocol.
    timeout?: string | number; // instance level timeout for all operations, default is 60s
    cname?: boolean; // use custom domain name
  }

  export interface PutOptions {
    onprogress?: (this: XMLHttpRequest, ev: ProgressEvent) => any;
  }

  export type HTTPMethods = "GET" | "POST" | "DELETE" | "PUT";

  export interface ResponseHeaderType {
    "content-type"?: string;
    "content-disposition"?: string;
    "cache-control"?: string;
  }

  export interface ObjectCallback {
    url: string; // After a file is uploaded successfully, the OSS sends a callback request to this URL.
    host?: string; // The host header value for initiating callback requests.
    body: string; // The value of the request body when a callback is initiated, for example, key=$(key)&etag=$(etag)&my_var=$(x:my_var).
    contentType?: string; // The Content-Type of the callback requests initiatiated, It supports application/x-www-form-urlencoded and application/json, and the former is the default value.
    customValue?: object;
    headers?: object; //  extra headers, detail see RFC 2616
  }

  export interface SignatureUrlOptions {
    expires?: number; // after expires seconds, the url will become invalid, default is 1800
    method?: HTTPMethods; // the HTTP method, default is 'GET'
    "Content-Type"?: string; // set the request content type
    process?: string;
    response?: ResponseHeaderType; // set the response headers for download
    callback?: ObjectCallback;
    [key: string]: any;
  }
}

export default class TinyOSS {
  opts: TinyOSS.TinyOSSOptions;
  host: string | undefined;

  constructor(options: TinyOSS.TinyOSSOptions = {} as TinyOSS.TinyOSSOptions) {
    assertOptions(options);
    this.opts = Object.assign({
      region: 'oss-cn-hangzhou',
      internal: false,
      cname: false,
      secure: false,
      timeout: 60000,
    }, options);
    const { bucket, region, endpoint, internal } = this.opts;
    this.host = '';
    if (endpoint) {
      this.host = endpoint;
    } else {
      let host = bucket;
      if (internal) host += '-internal';
      host += `.${region}.aliyuncs.com`;
      this.host = host;
    }
  }

  /**
   * put object
   *
   * @param objectName object name
   * @param blob data
   * @param options put options
   */
  put(objectName: string, blob: Blob, options: TinyOSS.PutOptions = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      blobToBuffer(blob)
        .then((buf) => {
          const { accessKeyId, accessKeySecret, stsToken, bucket } = this.opts;
          const verb = 'PUT';
          const contentMd5 = getContentMd5(buf);
          const contentType = blob.type;
          const headers: Record<string, any> = {
            'Content-Md5': contentMd5,
            'Content-Type': contentType,
            'x-oss-date': new Date().toUTCString(),
          };
          if (stsToken) headers['x-oss-security-token'] = stsToken;
          const signature = getSignature({
            verb,
            contentMd5,
            headers,
            bucket,
            objectName,
            accessKeySecret,
          });
          headers.Authorization = `OSS ${accessKeyId}:${signature}`;
          const protocol = this.opts.secure ? 'https' : 'http';
          const url = `${protocol}://${this.host}/${objectName}`;
          return ajax(url, {
            method: verb,
            headers,
            data: blob,
            timeout: typeof this.opts.timeout === 'string' ? parseInt(this.opts.timeout, 10) : this.opts.timeout,
            onprogress: options.onprogress,
          });
        })
        .then(resolve)
        .catch(reject);
    });
  }

  /**
   * put symbol link
   *
   * @param objectName object name
   * @param targetObjectName target object name
   */
  putSymlink(objectName: string, targetObjectName: string): Promise<any> {
    const { accessKeyId, accessKeySecret, stsToken, bucket } = this.opts;
    const verb = 'PUT';
    const headers: Record<string, any> = {
      'x-oss-date': new Date().toUTCString(),
      'x-oss-symlink-target': encodeURI(targetObjectName),
    };
    if (stsToken) headers['x-oss-security-token'] = stsToken;
    const signature = getSignature({
      verb,
      headers,
      bucket,
      objectName,
      accessKeySecret,
      subResource: { symlink: '' },
    });
    headers.Authorization = `OSS ${accessKeyId}:${signature}`;
    const protocol = this.opts.secure ? 'https' : 'http';
    const url = `${protocol}://${this.host}/${objectName}?symlink`;
    return ajax(url, {
      method: verb,
      headers,
      timeout: typeof this.opts.timeout === 'string' ? parseInt(this.opts.timeout, 10) : this.opts.timeout,
    });
  }

  /**
   * get signature url for an object
   *
   * @param objectName object name
   * @param options signature options, see <link> https://github.com/ali-sdk/ali-oss#signatureurlname-options </link>
   * @return signature url
   */
  signatureUrl(objectName: string, options: TinyOSS.SignatureUrlOptions = {}): string {
    const { expires = 1800, method, process, response } = options;
    const { accessKeyId, accessKeySecret, stsToken, bucket } = this.opts;
    const headers: Record<string, any> = {};
    const subResource: Record<string, any> = {};
    if (process) subResource['x-oss-process'] = process;
    if (response) {
      Object.keys(response).forEach((k) => {
        const key = `response-${k.toLowerCase()}`;
        subResource[key] = response[k as keyof TinyOSS.ResponseHeaderType];
      });
    }
    Object.keys(options).forEach((key) => {
      const lowerKey = key.toLowerCase();
      const value = options[key];
      if (lowerKey.indexOf('x-oss-') === 0) {
        headers[lowerKey] = value;
      } else if (lowerKey.indexOf('content-md5') === 0) {
        headers[key] = value;
      } else if (lowerKey.indexOf('content-type') === 0) {
        headers[key] = value;
      } else if (lowerKey !== 'expires' && lowerKey !== 'response' && lowerKey !== 'process' && lowerKey !== 'method') {
        subResource[lowerKey] = value;
      }
    });
    const securityToken = options['security-token'] || stsToken;
    if (securityToken) subResource['security-token'] = securityToken;
    const expireUnix = unix() + expires;
    const signature = getSignature({
      type: 'url',
      verb: method || 'GET',
      accessKeySecret,
      bucket,
      objectName,
      headers,
      subResource,
      expires: expireUnix,
    });
    const protocol = this.opts.secure ? 'https' : 'http';
    let url = `${protocol}://${this.host}/${objectName}`;
    url += `?OSSAccessKeyId=${accessKeyId}`;
    url += `&Expires=${expireUnix}`;
    url += `&Signature=${encodeURIComponent(signature)}`;
    Object.keys(subResource).forEach((k) => {
      url += `&${k}=${encodeURIComponent(subResource[k])}`;
    });
    return url;
  }
}
