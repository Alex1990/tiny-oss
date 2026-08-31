import { describe, it, expect, vi } from 'vitest';
import { bindOptions } from '../src/ops/bindOptions';
import { put } from '../src/index';

describe('bindOptions', () => {
  it('should forward the remaining arguments to the operation', async () => {
    const op = vi.fn(async (options: unknown, name: string, blob: Blob) => ({ options, name, blob }));
    const bound = bindOptions(op, { accessKeyId: 'ak' });
    const blob = new Blob(['x']);
    const result = await bound('obj', blob);
    expect(result).toEqual({ options: { accessKeyId: 'ak' }, name: 'obj', blob });
    expect(op).toHaveBeenCalledWith({ accessKeyId: 'ak' }, 'obj', blob);
  });

  it('should bind put while keeping the operation signature minus options', () => {
    const bound = bindOptions(put, {
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      bucket: 'b',
      region: 'oss-cn-hangzhou',
    });
    // (objectName, blob, putOptions?) — options is bound, not required anymore
    expect(typeof bound).toBe('function');
  });
});
