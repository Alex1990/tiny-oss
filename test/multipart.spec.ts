import { describe, it, expect, vi } from 'vitest';
import TinyOSS from '../src/TinyOSS';

function createClient() {
  return new TinyOSS({
    accessKeyId: 'test-ak',
    accessKeySecret: 'test-sk',
    bucket: 'test-bucket',
    region: 'oss-cn-hangzhou',
  });
}

describe('multipartUpload', () => {
  it('should respect the parallel limit', async () => {
    const oss = createClient();
    oss.initMultipartUpload = vi.fn(async () => ({ name: 'obj', uploadId: 'upload-1' }));

    let inFlight = 0;
    let maxInFlight = 0;
    oss.uploadPart = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 20);
      await promise;
      inFlight -= 1;
      return { name: 'obj', etag: 'etag' };
    });
    const complete = vi.fn(async () => ({ name: 'obj', etag: 'final-etag' }));
    oss.completeMultipartUpload = complete;

    // 3MB file, 1MB part size -> 3 parts, parallel=2
    const file = new Blob([new Uint8Array(1024 * 1024 * 3)]);
    await oss.multipartUpload('obj', file, { parallel: 2, partSize: 1024 * 1024 });

    expect(oss.uploadPart).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(complete).toHaveBeenCalledTimes(1);
    const parts = complete.mock.calls[0][2];
    expect(parts.map((p: { number: number }) => p.number).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('should resume a checkpoint with its own partSize', async () => {
    const oss = createClient();
    oss.initMultipartUpload = vi.fn(async () => ({ name: 'obj', uploadId: 'upload-1' }));
    const file = new Blob([new Uint8Array(1024 * 1024 * 2)]); // 2MB
    const checkpoint = {
      file,
      name: 'obj',
      uploadId: 'upload-1',
      partSize: 512 * 1024, // created with 512KB parts -> 4 parts
      parts: [
        { number: 1, etag: '' },
        { number: 2, etag: '' },
        { number: 3, etag: '' },
        { number: 4, etag: '' },
      ],
      doneParts: [
        { number: 1, etag: 'etag-1' },
        { number: 3, etag: 'etag-3' },
      ],
    };

    const uploadPart = vi.fn(async (_o: string, _u: string, partNo: number) => ({
      name: 'obj',
      etag: `etag-${partNo}`,
    }));
    oss.uploadPart = uploadPart;
    const complete = vi.fn(async () => ({ name: 'obj', etag: 'final-etag' }));
    oss.completeMultipartUpload = complete;

    // Pass a different partSize on resume; the checkpoint partSize must win.
    await oss.multipartUpload('obj', file, { checkpoint, partSize: 1024 * 1024 });

    expect(oss.initMultipartUpload).not.toHaveBeenCalled();
    // Only missing parts 2 and 4 are uploaded, with 512KB-based ranges.
    expect(uploadPart).toHaveBeenCalledTimes(2);
    const [call2, call4] = uploadPart.mock.calls;
    expect(call2[2]).toBe(2);
    expect(call2[4]).toBe(512 * 1024); // start
    expect(call2[5]).toBe(1024 * 1024); // end
    expect(call4[2]).toBe(4);
    expect(call4[4]).toBe(3 * 512 * 1024); // start
    expect(call4[5]).toBe(2 * 1024 * 1024); // end

    const parts = complete.mock.calls[0][2];
    expect(parts.map((p: { number: number }) => p.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(parts.map((p: { etag: string }) => p.etag).sort()).toEqual(['etag-1', 'etag-2', 'etag-3', 'etag-4']);
  });

  it('should reject an empty file without initializing an upload', async () => {
    const oss = createClient();
    oss.initMultipartUpload = vi.fn(async () => ({ name: 'obj', uploadId: 'upload-1' }));

    await expect(oss.multipartUpload('obj', new Blob([]))).rejects.toThrow(/non-empty/);
    expect(oss.initMultipartUpload).not.toHaveBeenCalled();
  });

  it('should retry a failed part once', async () => {
    const oss = createClient();
    oss.initMultipartUpload = vi.fn(async () => ({ name: 'obj', uploadId: 'upload-1' }));

    let callCount = 0;
    oss.uploadPart = vi.fn(async (_o: string, _u: string, partNo: number) => {
      callCount += 1;
      if (callCount === 1) throw new Error('network error');
      return { name: 'obj', etag: `etag-${partNo}` };
    });
    const complete = vi.fn(async () => ({ name: 'obj', etag: 'final-etag' }));
    oss.completeMultipartUpload = complete;

    const file = new Blob([new Uint8Array(1024 * 1024)]);
    await oss.multipartUpload('obj', file, { partSize: 1024 * 1024 });

    expect(oss.uploadPart).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledWith('obj', 'upload-1', [{ number: 1, etag: 'etag-1' }]);
  });

  it('should report progress per completed part', async () => {
    const oss = createClient();
    oss.initMultipartUpload = vi.fn(async () => ({ name: 'obj', uploadId: 'upload-1' }));
    oss.uploadPart = vi.fn(async () => ({ name: 'obj', etag: 'etag' }));
    oss.completeMultipartUpload = vi.fn(async () => ({ name: 'obj', etag: 'final-etag' }));

    const percentages: number[] = [];
    const file = new Blob([new Uint8Array(1024 * 1024 * 2)]);
    await oss.multipartUpload('obj', file, {
      partSize: 1024 * 1024,
      progress: (percentage) => {
        percentages.push(percentage);
      },
    });

    expect(percentages).toHaveLength(2);
    expect(percentages[percentages.length - 1]).toBe(1);
  });
});
