import { describe, it, expect, beforeAll } from 'vitest'
import { put, multipartUpload, signatureUrl, bindOptions } from '../src/cos/index'
import { getTransport, setTransport } from '../src/transport'
import { fetchTransport } from '../src/transports/fetch'

interface CosConfig {
  accessKeyId?: string
  accessKeySecret?: string
  bucket?: string
  region?: string
  stsRoleArn?: string
}

/**
 * COS integration tests. They need a real Tencent Cloud account:
 * set COS_ACCESS_KEY_ID/COS_ACCESS_KEY_SECRET/COS_BUCKET/COS_REGION in
 * .env (COS_STS_ROLE_ARN enables the temporary-credential case). When the
 * config is absent each case is skipped, so CI without credentials stays
 * green.
 */
async function getCosConfig(): Promise<CosConfig> {
  const res = await fetch('http://localhost:8080/api/cos-config')
  return res.json() as Promise<CosConfig>
}

function getObjectName() {
  return Math.random().toString(16).slice(2) + Date.now()
}

describe('cos integration', () => {
  let config: CosConfig
  let configured: boolean

  beforeAll(async () => {
    config = await getCosConfig()
    configured = !!(config.accessKeyId && config.accessKeySecret && config.bucket && config.region)
  })

  it('put then download via signed url', async ({ skip }) => {
    if (!configured) skip()
    const content = 'cos put: hello 你好'
    const objectName = getObjectName()
    const options = {
      accessKeyId: config.accessKeyId!,
      accessKeySecret: config.accessKeySecret!,
      region: config.region!,
      bucket: config.bucket!,
      secure: true,
    }
    await put(options, objectName, new Blob([content], { type: 'text/plain' }))
    const url = signatureUrl(options, objectName)
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(content)
  })

  it('multipartUpload round-trips patterned bytes', async ({ skip }) => {
    if (!configured) skip()
    const objectName = getObjectName()
    const options = {
      accessKeyId: config.accessKeyId!,
      accessKeySecret: config.accessKeySecret!,
      region: config.region!,
      bucket: config.bucket!,
      secure: true,
    }
    const size = 3 * 1024 * 1024
    const bytes = new Uint8Array(size)
    for (let i = 0; i < size; i++) bytes[i] = i % 251
    const result = await multipartUpload(options, objectName, bytes, {
      partSize: 1024 * 1024,
      parallel: 2,
    })
    expect(result.etag).toBeTruthy()
    const url = signatureUrl(options, objectName)
    const downloaded = new Uint8Array(await (await fetch(url)).arrayBuffer())
    expect(downloaded.length).toBe(size)
    for (let i = 0; i < size; i += 64 * 1024) {
      const end = Math.min(i + 64 * 1024, size)
      expect(Array.from(downloaded.subarray(i, end))).toEqual(Array.from(bytes.subarray(i, end)))
    }
  })

  it('bindOptions put', async ({ skip }) => {
    if (!configured) skip()
    const content = 'cos bindOptions put'
    const objectName = getObjectName()
    const upload = bindOptions(put, {
      accessKeyId: config.accessKeyId!,
      accessKeySecret: config.accessKeySecret!,
      region: config.region!,
      bucket: config.bucket!,
      secure: true,
    })
    await upload(objectName, new Blob([content], { type: 'text/plain' }))
    const url = signatureUrl(
      {
        accessKeyId: config.accessKeyId!,
        accessKeySecret: config.accessKeySecret!,
        region: config.region!,
        bucket: config.bucket!,
        secure: true,
      },
      objectName,
    )
    expect(await (await fetch(url)).text()).toBe(content)
  })

  it('fetch transport multipartUpload', async ({ skip }) => {
    if (!configured) skip()
    const options = {
      accessKeyId: config.accessKeyId!,
      accessKeySecret: config.accessKeySecret!,
      region: config.region!,
      bucket: config.bucket!,
      secure: true,
    }
    const saved = getTransport()
    setTransport(fetchTransport)
    try {
      const objectName = getObjectName()
      const size = 2 * 1024 * 1024
      const bytes = new Uint8Array(size)
      for (let i = 0; i < size; i++) bytes[i] = i % 251
      const result = await multipartUpload(options, objectName, bytes, { partSize: 1024 * 1024 })
      expect(result.etag).toBeTruthy()
      const url = signatureUrl(options, objectName)
      const downloaded = new Uint8Array(await (await fetch(url)).arrayBuffer())
      expect(downloaded.length).toBe(size)
    } finally {
      setTransport(saved)
    }
  })
})
