import { describe, it, expect, beforeAll } from 'vitest';
import { put, multipartUpload, signatureUrl } from '../src/azure/index';

interface AzureConfig {
  accessKeyId?: string;
  accessKeySecret?: string;
  bucket?: string;
}

/**
 * Azure Blob integration tests. They need a real storage account: set
 * AZURE_ACCOUNT / AZURE_ACCOUNT_KEY / AZURE_CONTAINER in .env (and the
 * container CORS rule must expose PUT/GET and the ETag header). When
 * the config is absent each case is skipped, so CI without credentials
 * stays green.
 */
async function getAzureConfig(): Promise<AzureConfig> {
  const res = await fetch('http://localhost:8080/api/azure-config');
  return res.json() as Promise<AzureConfig>;
}

function getObjectName() {
  return Math.random().toString(16).slice(2) + Date.now();
}

describe('azure integration', () => {
  let config: AzureConfig;
  let configured: boolean;

  beforeAll(async () => {
    config = await getAzureConfig();
    configured = !!(config.accessKeyId && config.accessKeySecret && config.bucket);
  });

  it('put then download via signed url', async ({ skip }) => {
    if (!configured) skip();
    const content = 'azure put: hello 你好';
    const objectName = getObjectName();
    const options = {
      accessKeyId: config.accessKeyId!,
      accessKeySecret: config.accessKeySecret!,
      bucket: config.bucket!,
      secure: true,
    };
    await put(options, objectName, new Blob([content], { type: 'text/plain' }));
    const url = signatureUrl(options, objectName);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(content);
  });

  it('multipartUpload round-trips patterned bytes', async ({ skip }) => {
    if (!configured) skip();
    const objectName = getObjectName();
    const options = {
      accessKeyId: config.accessKeyId!,
      accessKeySecret: config.accessKeySecret!,
      bucket: config.bucket!,
      secure: true,
    };
    // 3 parts of 100KB with a pattern that would catch part mix-ups.
    const bytes = new Uint8Array(300000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    await multipartUpload(options, objectName, bytes, { partSize: 100 * 1024 });
    const url = signatureUrl(options, objectName);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(300000);
    for (let i = 0; i < body.length; i++) {
      if (body[i] !== bytes[i]) throw new Error(`byte mismatch at ${i}`);
    }
  });
});
