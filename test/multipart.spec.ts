import { describe, it, expect, vi, beforeEach } from 'vitest';
import { multipartUpload } from '../src/ops/multipartUpload';
import { initMultipartUpload } from '../src/ops/initMultipartUpload';
import { uploadPart } from '../src/ops/uploadPart';
import { completeMultipartUpload } from '../src/ops/completeMultipartUpload';

vi.mock('../src/ops/initMultipartUpload', () => ({ initMultipartUpload: vi.fn() }));
vi.mock('../src/ops/uploadPart', () => ({ uploadPart: vi.fn() }));
vi.mock('../src/ops/completeMultipartUpload', () => ({ completeMultipartUpload: vi.fn() }));

const options = {
  accessKeyId: 'test-ak',
  accessKeySecret: 'test-sk',
  bucket: 'test-bucket',
  region: 'oss-cn-hangzhou',
};

const mockedInit = vi.mocked(initMultipartUpload);
const mockedUploadPart = vi.mocked(uploadPart);
const mockedComplete = vi.mocked(completeMultipartUpload);

beforeEach(() => {
  vi.clearAllMocks();
  mockedInit.mockResolvedValue({ name: 'obj', uploadId: 'upload-1' });
  mockedComplete.mockResolvedValue({ name: 'obj', etag: 'final-etag' });
});

describe('multipartUpload', () => {
  it('should respect the parallel limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockedUploadPart.mockImplementation(async (_o, _n, _u, partNo) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 20);
      await promise;
      inFlight -= 1;
      return { name: 'obj', etag: `etag-${partNo}` };
    });

    // 3MB file, 1MB part size -> 3 parts, parallel=2
    const file = new Blob([new Uint8Array(1024 * 1024 * 3)]);
    await multipartUpload(options, 'obj', file, { parallel: 2, partSize: 1024 * 1024 });

    expect(mockedUploadPart).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(mockedComplete).toHaveBeenCalledTimes(1);
    const parts = mockedComplete.mock.calls[0][3];
    expect(parts.map((p: { number: number }) => p.number).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('should resume a checkpoint with its own partSize', async () => {
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

    mockedUploadPart.mockImplementation(async (_o, _n, _u, partNo) => ({
      name: 'obj',
      etag: `etag-${partNo}`,
    }));

    // Pass a different partSize on resume; the checkpoint partSize must win.
    await multipartUpload(options, 'obj', file, { checkpoint, partSize: 1024 * 1024 });

    expect(mockedInit).not.toHaveBeenCalled();
    // Only missing parts 2 and 4 are uploaded, with 512KB-based ranges.
    expect(mockedUploadPart).toHaveBeenCalledTimes(2);
    const [call2, call4] = mockedUploadPart.mock.calls;
    expect(call2[3]).toBe(2);
    expect(call2[5]).toBe(512 * 1024); // start
    expect(call2[6]).toBe(1024 * 1024); // end
    expect(call4[3]).toBe(4);
    expect(call4[5]).toBe(3 * 512 * 1024); // start
    expect(call4[6]).toBe(2 * 1024 * 1024); // end

    const parts = mockedComplete.mock.calls[0][3];
    expect(parts.map((p: { number: number }) => p.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(parts.map((p: { etag: string }) => p.etag).sort()).toEqual(['etag-1', 'etag-2', 'etag-3', 'etag-4']);
  });

  it('should reject an empty file without initializing an upload', async () => {
    await expect(multipartUpload(options, 'obj', new Blob([]))).rejects.toThrow(/non-empty/);
    expect(mockedInit).not.toHaveBeenCalled();
  });

  it('should retry a failed part once', async () => {
    let callCount = 0;
    mockedUploadPart.mockImplementation(async (_o, _n, _u, partNo) => {
      callCount += 1;
      if (callCount === 1) throw new Error('network error');
      return { name: 'obj', etag: `etag-${partNo}` };
    });

    const file = new Blob([new Uint8Array(1024 * 1024)]);
    await multipartUpload(options, 'obj', file, { partSize: 1024 * 1024 });

    expect(mockedUploadPart).toHaveBeenCalledTimes(2);
    expect(mockedComplete).toHaveBeenCalledWith(options, 'obj', 'upload-1', [{ number: 1, etag: 'etag-1' }]);
  });

  it('should report progress per completed part', async () => {
    mockedUploadPart.mockResolvedValue({ name: 'obj', etag: 'etag' });

    const percentages: number[] = [];
    const file = new Blob([new Uint8Array(1024 * 1024 * 2)]);
    await multipartUpload(options, 'obj', file, {
      partSize: 1024 * 1024,
      progress: (percentage) => {
        percentages.push(percentage);
      },
    });

    expect(percentages).toHaveLength(2);
    expect(percentages[percentages.length - 1]).toBe(1);
  });
});
