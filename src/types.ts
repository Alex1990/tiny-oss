export namespace TinyOSS {
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

  export interface Progress {
    loaded: number;
    total: number;
    lengthComputable: boolean;
  }

  export type BlobLike = Blob | ArrayBuffer | Uint8Array;

  export interface PutOptions {
    onprogress?: (e: Progress) => any;
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

  // Multipart upload interfaces
  export interface MultipartOptions {
    timeout?: number;
    headers?: Record<string, any>;
  }

  export interface PartInfo {
    number: number;
    etag: string;
  }

  export interface Checkpoint {
    file: BlobLike | string;
    name: string;
    uploadId: string;
    partSize: number;
    parts: PartInfo[];
    doneParts: PartInfo[];
  }

  export interface MultipartUploadOptions extends MultipartOptions {
    parallel?: number; // default 5
    partSize?: number; // default 1MB (1024 * 1024)
    checkpoint?: Checkpoint;
    progress?: (percentage: number, checkpoint: Checkpoint, res?: any) => void;
    meta?: Record<string, any>;
    mime?: string;
  }

  export interface InitMultipartUploadResult {
    name: string;
    uploadId: string;
    res?: any;
  }

  export interface UploadPartResult {
    name: string;
    etag: string;
    res?: any;
  }

  export interface CompleteMultipartUploadResult {
    name: string;
    etag: string;
    bucket?: string;
    res?: any;
  }

  export interface Part {
    PartNumber: number;
    LastModified: string;
    ETag: string;
    Size: number;
  }

  export interface ListPartsResult {
    isTruncated: boolean;
    nextPartNumberMarker: number;
    parts: Part[];
    res?: any;
  }

  export interface ListQuery {
    'max-parts'?: number;
    'part-number-marker'?: number;
  }

  export interface UploadInfo {
    uploadId: string;
    name: string;
    initiated: string;
  }

  export interface ListUploadsResult {
    uploads: UploadInfo[];
    isTruncated: boolean;
    nextKeyMarker?: string;
    nextUploadIdMarker?: string;
    res?: any;
  }

  export interface ListUploadsQuery {
    prefix?: string;
    marker?: string;
    'max-uploads'?: number;
    'upload-id-marker'?: string;
  }

  export interface UploadPartCopyOptions extends MultipartOptions {
    headers?: Record<string, any>;
  }

  export interface SourceData {
    sourceKey: string;
    sourceBucket?: string;
  }

  export interface UploadPartCopyResult {
    etag: string;
    lastModified: string;
    res?: any;
  }
}
