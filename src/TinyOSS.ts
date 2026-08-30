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
    file: Blob;
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

  /**
   * Initialize a multipart upload
   *
   * @param objectName object name
   * @param options multipart upload options
   * @return result with uploadId
   */
  initMultipartUpload(objectName: string, options: TinyOSS.MultipartOptions = {}): Promise<TinyOSS.InitMultipartUploadResult> {
    const { accessKeyId, accessKeySecret, stsToken, bucket } = this.opts;
    const verb = 'POST';
    const headers: Record<string, any> = {
      'x-oss-date': new Date().toUTCString(),
      ...options.headers,
    };
    if (stsToken) headers['x-oss-security-token'] = stsToken;
    const signature = getSignature({
      verb,
      headers,
      bucket,
      objectName,
      accessKeySecret,
      subResource: { uploads: '' },
    });
    headers.Authorization = `OSS ${accessKeyId}:${signature}`;
    const protocol = this.opts.secure ? 'https' : 'http';
    const url = `${protocol}://${this.host}/${objectName}?uploads`;
    return ajax(url, {
      method: verb,
      headers,
      timeout: options.timeout || (typeof this.opts.timeout === 'string' ? parseInt(this.opts.timeout, 10) : this.opts.timeout),
    }).then((res: any) => {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(res.data, 'text/xml');
      const uploadId = xmlDoc.getElementsByTagName('UploadId')[0]?.textContent || '';
      return {
        name: objectName,
        uploadId,
        res: res.data,
      };
    });
  }

  /**
   * Upload a part in multipart upload
   *
   * @param objectName object name
   * @param uploadId upload id from initMultipartUpload
   * @param partNo part number (1-10000)
   * @param data blob data to upload
   * @param start start position in file
   * @param end end position in file
   * @param options upload options
   * @return result with etag
   */
  async uploadPart(
    objectName: string,
    uploadId: string,
    partNo: number,
    data: Blob,
    start: number,
    end: number,
    options: TinyOSS.MultipartOptions = {}
  ): Promise<TinyOSS.UploadPartResult> {
    const partData = data.slice(start, end);
    const buf = await blobToBuffer(partData);
    const { accessKeyId, accessKeySecret, stsToken, bucket } = this.opts;
    const verb = 'PUT';
    const contentMd5 = getContentMd5(buf);
    const headers: Record<string, any> = {
      'Content-Md5': contentMd5,
      'Content-Type': partData.type || 'application/octet-stream',
      'x-oss-date': new Date().toUTCString(),
      ...options.headers,
    };
    if (stsToken) headers['x-oss-security-token'] = stsToken;
    const signature = getSignature({
      verb,
      contentMd5,
      headers,
      bucket,
      objectName,
      accessKeySecret,
      subResource: { uploadId, partNumber: partNo.toString() },
    });
    headers.Authorization = `OSS ${accessKeyId}:${signature}`;
    const protocol = this.opts.secure ? 'https' : 'http';
    const url = `${protocol}://${this.host}/${objectName}?partNumber=${partNo}&uploadId=${uploadId}`;
    return ajax(url, {
      method: verb,
      headers,
      data: partData,
      timeout: options.timeout || (typeof this.opts.timeout === 'string' ? parseInt(this.opts.timeout, 10) : this.opts.timeout),
    }).then((res: any) => {
      return {
        name: objectName,
        etag: res.headers.etag || '',
        res: res.data,
      };
    });
  }

  /**
   * Complete a multipart upload
   *
   * @param objectName object name
   * @param uploadId upload id
   * @param parts array of part info with number and etag
   * @param options multipart options
   * @return result with etag
   */
  async completeMultipartUpload(
    objectName: string,
    uploadId: string,
    parts: TinyOSS.PartInfo[],
    options: TinyOSS.MultipartOptions = {}
  ): Promise<TinyOSS.CompleteMultipartUploadResult> {
    const { accessKeyId, accessKeySecret, stsToken, bucket } = this.opts;
    const verb = 'POST';
    // Build complete multipart upload XML
    const xmlParts = parts
      .sort((a, b) => a.number - b.number)
      .map((part) => `  <Part><PartNumber>${part.number}</PartNumber><ETag>${part.etag}</ETag></Part>`)
      .join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUpload>\n${xmlParts}\n</CompleteMultipartUpload>`;
    const blob = new Blob([xml], { type: 'application/xml' });
    const buf = await blobToBuffer(blob);
    const contentMd5 = getContentMd5(buf);
    const headers: Record<string, any> = {
      'Content-Md5': contentMd5,
      'Content-Type': 'application/xml',
      'x-oss-date': new Date().toUTCString(),
      ...options.headers,
    };
    if (stsToken) headers['x-oss-security-token'] = stsToken;
    const signature = getSignature({
      verb,
      contentMd5,
      headers,
      bucket,
      objectName,
      accessKeySecret,
      subResource: { uploadId },
    });
    headers.Authorization = `OSS ${accessKeyId}:${signature}`;
    const protocol = this.opts.secure ? 'https' : 'http';
    const url = `${protocol}://${this.host}/${objectName}?uploadId=${uploadId}`;
    return ajax(url, {
      method: verb,
      headers,
      data: blob,
      timeout: options.timeout || (typeof this.opts.timeout === 'string' ? parseInt(this.opts.timeout, 10) : this.opts.timeout),
    }).then((res: any) => {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(res.data, 'text/xml');
      const etag = xmlDoc.getElementsByTagName('ETag')[0]?.textContent || '';
      return {
        name: objectName,
        etag,
        bucket: this.opts.bucket,
        res: res.data,
      };
    });
  }

  /**
   * Abort a multipart upload
   *
   * @param objectName object name
   * @param uploadId upload id
   * @param options multipart options
   * @return void
   */
  abortMultipartUpload(objectName: string, uploadId: string, options: TinyOSS.MultipartOptions = {}): Promise<void> {
    const { accessKeyId, accessKeySecret, stsToken, bucket } = this.opts;
    const verb = 'DELETE';
    const headers: Record<string, any> = {
      'x-oss-date': new Date().toUTCString(),
      ...options.headers,
    };
    if (stsToken) headers['x-oss-security-token'] = stsToken;
    const signature = getSignature({
      verb,
      headers,
      bucket,
      objectName,
      accessKeySecret,
      subResource: { uploadId },
    });
    headers.Authorization = `OSS ${accessKeyId}:${signature}`;
    const protocol = this.opts.secure ? 'https' : 'http';
    const url = `${protocol}://${this.host}/${objectName}?uploadId=${uploadId}`;
    return ajax(url, {
      method: verb,
      headers,
      timeout: options.timeout || (typeof this.opts.timeout === 'string' ? parseInt(this.opts.timeout, 10) : this.opts.timeout),
    }).then(() => {
      return;
    });
  }

  /**
   * List parts of a multipart upload
   *
   * @param objectName object name
   * @param uploadId upload id
   * @param query query parameters
   * @param options multipart options
   * @return list of parts
   */
  listParts(
    objectName: string,
    uploadId: string,
    query: TinyOSS.ListQuery = {},
    options: TinyOSS.MultipartOptions = {}
  ): Promise<TinyOSS.ListPartsResult> {
    const { accessKeyId, accessKeySecret, stsToken, bucket } = this.opts;
    const verb = 'GET';
    const headers: Record<string, any> = {
      'x-oss-date': new Date().toUTCString(),
      ...options.headers,
    };
    if (stsToken) headers['x-oss-security-token'] = stsToken;
    const subResource: Record<string, any> = { uploadId };
    if (query['max-parts']) subResource['max-parts'] = query['max-parts'].toString();
    if (query['part-number-marker']) subResource['part-number-marker'] = query['part-number-marker'].toString();
    const signature = getSignature({
      verb,
      headers,
      bucket,
      objectName,
      accessKeySecret,
      subResource,
    });
    headers.Authorization = `OSS ${accessKeyId}:${signature}`;
    const protocol = this.opts.secure ? 'https' : 'http';
    let url = `${protocol}://${this.host}/${objectName}?uploadId=${uploadId}`;
    if (query['max-parts']) url += `&max-parts=${query['max-parts']}`;
    if (query['part-number-marker']) url += `&part-number-marker=${query['part-number-marker']}`;
    return ajax(url, {
      method: verb,
      headers,
      timeout: options.timeout || (typeof this.opts.timeout === 'string' ? parseInt(this.opts.timeout, 10) : this.opts.timeout),
    }).then((res: any) => {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(res.data, 'text/xml');
      const isTruncated = xmlDoc.getElementsByTagName('IsTruncated')[0]?.textContent === 'true';
      const nextPartNumberMarker = parseInt(xmlDoc.getElementsByTagName('NextPartNumberMarker')[0]?.textContent || '0', 10);
      const partElements = xmlDoc.getElementsByTagName('Part');
      const parts: TinyOSS.Part[] = [];
      for (let i = 0; i < partElements.length; i++) {
        const part = partElements[i];
        parts.push({
          PartNumber: parseInt(part.getElementsByTagName('PartNumber')[0]?.textContent || '0', 10),
          LastModified: part.getElementsByTagName('LastModified')[0]?.textContent || '',
          ETag: part.getElementsByTagName('ETag')[0]?.textContent || '',
          Size: parseInt(part.getElementsByTagName('Size')[0]?.textContent || '0', 10),
        });
      }
      return {
        isTruncated,
        nextPartNumberMarker,
        parts,
        res: res.data,
      };
    });
  }

  /**
   * List multipart uploads
   *
   * @param query query parameters
   * @param options multipart options
   * @return list of uploads
   */
  listUploads(query: TinyOSS.ListUploadsQuery = {}, options: TinyOSS.MultipartOptions = {}): Promise<TinyOSS.ListUploadsResult> {
    const { accessKeyId, accessKeySecret, stsToken, bucket } = this.opts;
    const verb = 'GET';
    const headers: Record<string, any> = {
      'x-oss-date': new Date().toUTCString(),
      ...options.headers,
    };
    if (stsToken) headers['x-oss-security-token'] = stsToken;
    const subResource: Record<string, any> = { uploads: '' };
    if (query.prefix) subResource.prefix = query.prefix;
    if (query.marker) subResource.marker = query.marker;
    if (query['max-uploads']) subResource['max-uploads'] = query['max-uploads'].toString();
    if (query['upload-id-marker']) subResource['upload-id-marker'] = query['upload-id-marker'];
    const signature = getSignature({
      verb,
      headers,
      bucket,
      objectName: '',
      accessKeySecret,
      subResource,
    });
    headers.Authorization = `OSS ${accessKeyId}:${signature}`;
    const protocol = this.opts.secure ? 'https' : 'http';
    let url = `${protocol}://${this.host}/?uploads`;
    if (query.prefix) url += `&prefix=${encodeURIComponent(query.prefix)}`;
    if (query.marker) url += `&marker=${encodeURIComponent(query.marker)}`;
    if (query['max-uploads']) url += `&max-uploads=${query['max-uploads']}`;
    if (query['upload-id-marker']) url += `&upload-id-marker=${encodeURIComponent(query['upload-id-marker'])}`;
    return ajax(url, {
      method: verb,
      headers,
      timeout: options.timeout || (typeof this.opts.timeout === 'string' ? parseInt(this.opts.timeout, 10) : this.opts.timeout),
    }).then((res: any) => {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(res.data, 'text/xml');
      const isTruncated = xmlDoc.getElementsByTagName('IsTruncated')[0]?.textContent === 'true';
      const nextKeyMarker = xmlDoc.getElementsByTagName('NextKeyMarker')[0]?.textContent || undefined;
      const nextUploadIdMarker = xmlDoc.getElementsByTagName('NextUploadIdMarker')[0]?.textContent || undefined;
      const uploadElements = xmlDoc.getElementsByTagName('Upload');
      const uploads: TinyOSS.UploadInfo[] = [];
      for (let i = 0; i < uploadElements.length; i++) {
        const upload = uploadElements[i];
        uploads.push({
          uploadId: upload.getElementsByTagName('UploadId')[0]?.textContent || '',
          name: upload.getElementsByTagName('Key')[0]?.textContent || '',
          initiated: upload.getElementsByTagName('Initiated')[0]?.textContent || '',
        });
      }
      return {
        uploads,
        isTruncated,
        nextKeyMarker,
        nextUploadIdMarker,
        res: res.data,
      };
    });
  }

  /**
   * Upload part by copying from existing object
   *
   * @param objectName target object name
   * @param uploadId upload id
   * @param partNo part number
   * @param range byte range to copy (e.g., "bytes=0-1023")
   * @param sourceData source object data
   * @param options upload part copy options
   * @return result with etag
   */
  uploadPartCopy(
    objectName: string,
    uploadId: string,
    partNo: number,
    range: string,
    sourceData: TinyOSS.SourceData,
    options: TinyOSS.UploadPartCopyOptions = {}
  ): Promise<TinyOSS.UploadPartCopyResult> {
    const { accessKeyId, accessKeySecret, stsToken, bucket } = this.opts;
    const verb = 'PUT';
    const sourceBucket = sourceData.sourceBucket || bucket;
    const copySource = `/${sourceBucket}/${encodeURIComponent(sourceData.sourceKey)}`;
    const headers: Record<string, any> = {
      'x-oss-date': new Date().toUTCString(),
      'x-oss-copy-source': copySource,
      'x-oss-copy-source-range': range,
      ...options.headers,
    };
    if (stsToken) headers['x-oss-security-token'] = stsToken;
    const signature = getSignature({
      verb,
      headers,
      bucket,
      objectName,
      accessKeySecret,
      subResource: { uploadId, partNumber: partNo.toString() },
    });
    headers.Authorization = `OSS ${accessKeyId}:${signature}`;
    const protocol = this.opts.secure ? 'https' : 'http';
    const url = `${protocol}://${this.host}/${objectName}?partNumber=${partNo}&uploadId=${uploadId}`;
    return ajax(url, {
      method: verb,
      headers,
      timeout: options.timeout || (typeof this.opts.timeout === 'string' ? parseInt(this.opts.timeout, 10) : this.opts.timeout),
    }).then((res: any) => {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(res.data, 'text/xml');
      const etag = xmlDoc.getElementsByTagName('ETag')[0]?.textContent || '';
      const lastModified = xmlDoc.getElementsByTagName('LastModified')[0]?.textContent || '';
      return {
        etag,
        lastModified,
        res: res.data,
      };
    });
  }

  /**
   * Multipart upload with full workflow support
   *
   * @param objectName object name
   * @param file file blob to upload
   * @param options multipart upload options
   * @return complete upload result
   */
  async multipartUpload(
    objectName: string,
    file: Blob,
    options: TinyOSS.MultipartUploadOptions = {}
  ): Promise<TinyOSS.CompleteMultipartUploadResult> {
    const {
      parallel = 5,
      partSize = 1024 * 1024, // default 1MB
      checkpoint,
      progress,
      meta,
      mime,
      headers = {},
    } = options;

    let uploadId: string;
    let doneParts: TinyOSS.PartInfo[] = [];
    let actualPartSize = Math.max(partSize, 100 * 1024); // minimum 100KB

    const fileSize = file.size;
    if (fileSize === 0) {
      throw new Error('multipart upload requires a non-empty file');
    }

    // Use checkpoint if available
    if (checkpoint && checkpoint.uploadId && checkpoint.file.size === fileSize) {
      uploadId = checkpoint.uploadId;
      doneParts = checkpoint.doneParts || [];
      // Resume with the part size the checkpoint was created with, otherwise
      // start/end ranges and the final part list would be computed wrong.
      if (checkpoint.partSize) actualPartSize = checkpoint.partSize;
    } else {
      // Initialize multipart upload
      const initHeaders: Record<string, any> = { ...headers };
      if (mime) initHeaders['Content-Type'] = mime;
      if (meta) {
        Object.keys(meta).forEach((key) => {
          initHeaders[`x-oss-meta-${key}`] = meta[key];
        });
      }
      const initResult = await this.initMultipartUpload(objectName, { headers: initHeaders });
      uploadId = initResult.uploadId;
    }

    // Calculate parts
    const numParts = Math.ceil(fileSize / actualPartSize);
    const parts: TinyOSS.PartInfo[] = [];

    // Build checkpoint object
    const currentCheckpoint: TinyOSS.Checkpoint = {
      file,
      name: objectName,
      uploadId,
      partSize: actualPartSize,
      parts: [],
      doneParts: [...doneParts],
    };

    // Calculate parts to upload
    for (let i = 1; i <= numParts; i++) {
      const start = (i - 1) * actualPartSize;
      const end = Math.min(i * actualPartSize, fileSize);
      const isDone = doneParts.some((p) => p.number === i);
      if (!isDone) {
        currentCheckpoint.parts.push({ number: i, etag: '' });
      }
      parts.push({ number: i, etag: '' });
    }

    // Upload parts with concurrency control
    const uploadPartWithRetry = async (partNo: number, start: number, end: number): Promise<TinyOSS.PartInfo> => {
      const uploadOnce = async (): Promise<TinyOSS.UploadPartResult> => {
        const result = await this.uploadPart(objectName, uploadId, partNo, file, start, end);
        // The browser can only read the ETag response header when the bucket
        // CORS rule exposes it; otherwise completeMultipartUpload would fail
        // with an opaque InvalidPart error.
        if (!result.etag) {
          throw new Error('cannot read the ETag of the uploaded part; make sure the bucket CORS rule exposes the ETag response header');
        }
        return result;
      };
      let result: TinyOSS.UploadPartResult;
      try {
        result = await uploadOnce();
      } catch (err) {
        // Retry once on error
        result = await uploadOnce();
      }
      // Update checkpoint
      currentCheckpoint.doneParts.push({ number: partNo, etag: result.etag });
      // Call progress callback
      if (progress) {
        const percentage = currentCheckpoint.doneParts.length / numParts;
        progress(percentage, currentCheckpoint, result);
      }
      return { number: partNo, etag: result.etag };
    };

    // Upload parts in parallel with concurrency limit
    const pendingParts = currentCheckpoint.parts.filter((p) => !doneParts.some((dp) => dp.number === p.number));
    const uploadTasks: Promise<TinyOSS.PartInfo>[] = [];
    const executing: Promise<TinyOSS.PartInfo>[] = [];

    for (const part of pendingParts) {
      const start = (part.number - 1) * actualPartSize;
      const end = Math.min(part.number * actualPartSize, fileSize);
      const task = uploadPartWithRetry(part.number, start, end);
      uploadTasks.push(task);
      executing.push(task);
      // Remove the task from the in-flight pool once it settles, so the
      // next Promise.race never sees an already-resolved promise.
      task.finally(() => {
        const index = executing.indexOf(task);
        if (index > -1) executing.splice(index, 1);
      });
      if (executing.length >= parallel) {
        await Promise.race(executing);
      }
    }

    await Promise.all(uploadTasks);

    // Complete multipart upload
    const completeParts = [...doneParts, ...currentCheckpoint.doneParts]
      .filter((p, index, self) => self.findIndex((sp) => sp.number === p.number) === index);

    return this.completeMultipartUpload(objectName, uploadId, completeParts);
  }
}
