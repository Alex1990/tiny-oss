import { describe, it, expect } from 'vitest';
import TinyOSS from '../src/TinyOSS';
import { put, signatureUrl, multipartUpload } from '../src/index';
// @ts-ignore: ali-oss only for test server
import OSS from 'ali-oss';

interface OssConfig {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  bucket: string;
}

interface StsConfig {
  stsToken: {
    credentials: {
      AccessKeyId: string;
      AccessKeySecret: string;
      SecurityToken: string;
    };
  },
  region: string;
  bucket: string;
}

function getObjectName() {
  return Math.random().toString(16).slice(2) + Date.now();
}

describe('TinyOSS', () => {
  it('should throw if missing options', () => {
    expect(() => new TinyOSS()).toThrow();
  });

  it('should instantiate successfully', async () => {
    const res = await fetch('http://localhost:8080/api/oss-config');
    const data = (await res.json()) as OssConfig;
    const { accessKeyId, accessKeySecret, region, bucket } = data;
    const tinyOss = new TinyOSS({ accessKeyId, accessKeySecret, region, bucket });
    expect(tinyOss.opts).toHaveProperty('accessKeyId', accessKeyId);
    expect(tinyOss.opts).toHaveProperty('accessKeySecret', accessKeySecret);
    expect(tinyOss.opts).toHaveProperty('region', region);
    expect(tinyOss.opts).toHaveProperty('bucket', bucket);
  });

  it('put', async () => {
    const content = 'put: hello 你好';
    const objectName = getObjectName();
    const res = await fetch('http://localhost:8080/api/oss-config');
    const data = (await res.json()) as OssConfig;
    const { accessKeyId, accessKeySecret, region, bucket } = data;
    const tinyOss = new TinyOSS({ accessKeyId, accessKeySecret, region, bucket });
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket });
    const blob = new Blob([content], { type: 'text/plain' });
    await tinyOss.put(objectName, blob);
    try {
      const url = oss.signatureUrl(objectName);
      const getRes = await fetch(url);
      const text = await getRes.text();
      expect(text).toBe(content);
    } finally {
      await oss.delete(objectName);
    }
  });

  it('putSymlink', async () => {
    const content = 'putSymlink: hello 你好';
    const objectName = getObjectName();
    const targetObjectName = getObjectName();
    const res = await fetch('http://localhost:8080/api/oss-config');
    const data = (await res.json()) as OssConfig;
    const { accessKeyId, accessKeySecret, region, bucket } = data;
    const tinyOss = new TinyOSS({ accessKeyId, accessKeySecret, region, bucket });
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket });
    const blob = new Blob([content], { type: 'text/plain' });
    await Promise.all([
      tinyOss.put(targetObjectName, blob),
      tinyOss.putSymlink(objectName, targetObjectName),
    ]);
    try {
      const url = tinyOss.signatureUrl(objectName);
      const getRes = await fetch(url);
      const text = await getRes.text();
      expect(text).toBe(content);
    } finally {
      await Promise.all([oss.delete(objectName), oss.delete(targetObjectName)]);
    }
  });

  it('signatureUrl', async () => {
    const content = 'signatureUrl: hello 你好';
    const objectName = getObjectName();
    const res = await fetch('http://localhost:8080/api/oss-config');
    const data = (await res.json()) as OssConfig;
    const { accessKeyId, accessKeySecret, region, bucket } = data;
    const tinyOss = new TinyOSS({ accessKeyId, accessKeySecret, region, bucket });
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket });
    const blob = new Blob([content], { type: 'text/plain' });
    await oss.put(objectName, blob);
    try {
      const url = tinyOss.signatureUrl(objectName);
      const getRes = await fetch(url);
      const text = await getRes.text();
      expect(text).toBe(content);
    } finally {
      await oss.delete(objectName);
    }
  });

  it('multipartUpload', async () => {
    const objectName = getObjectName();
    const res = await fetch('http://localhost:8080/api/oss-config');
    const data = (await res.json()) as OssConfig;
    const { accessKeyId, accessKeySecret, region, bucket } = data;
    const tinyOss = new TinyOSS({ accessKeyId, accessKeySecret, region, bucket });
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket });

    // 3MB patterned data -> three 1MB parts, so a wrong part range or
    // ordering in completeMultipartUpload shows up as a content mismatch.
    const size = 3 * 1024 * 1024;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 251;
    const blob = new Blob([bytes], { type: 'application/octet-stream' });

    const result = await tinyOss.multipartUpload(objectName, blob, { partSize: 1024 * 1024 });
    expect(result.name).toBe(objectName);
    expect(result.etag).toBeTruthy();

    try {
      const url = oss.signatureUrl(objectName);
      const getRes = await fetch(url);
      expect(getRes.status).toBe(200);
      const downloaded = new Uint8Array(await getRes.arrayBuffer());
      expect(downloaded.length).toBe(size);
      // Compare in chunks so a mismatch reports the failing block.
      for (let i = 0; i < size; i += 64 * 1024) {
        expect(Array.from(downloaded.subarray(i, i + 64 * 1024))).toEqual(Array.from(bytes.subarray(i, i + 64 * 1024)));
      }
    } finally {
      await oss.delete(objectName);
    }
  });

  it('put stsToken', async () => {
    const content = 'put stsToken: hello 你好';
    const objectName = getObjectName();
    const res = await fetch('http://localhost:8080/api/sts');
    const data = (await res.json()) as StsConfig;
    const { stsToken, region, bucket } = data;
    const tinyOss = new TinyOSS({
      accessKeyId: stsToken.credentials.AccessKeyId,
      accessKeySecret: stsToken.credentials.AccessKeySecret,
      stsToken: stsToken.credentials.SecurityToken,
      region,
      bucket,
    });
    const oss = new OSS({
      accessKeyId: stsToken.credentials.AccessKeyId,
      accessKeySecret: stsToken.credentials.AccessKeySecret,
      stsToken: stsToken.credentials.SecurityToken,
      region,
      bucket,
    });
    const blob = new Blob([content], { type: 'text/plain' });
    await tinyOss.put(objectName, blob);
    try {
      const url = oss.signatureUrl(objectName);
      const getRes = await fetch(url);
      const text = await getRes.text();
      expect(text).toBe(content);
    } finally {
      await oss.delete(objectName);
    }
  });

  it('signatureUrl stsToken', async () => {
    const content = 'signatureUrl: hello 你好';
    const objectName = getObjectName();
    const res = await fetch('http://localhost:8080/api/sts');
    const data = (await res.json()) as StsConfig;
    const { stsToken, region, bucket } = data;
    const tinyOss = new TinyOSS({
      accessKeyId: stsToken.credentials.AccessKeyId,
      accessKeySecret: stsToken.credentials.AccessKeySecret,
      stsToken: stsToken.credentials.SecurityToken,
      region,
      bucket,
    });
    const oss = new OSS({
      accessKeyId: stsToken.credentials.AccessKeyId,
      accessKeySecret: stsToken.credentials.AccessKeySecret,
      stsToken: stsToken.credentials.SecurityToken,
      region,
      bucket,
    });
    const blob = new Blob([content], { type: 'text/plain' });
    await oss.put(objectName, blob);
    try {
      const url = tinyOss.signatureUrl(objectName);
      const getRes = await fetch(url);
      const text = await getRes.text();
      expect(text).toBe(content);
    } finally {
      await oss.delete(objectName);
    }
  });

});

describe('functional API', () => {
  it('put', async () => {
    const content = 'functional put: hello 你好';
    const objectName = getObjectName();
    const res = await fetch('http://localhost:8080/api/oss-config');
    const data = (await res.json()) as OssConfig;
    const { accessKeyId, accessKeySecret, region, bucket } = data;
    const options = { accessKeyId, accessKeySecret, region, bucket };
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket });
    const blob = new Blob([content], { type: 'text/plain' });
    await put(options, objectName, blob);
    try {
      const url = oss.signatureUrl(objectName);
      const getRes = await fetch(url);
      const text = await getRes.text();
      expect(text).toBe(content);
    } finally {
      await oss.delete(objectName);
    }
  });

  it('multipartUpload', async () => {
    const size = 3 * 1024 * 1024;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 251;
    const objectName = getObjectName();
    const res = await fetch('http://localhost:8080/api/oss-config');
    const data = (await res.json()) as OssConfig;
    const { accessKeyId, accessKeySecret, region, bucket } = data;
    const options = { accessKeyId, accessKeySecret, region, bucket };
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket });
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const result = await multipartUpload(options, objectName, blob, { partSize: 1024 * 1024, parallel: 2 });
    expect(result.etag).toBeTruthy();
    try {
      const url = oss.signatureUrl(objectName);
      const getRes = await fetch(url);
      const downloaded = new Uint8Array(await getRes.arrayBuffer());
      expect(downloaded.length).toBe(size);
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < size; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, size);
        for (let i = offset; i < end; i++) {
          if (downloaded[i] !== bytes[i]) throw new Error(`byte mismatch at ${i}`);
        }
      }
    } finally {
      await oss.delete(objectName);
    }
  });

  it('signatureUrl matches the class result', async () => {
    const objectName = getObjectName();
    const res = await fetch('http://localhost:8080/api/oss-config');
    const data = (await res.json()) as OssConfig;
    const { accessKeyId, accessKeySecret, region, bucket } = data;
    const options = { accessKeyId, accessKeySecret, region, bucket };
    const oss = new TinyOSS(options);
    expect(signatureUrl(options, objectName)).toBe(oss.signatureUrl(objectName));
  });
});
