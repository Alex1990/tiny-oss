import { fromUint8Array } from 'js-base64'
import { Digest } from './digest'
import { md5 } from './md5'
import { encodeUtf8 } from './utf8'

function isDate(obj: any): boolean {
  return obj instanceof Date && !isNaN(obj.getTime())
}

function unix(date?: string | number | Date): number {
  const now = Date.now()
  const timestamp = date ? new Date(date).getTime() : now
  const validTimestamp = isNaN(timestamp) ? now : timestamp
  return Math.floor(validTimestamp / 1000)
}

function isBlob(v: unknown): v is Blob {
  return typeof Blob !== 'undefined' && v instanceof Blob
}

function isArrayBuffer(v: unknown): v is ArrayBuffer {
  return (
    typeof ArrayBuffer !== 'undefined' &&
    (v instanceof ArrayBuffer || Object.prototype.toString.call(v) === '[object ArrayBuffer]')
  )
}

function blobToBuffer(blob: Blob | ArrayBuffer | Uint8Array | string): Promise<Uint8Array> {
  if (typeof blob === 'string') {
    return Promise.resolve(encodeUtf8(blob))
  }
  if (isArrayBuffer(blob)) {
    return Promise.resolve(new Uint8Array(blob))
  }
  if (ArrayBuffer.isView(blob)) {
    return Promise.resolve(new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength))
  }
  if (isBlob(blob)) {
    // Blob: modern browsers and Service Workers provide blob.arrayBuffer().
    return blob.arrayBuffer().then((buf) => new Uint8Array(buf))
  }
  // Cross-context safety net: wx.fs.readFile may hand us a buffer from another
  // JS context that defeats instanceof; byteLength is the last realm-proof signal.
  const bufferLike: unknown = blob
  if (bufferLike && typeof bufferLike === 'object' && 'byteLength' in bufferLike) {
    const buffer = bufferLike as ArrayBuffer // construct-only, mirrors the isArrayBuffer branch
    return Promise.resolve(new Uint8Array(buffer))
  }
  return Promise.reject(
    new TypeError('unsupported upload data type: ' + Object.prototype.toString.call(blob)),
  )
}

/**
 * Slice the byte range [start, end) out of an upload payload. TypedArrays
 * are sliced with the zero-copy subarray; a DataView (an
 * ArrayBuffer.isView match without subarray) is rebuilt as a Uint8Array
 * window over the same buffer; Blob/ArrayBuffer/string slice natively.
 * Every branch is realm-proof — no instanceof across JS contexts.
 */
function sliceUploadData(
  data: Blob | ArrayBuffer | Uint8Array | string,
  start: number,
  end: number,
): Blob | ArrayBuffer | Uint8Array | string {
  const view = data as Uint8Array // structural stand-in; subarray presence is checked below
  if (ArrayBuffer.isView(data) && typeof view.subarray === 'function') {
    return view.subarray(start, end)
  }
  if (ArrayBuffer.isView(data)) {
    // DataView or another view without subarray: reuse the underlying buffer.
    return new Uint8Array(view.buffer, view.byteOffset + start, end - start)
  }
  return data.slice(start, end)
}

interface Options {
  accessKeyId?: string
  accessKeySecret?: string
  bucket?: string
  endpoint?: string
}

function assertOptions(options: Options): void {
  const { accessKeyId, accessKeySecret, bucket, endpoint } = options
  if (!accessKeyId) throw new Error('need accessKeyId')
  if (!accessKeySecret) throw new Error('need accessKeySecret')
  if (!bucket && !endpoint) throw new Error('need bucket or endpoint')
}

function getContentMd5(buf: Uint8Array): string {
  return fromUint8Array(new Uint8Array(md5().digest(buf)))
}

function getCanonicalizedOSSHeaders(headers: Record<string, any>): string {
  let result = ''
  let headerNames = Object.keys(headers)
  headerNames = headerNames.map((name) => name.toLowerCase())
  headerNames.sort()
  headerNames.forEach((name) => {
    if (name.indexOf('x-oss-') === 0) {
      result += `${name}:${headers[name]}\n`
    }
  })
  return result
}

function getCanonicalizedResource(
  bucket = '',
  objectName = '',
  parameters?: Record<string, any>,
): string {
  let resourcePath = ''
  if (bucket) resourcePath += `/${bucket}`
  if (objectName) {
    if (objectName.charAt(0) !== '/') resourcePath += '/'
    resourcePath += objectName
  }
  let canonicalizedResource = `${resourcePath}`
  let separatorString = '?'
  if (parameters) {
    const compareFunc = (entry1: string, entry2: string) =>
      entry1 > entry2 ? 1 : entry1 < entry2 ? -1 : 0
    const processFunc = (key: string) => {
      canonicalizedResource += separatorString + key
      if (parameters[key]) canonicalizedResource += `=${parameters[key]}`
      separatorString = '&'
    }
    Object.keys(parameters).sort(compareFunc).forEach(processFunc)
  }
  return canonicalizedResource
}

interface SignatureOptions {
  type?: 'header' | 'url'
  verb?: string
  contentMd5?: string
  expires?: number
  bucket?: string
  objectName?: string
  accessKeySecret: string
  headers?: Record<string, any>
  subResource?: Record<string, any>
}

function getSignature(options: SignatureOptions): string {
  const {
    type = 'header',
    verb = '',
    contentMd5 = '',
    expires = unix() + 3600,
    bucket,
    objectName,
    accessKeySecret,
    headers = {},
    subResource,
  } = options
  const date = headers['x-oss-date'] || ''
  const contentType = headers['Content-Type'] || ''
  const data = [verb, contentMd5, contentType]
  if (type === 'header') {
    data.push(date)
  } else {
    data.push(expires)
  }
  const canonicalizedOSSHeaders = getCanonicalizedOSSHeaders(headers)
  const canonicalizedResource = getCanonicalizedResource(bucket, objectName, subResource)
  data.push(`${canonicalizedOSSHeaders}${canonicalizedResource}`)
  const text = data.join('\n')
  const hmac = Digest.HMAC_SHA1()
  hmac.setKey(accessKeySecret)
  hmac.update(text)
  const hashBuf = new Uint8Array(hmac.finalize())
  const signature = fromUint8Array(hashBuf)
  return signature
}

export {
  unix,
  encodeUtf8,
  isBlob,
  isArrayBuffer,
  blobToBuffer,
  sliceUploadData,
  assertOptions,
  getContentMd5,
  getCanonicalizedOSSHeaders,
  getCanonicalizedResource,
  getSignature,
}
