import { normalizeOptions, resolveHost } from './ops/request';
import { put } from './ops/put';
import { putSymlink } from './ops/putSymlink';
import { signatureUrl } from './ops/signatureUrl';
import { initMultipartUpload } from './ops/initMultipartUpload';
import { uploadPart } from './ops/uploadPart';
import { completeMultipartUpload } from './ops/completeMultipartUpload';
import { abortMultipartUpload } from './ops/abortMultipartUpload';
import { listParts } from './ops/listParts';
import { listUploads } from './ops/listUploads';
import { uploadPartCopy } from './ops/uploadPartCopy';
import { multipartUpload } from './ops/multipartUpload';
import type { TinyOSS as TinyOSSNS } from './types';

export default class TinyOSS {
  opts: TinyOSSNS.TinyOSSOptions;
  host: string | undefined;

  constructor(options: TinyOSSNS.TinyOSSOptions = {} as TinyOSSNS.TinyOSSOptions) {
    this.opts = normalizeOptions(options);
    this.host = resolveHost(this.opts);
  }

  /**
   * put object
   *
   * @param objectName object name
   * @param blob data
   * @param options put options
   */
  put(objectName: string, blob: Blob, options: TinyOSSNS.PutOptions = {}): Promise<any> {
    return put(this.opts, objectName, blob, options);
  }

  /**
   * put symbol link
   *
   * @param objectName object name
   * @param targetObjectName target object name
   */
  putSymlink(objectName: string, targetObjectName: string): Promise<any> {
    return putSymlink(this.opts, objectName, targetObjectName);
  }

  /**
   * get signature url for an object
   *
   * @param objectName object name
   * @param options signature options, see <link> https://github.com/ali-sdk/ali-oss#signatureurlname-options </link>
   * @return signature url
   */
  signatureUrl(objectName: string, options: TinyOSSNS.SignatureUrlOptions = {}): string {
    return signatureUrl(this.opts, objectName, options);
  }

  /**
   * Initialize a multipart upload
   *
   * @param objectName object name
   * @param options multipart upload options
   * @return result with uploadId
   */
  initMultipartUpload(objectName: string, options: TinyOSSNS.MultipartOptions = {}): Promise<TinyOSSNS.InitMultipartUploadResult> {
    return initMultipartUpload(this.opts, objectName, options);
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
  uploadPart(
    objectName: string,
    uploadId: string,
    partNo: number,
    data: Blob,
    start: number,
    end: number,
    options: TinyOSSNS.MultipartOptions = {}
  ): Promise<TinyOSSNS.UploadPartResult> {
    return uploadPart(this.opts, objectName, uploadId, partNo, data, start, end, options);
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
  completeMultipartUpload(
    objectName: string,
    uploadId: string,
    parts: TinyOSSNS.PartInfo[],
    options: TinyOSSNS.MultipartOptions = {}
  ): Promise<TinyOSSNS.CompleteMultipartUploadResult> {
    return completeMultipartUpload(this.opts, objectName, uploadId, parts, options);
  }

  /**
   * Abort a multipart upload
   *
   * @param objectName object name
   * @param uploadId upload id
   * @param options multipart options
   * @return void
   */
  abortMultipartUpload(objectName: string, uploadId: string, options: TinyOSSNS.MultipartOptions = {}): Promise<void> {
    return abortMultipartUpload(this.opts, objectName, uploadId, options);
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
    query: TinyOSSNS.ListQuery = {},
    options: TinyOSSNS.MultipartOptions = {}
  ): Promise<TinyOSSNS.ListPartsResult> {
    return listParts(this.opts, objectName, uploadId, query, options);
  }

  /**
   * List multipart uploads
   *
   * @param query query parameters
   * @param options multipart options
   * @return list of uploads
   */
  listUploads(query: TinyOSSNS.ListUploadsQuery = {}, options: TinyOSSNS.MultipartOptions = {}): Promise<TinyOSSNS.ListUploadsResult> {
    return listUploads(this.opts, query, options);
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
    sourceData: TinyOSSNS.SourceData,
    options: TinyOSSNS.UploadPartCopyOptions = {}
  ): Promise<TinyOSSNS.UploadPartCopyResult> {
    return uploadPartCopy(this.opts, objectName, uploadId, partNo, range, sourceData, options);
  }

  /**
   * Multipart upload with full workflow support
   *
   * @param objectName object name
   * @param file file blob to upload
   * @param options multipart upload options
   * @return complete upload result
   */
  multipartUpload(
    objectName: string,
    file: Blob,
    options: TinyOSSNS.MultipartUploadOptions = {}
  ): Promise<TinyOSSNS.CompleteMultipartUploadResult> {
    return multipartUpload(this.opts, objectName, file, options);
  }
}
