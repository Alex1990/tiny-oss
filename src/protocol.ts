import type { TinyOSS } from './types';

/** Per-request parameters, shared by every provider's request implementation. */
export interface RequestParams {
  verb: string;
  objectName: string;
  contentMd5?: string;
  headers?: Record<string, any>;
  subResource?: Record<string, any>;
  data?: any;
  timeout?: number;
  onprogress?: (e: TinyOSS.Progress) => any;
}

/**
 * Provider-specific behavior collected in one table. Every operation is a
 * factory over a protocol, so `src/index.ts` binds the OSS protocol and
 * `src/cos/index.ts` binds the COS protocol; bundlers tree-shake the
 * unused signer out of each entry.
 */
export interface Protocol {
  /** Sign and send a single request through the configured transport. */
  request: (options: TinyOSS.TinyOSSOptions, params: RequestParams) => Promise<any>;
  /** Object metadata header prefix, e.g. 'x-oss-meta-' or 'x-cos-meta-'. */
  metaPrefix: string;
  /** Copy source header for uploadPartCopy. */
  copySourceHeader: string;
  /** Copy source range header for uploadPartCopy. */
  copySourceRangeHeader: string;
  /** listUploads marker query key: OSS 'marker', COS 'key-marker'. */
  listUploadsMarkerKey: string;
  /** Whether the provider has a symlink API (only OSS does). */
  supportsSymlink: boolean;
  /** Build a signed URL for download (or upload). */
  signUrl: (options: TinyOSS.TinyOSSOptions, objectName: string, urlOptions?: TinyOSS.SignatureUrlOptions) => string;
}
