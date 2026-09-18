/**
 * TOS signature oracle: compares tiny-oss's TOS4-HMAC-SHA256 implementation
 * byte-for-byte against the official @volcengine/tos-sdk.
 *
 * The SDK's browser build does not survive vite's dependency optimizer, so
 * this runs under Node (like test/azure-oracle.node.ts):
 *
 *   pnpm test:tos-oracle
 *
 * The header oracle captures the SDK's real requests with a local HTTP server
 * and recomputes the Authorization with our signer from the captured
 * method/path/query/headers. The fixed vectors embedded in
 * test/tos-signature.spec.ts are asserted here too.
 */
import { strict as assert } from 'node:assert'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { TosClient } from '@volcengine/tos-sdk'
import { getTosSignature } from '../src/tos/signature'
import { tosSignUrl } from '../src/tos/signatureUrl'

const AK = 'AKIDEXAMPLE'
const SK = 'SECRETKEY'
const REGION = 'cn-beijing'
const BUCKET = 'examplebucket'
const TOKEN = 'TOKEN'

interface Captured {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  body: string
}

let captured: Captured[] = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    captured.push({
      method: req.method as string,
      url: req.url as string,
      headers: req.headers,
      body,
    })
    res.writeHead(200, { 'content-type': 'application/xml', etag: '"e1"' })
    res.end(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><UploadId>u1</UploadId></InitiateMultipartUploadResult>',
    )
  })
})

let failures = 0
function fail(name: string, err: unknown): void {
  failures += 1
  console.error(`FAIL  ${name}\n${err instanceof Error ? err.message : String(err)}`)
}

function check(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail(name, err)
  }
}

async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail(name, err)
  }
}

/** The canonical URI the SDK signs: restore %2F, then encode !*'(). */
function canonicalPath(rawUrl: string): string {
  return rawUrl
    .split('?')[0]
    .replace(/%2F/g, '/')
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
}

function queryOf(rawUrl: string): Record<string, string> {
  const out: Record<string, string> = {}
  const qs = rawUrl.split('?')[1]
  if (!qs) return out
  qs.split('&')
    .filter(Boolean)
    .forEach((pair) => {
      const eq = pair.indexOf('=')
      const key = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq))
      const value = eq < 0 ? '' : decodeURIComponent(pair.slice(eq + 1))
      out[key] = value
    })
  return out
}

function signedHeadersOf(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {}
  Object.keys(headers).forEach((key) => {
    const lower = key.toLowerCase()
    const value = headers[key]
    if (value != null && (lower === 'host' || lower.indexOf('x-tos-') === 0)) {
      out[lower] = Array.isArray(value) ? value.join(',') : String(value)
    }
  })
  return out
}

function mineFor(call: Captured): string {
  const { signature, credentialScope, signedHeaders } = getTosSignature({
    method: call.method,
    pathname: canonicalPath(call.url),
    query: queryOf(call.url),
    headers: signedHeadersOf(call.headers),
    accessKeyId: AK,
    secretAccessKey: SK,
    region: REGION,
    date: String(call.headers['x-tos-date']),
  })
  return `TOS4-HMAC-SHA256 Credential=${AK}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

async function capturedCall(fn: () => Promise<unknown>): Promise<Captured> {
  captured = []
  try {
    await fn()
  } catch {
    // Some calls need a response body we do not model; the request is
    // captured before response parsing.
  }
  assert.ok(captured.length > 0, 'no request captured')
  return captured[0]
}

async function main() {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const endpoint = `127.0.0.1:${port}`
  const makeClient = (stsToken?: string) =>
    new TosClient({
      accessKeyId: AK,
      accessKeySecret: SK,
      region: REGION,
      endpoint,
      secure: false,
      bucket: BUCKET,
      stsToken,
    })

  console.log('TOS4-HMAC-SHA256 headers vs @volcengine/tos-sdk:')

  await checkAsync('putObject with metadata', async () => {
    const call = await capturedCall(() =>
      makeClient(TOKEN).putObject({ key: 'dir/a b.txt', body: 'hello', meta: { title: 'T' } }),
    )
    assert.equal(mineFor(call), call.headers.authorization)
  })

  await checkAsync('putObject with a non-ASCII key', async () => {
    const call = await capturedCall(() =>
      makeClient(TOKEN).putObject({ key: '目录/文件 名.txt', body: 'x' }),
    )
    assert.equal(mineFor(call), call.headers.authorization)
  })

  await checkAsync('createMultipartUpload (?uploads)', async () => {
    const call = await capturedCall(() =>
      makeClient(TOKEN).createMultipartUpload({ key: 'bigfile.bin' }),
    )
    assert.ok(call.url.indexOf('uploads=') >= 0)
    assert.equal(mineFor(call), call.headers.authorization)
  })

  await checkAsync('uploadPart (partNumber + uploadId)', async () => {
    const call = await capturedCall(() =>
      makeClient(TOKEN).uploadPart({
        key: 'bigfile.bin',
        uploadId: 'u1',
        partNumber: 1,
        body: 'x',
      }),
    )
    assert.deepEqual(queryOf(call.url), { partNumber: '1', uploadId: 'u1' })
    assert.equal(mineFor(call), call.headers.authorization)
  })

  await checkAsync('listParts (max-parts + part-number-marker)', async () => {
    const call = await capturedCall(() =>
      makeClient(TOKEN).listParts({
        key: 'bigfile.bin',
        uploadId: 'u1',
        maxParts: 10,
        partNumberMarker: 3,
      }),
    )
    assert.equal(mineFor(call), call.headers.authorization)
  })

  await checkAsync('listMultipartUploads', async () => {
    const call = await capturedCall(() =>
      makeClient(TOKEN).listMultipartUploads({ bucket: BUCKET }),
    )
    assert.equal(mineFor(call), call.headers.authorization)
  })

  await checkAsync('completeMultipartUpload', async () => {
    const call = await capturedCall(() =>
      makeClient(TOKEN).completeMultipartUpload({
        key: 'bigfile.bin',
        uploadId: 'u1',
        parts: [{ partNumber: 1, etag: '"e1"' }],
      }),
    )
    assert.equal(mineFor(call), call.headers.authorization)
  })

  await checkAsync('abortMultipartUpload', async () => {
    const call = await capturedCall(() =>
      makeClient(TOKEN).abortMultipartUpload({ key: 'bigfile.bin', uploadId: 'u456' }),
    )
    assert.equal(mineFor(call), call.headers.authorization)
  })

  await checkAsync('uploadPartCopy (copy source + range)', async () => {
    const call = await capturedCall(() =>
      makeClient(TOKEN).uploadPartCopy({
        key: 'bigfile.bin',
        uploadId: 'u1',
        partNumber: 2,
        srcBucket: 'srcbucket',
        srcKey: 'dir/source.bin',
        copySourceRange: 'bytes=0-1023',
      }),
    )
    assert.equal(String(call.headers['x-tos-copy-source']), '/srcbucket/dir%2Fsource.bin')
    assert.equal(mineFor(call), call.headers.authorization)
  })

  await checkAsync('putSymlink (x-tos-symlink-target)', async () => {
    const call = await capturedCall(() =>
      makeClient(TOKEN).putSymlink({ key: 'link.txt', symLinkTargetKey: 'dir/target.txt' }),
    )
    assert.equal(String(call.headers['x-tos-symlink-target']), 'dir/target.txt')
    assert.equal(mineFor(call), call.headers.authorization)
  })

  await checkAsync('without a security token', async () => {
    const call = await capturedCall(() => makeClient().putObject({ key: 'plain.txt', body: 'x' }))
    assert.equal(call.headers['x-tos-security-token'], undefined)
    assert.equal(mineFor(call), call.headers.authorization)
  })

  // The vector embedded in test/tos-signature.spec.ts.
  console.log('\nFixed vectors match the SDK output:')
  check('init vector (20260918T125156Z)', () => {
    const { signature, credentialScope, signedHeaders } = getTosSignature({
      method: 'POST',
      pathname: '/examplebucket/bigfile.bin',
      query: { uploads: '' },
      headers: {
        host: '127.0.0.1:45893',
        'x-tos-date': '20260918T125156Z',
        'x-tos-content-sha256': 'UNSIGNED-PAYLOAD',
      },
      accessKeyId: AK,
      secretAccessKey: SK,
      region: REGION,
      date: '20260918T125156Z',
    })
    assert.equal(credentialScope, '20260918/cn-beijing/tos/request')
    assert.equal(signedHeaders, 'host;x-tos-content-sha256;x-tos-date')
    assert.equal(signature, '57e4cfd365d312c5e37abb6d26e19b11b231e5d4e761d6b6b11fc3cf1b417b6c')
  })

  console.log('\nPre-signed URLs vs @volcengine/tos-sdk (endpoint === region):')
  const RealDate = Date
  const FIXED = '2026-09-01T00:00:00.000Z'
  class FixedDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) super(FIXED)
      else super(...(args as [any]))
    }
    static now() {
      return new RealDate(FIXED).getTime()
    }
  }
  ;(globalThis as any).Date = FixedDate
  try {
    const client = new TosClient({
      accessKeyId: AK,
      accessKeySecret: SK,
      region: REGION,
      endpoint: REGION,
      secure: true,
      bucket: BUCKET,
    })
    const opts = {
      accessKeyId: AK,
      accessKeySecret: SK,
      region: REGION,
      endpoint: REGION,
      bucket: BUCKET,
      secure: true,
    }
    for (const key of ['exampleobject', '目录/a b.txt']) {
      check(`signed URL for ${JSON.stringify(key)}`, () => {
        const official = new URL(
          client.getPreSignedUrl({ bucket: BUCKET, key, method: 'GET', expires: 600 }),
        )
        const mine = new URL(tosSignUrl(opts, key, { expires: 600 }))
        assert.equal(mine.host, official.host)
        assert.equal(decodeURIComponent(mine.pathname), decodeURIComponent(official.pathname))
        assert.deepEqual(
          Object.fromEntries(mine.searchParams),
          Object.fromEntries(official.searchParams),
        )
      })
    }
    check('plain GET signature vector (20260901T000000Z)', () => {
      const mine = new URL(tosSignUrl(opts, 'exampleobject', { expires: 600 }))
      assert.equal(
        mine.searchParams.get('X-Tos-Signature'),
        '4cba3a3c67f8da33a72d5b87c0c264715edfc56552c35a4cff81eed169c3f7c0',
      )
    })
    check('non-ASCII signature vector (20260901T000000Z)', () => {
      const mine = new URL(tosSignUrl(opts, '目录/a b.txt', { expires: 600 }))
      assert.equal(
        mine.searchParams.get('X-Tos-Signature'),
        '9fc2461247b09863d0fe8bac0d545b07206fad757629a69da8adf0124f59a4d8',
      )
    })
    check('region (not endpoint) in the credential scope', () => {
      const mine = new URL(
        tosSignUrl({ ...opts, endpoint: `tos-${REGION}.volces.com` }, 'exampleobject', {
          expires: 600,
        }),
      )
      assert.equal(mine.host, `${BUCKET}.tos-${REGION}.volces.com`)
      assert.equal(
        mine.searchParams.get('X-Tos-Credential'),
        `${AK}/20260901/${REGION}/tos/request`,
      )
    })
  } finally {
    ;(globalThis as any).Date = RealDate
  }

  await new Promise<void>((resolve) => server.close(() => resolve()))

  if (failures > 0) {
    console.error(`\n${failures} oracle check(s) FAILED`)
    process.exit(1)
  }
  console.log('\nAll TOS oracle checks passed.')
}

main()
