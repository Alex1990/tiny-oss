import { describe, it, expect } from 'vitest'
import {
  put,
  putSymlink,
  signatureUrl,
  multipartUpload,
  bindOptions,
  setTransport,
  getTransport,
  fetchTransport,
} from '../src/index'
import type { Checkpoint } from '../src/index'
// @ts-ignore: ali-oss only for test server
import OSS from 'ali-oss'

interface OssConfig {
  accessKeyId: string
  accessKeySecret: string
  region: string
  bucket: string
}

interface StsConfig {
  stsToken: {
    credentials: {
      AccessKeyId: string
      AccessKeySecret: string
      SecurityToken: string
    }
  }
  region: string
  bucket: string
}

function getObjectName() {
  return Math.random().toString(16).slice(2) + Date.now()
}

describe('integration', () => {
  it('should throw if options are missing', async () => {
    await expect(put({} as any, 'obj', new Blob(['x']))).rejects.toThrow(/need accessKeyId/)
  })

  it('put', async () => {
    const content = 'put: hello 你好'
    const objectName = getObjectName()
    const res = await fetch('http://localhost:8080/api/oss-config')
    const data = (await res.json()) as OssConfig
    const { accessKeyId, accessKeySecret, region, bucket } = data
    const options = { accessKeyId, accessKeySecret, region, bucket }
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket })
    const blob = new Blob([content], { type: 'text/plain' })
    await put(options, objectName, blob)
    try {
      const url = oss.signatureUrl(objectName)
      const getRes = await fetch(url)
      const text = await getRes.text()
      expect(text).toBe(content)
    } finally {
      await oss.delete(objectName)
    }
  })

  it('putSymlink', async () => {
    const content = 'putSymlink: hello 你好'
    const objectName = getObjectName()
    const targetObjectName = getObjectName()
    const res = await fetch('http://localhost:8080/api/oss-config')
    const data = (await res.json()) as OssConfig
    const { accessKeyId, accessKeySecret, region, bucket } = data
    const options = { accessKeyId, accessKeySecret, region, bucket }
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket })
    const blob = new Blob([content], { type: 'text/plain' })
    await Promise.all([
      put(options, targetObjectName, blob),
      putSymlink(options, objectName, targetObjectName),
    ])
    try {
      const url = signatureUrl(options, objectName)
      const getRes = await fetch(url)
      const text = await getRes.text()
      expect(text).toBe(content)
    } finally {
      await Promise.all([oss.delete(objectName), oss.delete(targetObjectName)])
    }
  })

  it('signatureUrl', async () => {
    const content = 'signatureUrl: hello 你好'
    const objectName = getObjectName()
    const res = await fetch('http://localhost:8080/api/oss-config')
    const data = (await res.json()) as OssConfig
    const { accessKeyId, accessKeySecret, region, bucket } = data
    const options = { accessKeyId, accessKeySecret, region, bucket }
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket })
    const blob = new Blob([content], { type: 'text/plain' })
    await oss.put(objectName, blob)
    try {
      const url = signatureUrl(options, objectName)
      expect(url).toContain('OSSAccessKeyId=')
      expect(url).toContain('Expires=')
      expect(url).toContain('Signature=')
      const getRes = await fetch(url)
      const text = await getRes.text()
      expect(text).toBe(content)
    } finally {
      await oss.delete(objectName)
    }
  })

  it('signatureUrl with non-ASCII object name', async () => {
    const content = 'signatureUrl 中文: hello 你好'
    const objectName = `中文文件-${Date.now()}.txt`
    const res = await fetch('http://localhost:8080/api/oss-config')
    const data = (await res.json()) as OssConfig
    const { accessKeyId, accessKeySecret, region, bucket } = data
    const options = { accessKeyId, accessKeySecret, region, bucket }
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket })
    const blob = new Blob([content], { type: 'text/plain' })
    await oss.put(objectName, blob)
    try {
      const url = signatureUrl(options, objectName)
      expect(url).toContain('OSSAccessKeyId=')
      const getRes = await fetch(url)
      expect(getRes.status).toBe(200)
      expect(await getRes.text()).toBe(content)
    } finally {
      await oss.delete(objectName)
    }
  })

  it('multipartUpload', async () => {
    const objectName = getObjectName()
    const res = await fetch('http://localhost:8080/api/oss-config')
    const data = (await res.json()) as OssConfig
    const { accessKeyId, accessKeySecret, region, bucket } = data
    const options = { accessKeyId, accessKeySecret, region, bucket }
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket })

    // 3MB patterned data -> three 1MB parts, so a wrong part range or
    // ordering in completeMultipartUpload shows up as a content mismatch.
    const size = 3 * 1024 * 1024
    const bytes = new Uint8Array(size)
    for (let i = 0; i < size; i++) bytes[i] = i % 251
    const blob = new Blob([bytes], { type: 'application/octet-stream' })

    const result = await multipartUpload(options, objectName, blob, {
      partSize: 1024 * 1024,
      parallel: 2,
    })
    expect(result.name).toBe(objectName)
    expect(result.etag).toBeTruthy()

    try {
      const url = oss.signatureUrl(objectName)
      const getRes = await fetch(url)
      expect(getRes.status).toBe(200)
      const downloaded = new Uint8Array(await getRes.arrayBuffer())
      expect(downloaded.length).toBe(size)
      // Compare in chunks so a mismatch reports the failing block.
      for (let i = 0; i < size; i += 64 * 1024) {
        expect(Array.from(downloaded.subarray(i, i + 64 * 1024))).toEqual(
          Array.from(bytes.subarray(i, i + 64 * 1024)),
        )
      }
    } finally {
      await oss.delete(objectName)
    }
  })

  it('put stsToken', async () => {
    const content = 'put stsToken: hello 你好'
    const objectName = getObjectName()
    const res = await fetch('http://localhost:8080/api/sts')
    const data = (await res.json()) as StsConfig
    const { stsToken, region, bucket } = data
    const options = {
      accessKeyId: stsToken.credentials.AccessKeyId,
      accessKeySecret: stsToken.credentials.AccessKeySecret,
      stsToken: stsToken.credentials.SecurityToken,
      region,
      bucket,
    }
    const oss = new OSS(options)
    const blob = new Blob([content], { type: 'text/plain' })
    await put(options, objectName, blob)
    try {
      const url = oss.signatureUrl(objectName)
      const getRes = await fetch(url)
      const text = await getRes.text()
      expect(text).toBe(content)
    } finally {
      await oss.delete(objectName)
    }
  })

  it('signatureUrl stsToken', async () => {
    const content = 'signatureUrl: hello 你好'
    const objectName = getObjectName()
    const res = await fetch('http://localhost:8080/api/sts')
    const data = (await res.json()) as StsConfig
    const { stsToken, region, bucket } = data
    const options = {
      accessKeyId: stsToken.credentials.AccessKeyId,
      accessKeySecret: stsToken.credentials.AccessKeySecret,
      stsToken: stsToken.credentials.SecurityToken,
      region,
      bucket,
    }
    const oss = new OSS(options)
    const blob = new Blob([content], { type: 'text/plain' })
    await oss.put(objectName, blob)
    try {
      const url = signatureUrl(options, objectName)
      const getRes = await fetch(url)
      const text = await getRes.text()
      expect(text).toBe(content)
    } finally {
      await oss.delete(objectName)
    }
  })

  it('put ArrayBuffer input', async () => {
    const size = 2 * 1024 * 1024
    const bytes = new Uint8Array(size)
    for (let i = 0; i < size; i++) bytes[i] = i % 251
    const objectName = getObjectName()
    const res = await fetch('http://localhost:8080/api/oss-config')
    const data = (await res.json()) as OssConfig
    const { accessKeyId, accessKeySecret, region, bucket } = data
    const options = { accessKeyId, accessKeySecret, region, bucket }
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket })
    // Mini-program style input: ArrayBuffer instead of Blob.
    await put(options, objectName, bytes.buffer as ArrayBuffer)
    try {
      const url = oss.signatureUrl(objectName)
      const getRes = await fetch(url)
      const downloaded = new Uint8Array(await getRes.arrayBuffer())
      expect(downloaded.length).toBe(size)
      for (let i = 0; i < size; i += 64 * 1024) {
        const end = Math.min(i + 64 * 1024, size)
        expect(Array.from(downloaded.subarray(i, end))).toEqual(Array.from(bytes.subarray(i, end)))
      }
    } finally {
      await oss.delete(objectName)
    }
  })

  it('multipartUpload ArrayBuffer input', async () => {
    const size = 3 * 1024 * 1024
    const bytes = new Uint8Array(size)
    for (let i = 0; i < size; i++) bytes[i] = i % 251
    const objectName = getObjectName()
    const res = await fetch('http://localhost:8080/api/oss-config')
    const data = (await res.json()) as OssConfig
    const { accessKeyId, accessKeySecret, region, bucket } = data
    const options = { accessKeyId, accessKeySecret, region, bucket }
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket })
    const result = await multipartUpload(options, objectName, bytes.buffer as ArrayBuffer, {
      partSize: 1024 * 1024,
    })
    expect(result.etag).toBeTruthy()
    try {
      const url = oss.signatureUrl(objectName)
      const getRes = await fetch(url)
      const downloaded = new Uint8Array(await getRes.arrayBuffer())
      expect(downloaded.length).toBe(size)
      for (let i = 0; i < size; i += 64 * 1024) {
        const end = Math.min(i + 64 * 1024, size)
        expect(Array.from(downloaded.subarray(i, end))).toEqual(Array.from(bytes.subarray(i, end)))
      }
    } finally {
      await oss.delete(objectName)
    }
  })

  it('multipartUpload resumes from a checkpoint after an interruption', async () => {
    const objectName = getObjectName()
    const res = await fetch('http://localhost:8080/api/oss-config')
    const data = (await res.json()) as OssConfig
    const { accessKeyId, accessKeySecret, region, bucket } = data
    const options = { accessKeyId, accessKeySecret, region, bucket }
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket })

    // 3MB patterned data -> three 1MB parts. parallel: 1 makes the
    // interruption deterministic: fail right after part 2 completes.
    const size = 3 * 1024 * 1024
    const bytes = new Uint8Array(size)
    for (let i = 0; i < size; i++) bytes[i] = i % 251
    const blob = new Blob([bytes], { type: 'application/octet-stream' })

    let checkpoint: Checkpoint | null = null
    await expect(
      multipartUpload(options, objectName, blob, {
        partSize: 1024 * 1024,
        parallel: 1,
        progress(_percentage, cp) {
          if (cp.doneParts.length >= 2) {
            checkpoint = cp
            throw new Error('simulated interruption')
          }
        },
      }),
    ).rejects.toThrow('simulated interruption')
    expect(checkpoint).not.toBeNull()

    // Resume with the interrupted upload's checkpoint: the server-side
    // session is reused, parts 1-2 are already done, so only part 3 is
    // uploaded and a single 100% progress event fires.
    const resumedPercentages: number[] = []
    const result = await multipartUpload(options, objectName, blob, {
      checkpoint,
      progress: (percentage) => {
        resumedPercentages.push(percentage)
      },
    })
    expect(resumedPercentages).toEqual([1])
    expect(result.etag).toBeTruthy()

    try {
      const url = oss.signatureUrl(objectName)
      const getRes = await fetch(url)
      expect(getRes.status).toBe(200)
      const downloaded = new Uint8Array(await getRes.arrayBuffer())
      expect(downloaded.length).toBe(size)
      for (let i = 0; i < size; i += 64 * 1024) {
        expect(Array.from(downloaded.subarray(i, i + 64 * 1024))).toEqual(
          Array.from(bytes.subarray(i, i + 64 * 1024)),
        )
      }
    } finally {
      await oss.delete(objectName)
    }
  })

  it('fetch transport put and multipartUpload', async () => {
    const res = await fetch('http://localhost:8080/api/oss-config')
    const data = (await res.json()) as OssConfig
    const { accessKeyId, accessKeySecret, region, bucket } = data
    const options = { accessKeyId, accessKeySecret, region, bucket }
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket })

    const saved = getTransport()
    setTransport(fetchTransport)
    try {
      // put through fetch
      const putName = getObjectName()
      await put(options, putName, 'fetch transport 你好')
      try {
        const url = oss.signatureUrl(putName)
        const text = await (await fetch(url)).text()
        expect(text).toBe('fetch transport 你好')
      } finally {
        await oss.delete(putName)
      }

      // multipart through fetch (needs a real file, as in Service Worker)
      const size = 2 * 1024 * 1024
      const bytes = new Uint8Array(size)
      for (let i = 0; i < size; i++) bytes[i] = i % 251
      const multiName = getObjectName()
      const result = await multipartUpload(options, multiName, bytes, { partSize: 1024 * 1024 })
      expect(result.etag).toBeTruthy()
      try {
        const url = oss.signatureUrl(multiName)
        const downloaded = new Uint8Array(await (await fetch(url)).arrayBuffer())
        expect(downloaded.length).toBe(size)
        for (let i = 0; i < size; i += 64 * 1024) {
          const end = Math.min(i + 64 * 1024, size)
          expect(Array.from(downloaded.subarray(i, end))).toEqual(
            Array.from(bytes.subarray(i, end)),
          )
        }
      } finally {
        await oss.delete(multiName)
      }
    } finally {
      setTransport(saved)
    }
  })

  it('bindOptions put', async () => {
    const content = 'bindOptions put: hello 你好'
    const objectName = getObjectName()
    const res = await fetch('http://localhost:8080/api/oss-config')
    const data = (await res.json()) as OssConfig
    const { accessKeyId, accessKeySecret, region, bucket } = data
    const upload = bindOptions(put, { accessKeyId, accessKeySecret, region, bucket })
    const oss = new OSS({ accessKeyId, accessKeySecret, region, bucket })
    const blob = new Blob([content], { type: 'text/plain' })
    await upload(objectName, blob)
    try {
      const url = oss.signatureUrl(objectName)
      const getRes = await fetch(url)
      const text = await getRes.text()
      expect(text).toBe(content)
    } finally {
      await oss.delete(objectName)
    }
  })
})
