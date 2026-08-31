import { initMultipartUpload } from './initMultipartUpload';
import { uploadPart } from './uploadPart';
import { completeMultipartUpload } from './completeMultipartUpload';
import type { TinyOSS } from '../types';

/**
 * Multipart upload with full workflow support.
 *
 * @param options client options
 * @param objectName object name
 * @param file file blob to upload
 * @param multipartOptions multipart upload options
 * @return complete upload result
 */
export async function multipartUpload(
  options: TinyOSS.TinyOSSOptions,
  objectName: string,
  file: Blob,
  multipartOptions: TinyOSS.MultipartUploadOptions = {}
): Promise<TinyOSS.CompleteMultipartUploadResult> {
  const {
    parallel = 5,
    partSize = 1024 * 1024, // default 1MB
    checkpoint,
    progress,
    meta,
    mime,
    headers = {},
  } = multipartOptions;

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
    const initResult = await initMultipartUpload(options, objectName, { headers: initHeaders });
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
      const result = await uploadPart(options, objectName, uploadId, partNo, file, start, end);
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

  return completeMultipartUpload(options, objectName, uploadId, completeParts);
}
