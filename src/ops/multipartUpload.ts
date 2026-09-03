import { encodeUtf8, isBlob } from '../utils'
import { resolveCallbackHeaders } from './request'
import type {
  BlobLike,
  Checkpoint,
  CompleteMultipartUploadResult,
  InitMultipartUploadResult,
  MultipartOptions,
  MultipartUploadOptions,
  Options,
  PartInfo,
  UploadPartResult,
} from '../types'
import type { Protocol } from '../protocol'

/** The multipart primitives multipartUpload drives, injected by the entry point. */
export interface MultipartUploadDeps {
  initMultipartUpload: (
    options: Options,
    objectName: string,
    multipartOptions?: MultipartOptions,
  ) => Promise<InitMultipartUploadResult>
  uploadPart: (
    options: Options,
    objectName: string,
    uploadId: string,
    partNo: number,
    data: BlobLike | string,
    start: number,
    end: number,
    multipartOptions?: MultipartOptions,
  ) => Promise<UploadPartResult>
  completeMultipartUpload: (
    options: Options,
    objectName: string,
    uploadId: string,
    parts: PartInfo[],
    multipartOptions?: MultipartOptions,
  ) => Promise<CompleteMultipartUploadResult>
}

function getFileSize(data: BlobLike | string): number {
  if (typeof data === 'string') return encodeUtf8(data).length
  if (isBlob(data)) return data.size
  return data.byteLength
}

/**
 * Multipart upload with full workflow support.
 *
 * @param protocol provider protocol (OSS or COS)
 * @param deps the protocol-bound multipart primitives
 */
export function createMultipartUpload(protocol: Protocol, deps: MultipartUploadDeps) {
  return async function multipartUpload(
    options: Options,
    objectName: string,
    file: BlobLike | string,
    multipartOptions: MultipartUploadOptions = {},
  ): Promise<CompleteMultipartUploadResult> {
    const {
      parallel = 5,
      partSize = 1024 * 1024, // default 1MB
      checkpoint,
      progress,
      meta,
      mime,
      headers = {},
    } = multipartOptions

    // The callback fires on the complete request; reject early (before any
    // part is uploaded) on providers without a callback API. User headers
    // win over serialized callback headers, matching put and the standalone
    // completeMultipartUpload — on COS they are the only way to attach
    // x-cos-callback to the request the server fires the callback on.
    const callbackHeaders = resolveCallbackHeaders(protocol, multipartOptions.callback, headers)

    let uploadId: string
    let doneParts: PartInfo[] = []
    let actualPartSize = Math.max(partSize, 100 * 1024) // minimum 100KB

    const fileSize = getFileSize(file)
    if (fileSize === 0) {
      throw new Error('multipart upload requires a non-empty file')
    }

    // Use checkpoint if available
    if (checkpoint && checkpoint.uploadId && getFileSize(checkpoint.file) === fileSize) {
      uploadId = checkpoint.uploadId
      doneParts = checkpoint.doneParts || []
      // Resume with the part size the checkpoint was created with, otherwise
      // start/end ranges and the final part list would be computed wrong.
      if (checkpoint.partSize) actualPartSize = checkpoint.partSize
    } else {
      // Initialize multipart upload
      const initHeaders: Record<string, any> = { ...headers }
      if (mime) initHeaders['Content-Type'] = mime
      if (meta) {
        Object.keys(meta).forEach((key) => {
          initHeaders[`${protocol.metaPrefix}${key}`] = meta[key]
        })
      }
      const initResult = await deps.initMultipartUpload(options, objectName, {
        headers: initHeaders,
      })
      uploadId = initResult.uploadId
    }

    // Calculate parts
    const numParts = Math.ceil(fileSize / actualPartSize)
    const parts: PartInfo[] = []

    // Build checkpoint object
    const currentCheckpoint: Checkpoint = {
      file,
      name: objectName,
      uploadId,
      partSize: actualPartSize,
      parts: [],
      doneParts: [...doneParts],
    }

    // Calculate parts to upload
    for (let i = 1; i <= numParts; i++) {
      const start = (i - 1) * actualPartSize
      const end = Math.min(i * actualPartSize, fileSize)
      const isDone = doneParts.some((p) => p.number === i)
      if (!isDone) {
        currentCheckpoint.parts.push({ number: i, etag: '' })
      }
      parts.push({ number: i, etag: '' })
    }

    // Upload parts with concurrency control
    const uploadPartWithRetry = async (
      partNo: number,
      start: number,
      end: number,
    ): Promise<PartInfo> => {
      const uploadOnce = async (): Promise<UploadPartResult> => {
        const result = await deps.uploadPart(
          options,
          objectName,
          uploadId,
          partNo,
          file,
          start,
          end,
        )
        // The browser can only read the ETag response header when the bucket
        // CORS rule exposes it; otherwise completeMultipartUpload would fail
        // with an opaque InvalidPart error.
        if (!result.etag) {
          throw new Error(
            'cannot read the ETag of the uploaded part; make sure the bucket CORS rule exposes the ETag response header',
          )
        }
        return result
      }
      let result: UploadPartResult
      try {
        result = await uploadOnce()
      } catch (err) {
        // Retry once on error
        result = await uploadOnce()
      }
      // Update checkpoint
      currentCheckpoint.doneParts.push({ number: partNo, etag: result.etag })
      // Call progress callback
      if (progress) {
        const percentage = currentCheckpoint.doneParts.length / numParts
        progress(percentage, currentCheckpoint, result)
      }
      return { number: partNo, etag: result.etag }
    }

    // Upload parts in parallel with concurrency limit
    const pendingParts = currentCheckpoint.parts.filter(
      (p) => !doneParts.some((dp) => dp.number === p.number),
    )
    const uploadTasks: Promise<PartInfo>[] = []
    const executing: Promise<PartInfo>[] = []

    for (const part of pendingParts) {
      const start = (part.number - 1) * actualPartSize
      const end = Math.min(part.number * actualPartSize, fileSize)
      const task = uploadPartWithRetry(part.number, start, end)
      uploadTasks.push(task)
      executing.push(task)
      // Remove the task from the in-flight pool once it settles, so the
      // next Promise.race never sees an already-resolved promise. Use
      // then(onFulfilled, onRejected) rather than finally: finally's derived
      // promise rejects whenever the task does, and nothing observes it —
      // a part failing for good (or a throwing progress callback) would
      // surface as an unhandled rejection. then's rejection branch consumes
      // the failure while the task itself still rejects through race/all.
      const removeFromPool = () => {
        const index = executing.indexOf(task)
        if (index > -1) executing.splice(index, 1)
      }
      task.then(removeFromPool, removeFromPool)
      if (executing.length >= parallel) {
        await Promise.race(executing)
      }
    }

    await Promise.all(uploadTasks)

    // Complete multipart upload
    const completeParts = [...doneParts, ...currentCheckpoint.doneParts].filter(
      (p, index, self) => self.findIndex((sp) => sp.number === p.number) === index,
    )

    // User multipart headers apply to the complete request as well, with
    // user values winning over the serialized callback headers.
    const completeHeaders = { ...callbackHeaders, ...headers }
    if (Object.keys(completeHeaders).length > 0) {
      return deps.completeMultipartUpload(options, objectName, uploadId, completeParts, {
        headers: completeHeaders,
      })
    }
    return deps.completeMultipartUpload(options, objectName, uploadId, completeParts)
  }
}
