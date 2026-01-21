import { describe, it, expect } from 'vitest';
import TinyOSS from '../src/TinyOSS';
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
    const url = oss.signatureUrl(objectName);
    const getRes = await fetch(url);
    const text = await getRes.text();
    expect(text).toBe(content);
  });

  it('putSymlink', async () => {
    const content = 'putSymlink: hello 你好';
    const objectName = getObjectName();
    const targetObjectName = getObjectName();
    const res = await fetch('http://localhost:8080/api/oss-config');
    const data = (await res.json()) as OssConfig;
    const { accessKeyId, accessKeySecret, region, bucket } = data;
    const tinyOss = new TinyOSS({ accessKeyId, accessKeySecret, region, bucket });
    const blob = new Blob([content], { type: 'text/plain' });
    await Promise.all([
      tinyOss.put(targetObjectName, blob),
      tinyOss.putSymlink(objectName, targetObjectName),
    ]);
    const url = tinyOss.signatureUrl(objectName);
    const getRes = await fetch(url);
    const text = await getRes.text();
    expect(text).toBe(content);
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
    const url = tinyOss.signatureUrl(objectName);
    const getRes = await fetch(url);
    const text = await getRes.text();
    expect(text).toBe(content);
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
    const url = oss.signatureUrl(objectName);
    const getRes = await fetch(url);
    const text = await getRes.text();
    expect(text).toBe(content);
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
    const url = tinyOss.signatureUrl(objectName);
    const getRes = await fetch(url);
    const text = await getRes.text();
    expect(text).toBe(content);
  });
});
