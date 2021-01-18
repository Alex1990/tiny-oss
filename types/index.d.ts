// Type definitions for [Tiny-OSS] [0.4.1]
// Project: [Tiny-OSS]

export = TinyOSS;

declare class TinyOSS {
  /**
   *
   * @param options see <link> https://github.com/ali-sdk/ali-oss#signatureurlname-options </link>
   */
  constructor(options?: TinyOSS.TinyOSSOptions);

  /**
   * put object
   *
   * @param objectName object name
   * @param blob data
   * @param options put options
   */
  put(objectName: string, blob: Blob, options?: TinyOSS.PutOptions): Promise<XMLHttpRequest["response"]>;

  /**
   * put symbol link
   *
   * @param objectName object name
   * @param targetObjectName target object name
   */
  putSymlink(
    objectName: string,
    targetObjectName: string
  ): Promise<XMLHttpRequest["response"]>;

  /**
   * get signature url for an object
   *
   * @param objectName object name
   * @param options signature options, see <link> https://github.com/ali-sdk/ali-oss#signatureurlname-options </link>
   * @return signature url
   */
  signatureUrl(
    objectName: string,
    options: TinyOSS.SignatureUrlOptions
  ): string;
}

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

  export interface PutOptions {
    onprogress?(e: Event): void;
  }

  export interface SignatureUrlOptions {
    expires?: number; // after expires seconds, the url will become invalid, default is 1800
    method?: HTTPMethods; // the HTTP method, default is 'GET'
    "Content-Type"?: string; // set the request content type
    process?: string;
    response?: ResponseHeaderType; // set the response headers for download
    callback?: ObjectCallback;
  }
}
