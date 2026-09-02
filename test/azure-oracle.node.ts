/**
 * Azure SharedKey / SAS signature oracle: compares tiny-oss's azure
 * implementation byte-for-byte against the official Microsoft SDKs.
 *
 * The official SDKs' node-only credential APIs cannot run in the
 * browser test environment, so this runs under Node:
 *
 *   npx tsx test/azure-oracle.node.ts
 *
 * Every assertion here must pass; the fixed vectors embedded in
 * test/azure.spec.ts are computed from this script's oracle outputs.
 */
import { strict as assert } from 'node:assert'
import { fromUint8Array } from 'js-base64'
import {
  StorageSharedKeyCredential,
  StorageSharedKeyCredentialPolicy,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob'
import {
  getSharedKeyAuthorization,
  getCanonicalizedAzureHeaders,
  getCanonicalizedAzureResource,
} from '../src/azure/signature'
import { azureSignUrl } from '../src/azure/signatureUrl'

const ACCOUNT = 'myaccount'
const ACCOUNT_KEY = fromUint8Array(new Uint8Array(32).fill(7))
const OPTIONS = {
  accessKeyId: ACCOUNT,
  accessKeySecret: ACCOUNT_KEY,
  bucket: 'mycontainer',
  secure: true,
}

class ExposedSharedKeyPolicy extends StorageSharedKeyCredentialPolicy {
  exposeSign(request: any): any {
    return this.signRequest(request)
  }
}

function mockRequest(url: string, body?: string, headers: Record<string, string> = {}) {
  const map = new Map(Object.entries(headers))
  return {
    method: body ? 'PUT' : 'GET',
    url,
    body,
    headers: {
      set: (name: string, value: any) => {
        map.set(name, String(value))
      },
      get: (name: string) => map.get(name),
      headersArray: () => [...map.entries()].map(([name, value]) => ({ name, value })),
    },
  }
}

// Deterministic clock so both implementations sign the same instant.
const FIXED_NOW = '2026-09-01T00:00:00.000Z'
const RealDate = Date
class FixedDate extends RealDate {
  constructor(...args: any[]) {
    if (args.length === 0) super(FIXED_NOW)
    else super(...(args as [any]))
  }
  static now(): number {
    return new RealDate(FIXED_NOW).getTime()
  }
}
;(globalThis as any).Date = FixedDate

function officialSharedKey(
  url: string,
  body: string | undefined,
  headers: Record<string, string>,
): string {
  const cred = new StorageSharedKeyCredential(ACCOUNT, ACCOUNT_KEY)
  const policy = new ExposedSharedKeyPolicy(undefined as any, {} as any, cred)
  const signed = policy.exposeSign(mockRequest(url, body, headers) as any)
  const authorization = signed.headers.get('Authorization')
  const date = signed.headers.get('x-ms-date')
  return { authorization, date } as any
}

let failures = 0
function check(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (err) {
    failures += 1
    console.error(`FAIL  ${name}\n${err instanceof Error ? err.message : String(err)}`)
  }
}

// Deterministic clock so both implementations sign the same instant.

console.log('SharedKey authorization vs @azure/storage-common:')

check('Put Blob with meta, query and Content-MD5', () => {
  // The official policy sets x-ms-date itself; fix the clock via the
  // string we hand it, then reuse the same value for tiny-oss.
  const headers = {
    'Content-Type': 'text/plain',
    'Content-Md5': 'abc==',
    'x-ms-blob-type': 'BlockBlob',
    'x-ms-meta-title': 'T',
    'x-ms-version': '2020-12-06',
  }
  // Override Date so both sides see the same timestamp: the policy sets
  // x-ms-date from the real clock, so patch it after signing is not
  // possible; instead pass a fixed x-ms-date and let the policy keep it?
  // The policy overwrites it, so we compare against the value the
  // policy chose, using tiny-oss with that exact header.
  const { authorization } = officialSharedKey(
    'https://myaccount.blob.core.windows.net/mycontainer/dir/my%20file.txt?comp=block&blockid=MDAwMDE%3D',
    'part-data',
    headers,
  )
  assert.match(authorization, /^SharedKey myaccount:[A-Za-z0-9+/=]+$/)
  console.log(`    official: ${authorization}`)
})

// The clock-based comparison needs both sides on the same instant, which
// the policy does not expose for injection. Instead, recompute tiny-oss
// with the exact x-ms-date the policy generated.
check('Put Blob matches official for identical headers', () => {
  const headersIn = {
    'Content-Type': 'text/plain',
    'Content-Md5': 'abc==',
    'x-ms-blob-type': 'BlockBlob',
    'x-ms-meta-title': 'T',
    'x-ms-version': '2020-12-06',
  }
  const url =
    'https://myaccount.blob.core.windows.net/mycontainer/dir/my%20file.txt?comp=block&blockid=MDAwMDE%3D'
  const { authorization, date } = officialSharedKey(url, 'part-data', headersIn)
  const mine = getSharedKeyAuthorization({
    verb: 'PUT',
    headers: {
      'x-ms-date': date,
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-meta-title': 'T',
      'x-ms-version': '2020-12-06',
    },
    pathname: '/mycontainer/dir/my%20file.txt',
    query: { comp: 'block', blockid: 'MDAwMDE=' },
    account: ACCOUNT,
    accountKey: ACCOUNT_KEY,
    contentMd5: 'abc==',
    contentType: 'text/plain',
    contentLength: 9,
  })
  assert.equal(mine, authorization)
  console.log(`    identical: ${authorization}`)
})

check('GET without body matches official', () => {
  const url = 'https://myaccount.blob.core.windows.net/mycontainer/blob.txt'
  const { authorization, date } = officialSharedKey(url, undefined, {
    'x-ms-version': '2020-12-06',
  })
  const mine = getSharedKeyAuthorization({
    verb: 'GET',
    headers: { 'x-ms-date': date, 'x-ms-version': '2020-12-06' },
    pathname: '/mycontainer/blob.txt',
    account: ACCOUNT,
    accountKey: ACCOUNT_KEY,
  })
  assert.equal(mine, authorization)
  console.log(`    GET: ${authorization}`)
})

check('UTF-8 blob name with query matches official', () => {
  const url =
    'https://myaccount.blob.core.windows.net/mycontainer/%E7%9B%AE%E5%BD%95/%E6%96%87%E4%BB%B6.txt?comp=metadata&timeout=20'
  const { authorization, date } = officialSharedKey(url, undefined, {
    'x-ms-version': '2020-12-06',
  })
  const mine = getSharedKeyAuthorization({
    verb: 'GET',
    headers: { 'x-ms-date': date, 'x-ms-version': '2020-12-06' },
    pathname: '/mycontainer/%E7%9B%AE%E5%BD%95/%E6%96%87%E4%BB%B6.txt',
    query: { comp: 'metadata', timeout: '20' },
    account: ACCOUNT,
    accountKey: ACCOUNT_KEY,
  })
  assert.equal(mine, authorization)
})

console.log('SAS vs @azure/storage-blob (fixed clock):')
try {
  check('read URL (space in name)', () => {
    const oracle = generateBlobSASQueryParameters(
      {
        containerName: 'mycontainer',
        blobName: 'dir/file name.txt',
        permissions: 'r',
        expiresOn: new Date(FixedDate.now() + 60000),
        version: '2020-12-06',
      },
      new StorageSharedKeyCredential(ACCOUNT, ACCOUNT_KEY),
    )
    const url = azureSignUrl(OPTIONS, 'dir/file name.txt', { expires: 60 })
    const u = new URL(url)
    assert.equal(u.searchParams.get('sig'), oracle.signature)
    const se = new Date(FixedDate.now() + 60000).toISOString()
    assert.equal(u.searchParams.get('se'), se.substring(0, se.length - 5) + 'Z')
    console.log(`    read sig: ${oracle.signature}`)
  })

  check('write URL with UTF-8 blob name', () => {
    const oracle = generateBlobSASQueryParameters(
      {
        containerName: 'mycontainer',
        blobName: '目录/文件.txt',
        permissions: 'w',
        expiresOn: new Date(FixedDate.now() + 300000),
        version: '2020-12-06',
      },
      new StorageSharedKeyCredential(ACCOUNT, ACCOUNT_KEY),
    )
    const url = azureSignUrl(OPTIONS, '目录/文件.txt', { method: 'PUT', expires: 300 })
    assert.equal(new URL(url).searchParams.get('sig'), oracle.signature)
    console.log(`    write sig: ${oracle.signature}`)
  })

  check('response-header overrides', () => {
    const oracle = generateBlobSASQueryParameters(
      {
        containerName: 'mycontainer',
        blobName: 'a.txt',
        permissions: 'r',
        expiresOn: new Date(FixedDate.now() + 60000),
        version: '2020-12-06',
        cacheControl: 'max-age=3600',
        contentType: 'text/plain',
        contentDisposition: 'attachment',
      },
      new StorageSharedKeyCredential(ACCOUNT, ACCOUNT_KEY),
    )
    const url = azureSignUrl(OPTIONS, 'a.txt', {
      expires: 60,
      response: {
        'cache-control': 'max-age=3600',
        'content-type': 'text/plain',
        'content-disposition': 'attachment',
      },
    })
    assert.equal(new URL(url).searchParams.get('sig'), oracle.signature)
    console.log(`    response-override sig: ${oracle.signature}`)
  })
} finally {
  ;(globalThis as any).Date = RealDate
}

console.log('canonicalized strings vs the MSDN example:')
check('documentation vector', () => {
  const headers = { 'x-ms-date': 'Fri, 26 Jun 2015 23:39:12 GMT', 'x-ms-version': '2015-02-21' }
  assert.equal(
    getCanonicalizedAzureHeaders(headers) +
      getCanonicalizedAzureResource('myaccount', '/mycontainer', {
        comp: 'metadata',
        restype: 'container',
        timeout: '20',
      }),
    'x-ms-date:Fri, 26 Jun 2015 23:39:12 GMT\nx-ms-version:2015-02-21\n/myaccount/mycontainer\ncomp:metadata\nrestype:container\ntimeout:20',
  )
})

if (failures > 0) {
  console.error(`\n${failures} oracle check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll azure oracle checks passed.')
