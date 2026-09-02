// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getAwsSignature,
  awsUriEscape,
  awsUriEscapePath,
  iso8601,
  canonicalQueryString,
} from '../src/aws/signature'
import { awsSignUrl } from '../src/aws/signatureUrl'
// Official AWS SDK v2 used as an oracle: our SigV4 signer must produce
// byte-identical Authorization headers and pre-signed URLs.
import AWS from 'aws-sdk'

const AK = 'AKIDEXAMPLE'
const SK = 'SECRETKEY'
const REGION = 'us-east-1'
const BUCKET = 'examplebucket'
const AMZ_DATE = '20260901T000000Z'

function makeS3(pathStyle = false, endpoint?: string) {
  return new AWS.S3({
    region: REGION,
    accessKeyId: AK,
    secretAccessKey: SK,
    signatureVersion: 'v4',
    sessionToken: 'TOKEN',
    s3ForcePathStyle: pathStyle,
    ...(endpoint ? { endpoint } : {}),
  })
}

interface OracleResult {
  auth: string
  ua?: string
  contentSha256?: string
  contentMd5?: string
}

function authFor(
  verb: string,
  key: string,
  query?: Record<string, string>,
  pathStyle = false,
): OracleResult {
  const s3 = makeS3(pathStyle, pathStyle ? 'minio.example.com' : undefined)
  let req: AWS.Request<any, any>
  if (verb === 'PUT' && query && query.partNumber) {
    req = s3.uploadPart({
      Bucket: BUCKET,
      Key: key,
      PartNumber: parseInt(query.partNumber, 10),
      UploadId: query.uploadId,
      Body: 'x',
    })
  } else if (verb === 'POST' && query && query.uploads !== undefined) {
    req = s3.createMultipartUpload({ Bucket: BUCKET, Key: key })
  } else if (verb === 'DELETE' && query && query.uploadId) {
    req = s3.abortMultipartUpload({ Bucket: BUCKET, Key: key, UploadId: query.uploadId })
  } else if (verb === 'GET' && query && query.uploadId) {
    req = s3.listParts({
      Bucket: BUCKET,
      Key: key,
      UploadId: query.uploadId,
      MaxParts: query['max-parts'] ? parseInt(query['max-parts'], 10) : undefined,
      PartNumberMarker: query['part-number-marker']
        ? parseInt(query['part-number-marker'], 10)
        : undefined,
    })
  } else if (verb === 'GET' && query && query.uploads !== undefined) {
    req = s3.listMultipartUploads({ Bucket: BUCKET })
  } else if (verb === 'PUT') {
    req = s3.putObject({ Bucket: BUCKET, Key: key, Body: 'x' })
  } else {
    req = s3.getObject({ Bucket: BUCKET, Key: key })
  }
  req.build()
  return {
    auth: req.httpRequest.headers.Authorization,
    ua: req.httpRequest.headers['X-Amz-User-Agent'],
    contentSha256: req.httpRequest.headers['X-Amz-Content-Sha256'],
    contentMd5: req.httpRequest.headers['Content-MD5'],
  }
}

function buildMine(
  verb: string,
  key: string,
  query: Record<string, any> | undefined,
  oracle: OracleResult,
  pathStyle = false,
): string {
  const headers: Record<string, any> = {
    host: pathStyle ? 'minio.example.com' : `${BUCKET}.s3.amazonaws.com`,
    'x-amz-date': AMZ_DATE,
    'x-amz-content-sha256': oracle.contentSha256 || 'UNSIGNED-PAYLOAD',
    'x-amz-security-token': 'TOKEN',
  }
  if (oracle.ua) headers['x-amz-user-agent'] = oracle.ua
  if (oracle.contentMd5) headers['Content-MD5'] = oracle.contentMd5
  const objectPath = `/${awsUriEscapePath(key)}`
  const sig = getAwsSignature({
    method: verb,
    pathname: pathStyle ? `/${BUCKET}${objectPath}` : objectPath,
    query,
    headers,
    accessKeyId: AK,
    secretAccessKey: SK,
    region: REGION,
    date: AMZ_DATE,
  })
  return `AWS4-HMAC-SHA256 Credential=${AK}/${sig.credentialScope}, SignedHeaders=${sig.signedHeaders}, Signature=${sig.signature}`
}

describe('getAwsSignature matches the official AWS SDK v2 (oracle)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const cases: Array<{ name: string; verb: string; key: string; query?: Record<string, string> }> =
    [
      { name: 'plain GET', verb: 'GET', key: 'exampleobject' },
      { name: 'object key with non-ASCII characters', verb: 'GET', key: '中文 文件.txt' },
      { name: 'object key with subdirectories', verb: 'GET', key: 'dir/sub dir/file.txt' },
      {
        name: 'uploadPart with partNumber and uploadId',
        verb: 'PUT',
        key: 'bigfile.bin',
        query: { partNumber: '1', uploadId: 'u123' },
      },
      {
        name: 'listParts with max-parts and part-number-marker',
        verb: 'GET',
        key: 'bigfile.bin',
        query: { uploadId: 'u123', 'max-parts': '10', 'part-number-marker': '3' },
      },
      {
        name: 'initiate multipart upload (?uploads)',
        verb: 'POST',
        key: 'bigfile.bin',
        query: { uploads: '' },
      },
      {
        name: 'DELETE with uploadId',
        verb: 'DELETE',
        key: 'bigfile.bin',
        query: { uploadId: 'u456' },
      },
    ]

  for (const c of cases) {
    it(c.name, () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'))
      const oracle = authFor(c.verb, c.key, c.query)
      const mine = buildMine(c.verb, c.key, c.query, oracle)
      expect(mine).toBe(oracle.auth)
    })
  }

  it('path-style addressing (MinIO/R2) matches s3ForcePathStyle', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'))
    const oracle = authFor('PUT', 'dir/file.txt', { partNumber: '1', uploadId: 'u1' }, true)
    const mine = buildMine('PUT', 'dir/file.txt', { partNumber: '1', uploadId: 'u1' }, oracle, true)
    expect(mine).toBe(oracle.auth)
  })

  it('uses the current time for the default amz date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'))
    const sig = getAwsSignature({
      method: 'GET',
      pathname: '/x',
      headers: {
        host: `${BUCKET}.s3.amazonaws.com`,
        'x-amz-date': iso8601(new Date()),
        'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      },
      accessKeyId: AK,
      secretAccessKey: SK,
      region: REGION,
    })
    expect(sig.amzDate).toBe(AMZ_DATE)
    expect(sig.credentialScope).toBe(`20260901/${REGION}/s3/aws4_request`)
  })

  it('throws without credentials', () => {
    expect(() =>
      getAwsSignature({
        method: 'GET',
        pathname: '/x',
        headers: { host: 'h' },
        accessKeyId: '',
        secretAccessKey: SK,
        region: REGION,
      }),
    ).toThrow(/accessKeyId|SecretKey|secret/)
  })
})

describe('awsSignUrl matches the official AWS SDK v2 (oracle)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const cases: Array<{ name: string; key: string; urlOptions?: Record<string, any> }> = [
    { name: 'plain GET download', key: 'exampleobject', urlOptions: { expires: 60 } },
    {
      name: 'object key with non-ASCII characters',
      key: '中文 文件.txt',
      urlOptions: { expires: 60 },
    },
    {
      name: 'response-* headers',
      key: 'exampleobject',
      urlOptions: {
        expires: 60,
        response: { 'content-disposition': 'attachment', 'content-type': 'text/plain' },
      },
    },
    { name: 'custom expires', key: 'exampleobject', urlOptions: { expires: 300 } },
  ]

  for (const c of cases) {
    it(c.name, () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'))
      const s3 = makeS3()
      const official = s3.getSignedUrl('getObject', {
        Bucket: BUCKET,
        Key: c.key,
        Expires: c.urlOptions!.expires!,
        ...(c.urlOptions && c.urlOptions.response
          ? {
              ResponseContentDisposition: c.urlOptions.response['content-disposition'],
              ResponseContentType: c.urlOptions.response['content-type'],
            }
          : {}),
      })
      const mine = awsSignUrl(
        {
          accessKeyId: AK,
          accessKeySecret: SK,
          region: REGION,
          bucket: BUCKET,
          secure: true,
          stsToken: 'TOKEN',
        },
        c.key,
        c.urlOptions as any,
      )
      expect(mine).toBe(official)
    })
  }

  it('defaults to 1800s validity like the OSS entry', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'))
    const url = awsSignUrl(
      { accessKeyId: AK, accessKeySecret: SK, region: REGION, bucket: BUCKET, secure: true },
      'exampleobject',
    )
    expect(url).toContain('X-Amz-Expires=1800')
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256')
    expect(url).toContain('X-Amz-SignedHeaders=host')
    expect(url).toContain(`X-Amz-Credential=${AK}%2F20260901%2F${REGION}%2Fs3%2Faws4_request`)
  })
})

describe('awsUriEscape and canonicalQueryString', () => {
  it('escapes * but keeps unreserved characters', () => {
    expect(awsUriEscape('a b*c')).toBe('a%20b%2Ac')
    expect(awsUriEscape('a/b')).toBe('a%2Fb')
  })

  it('sorts and escapes query params', () => {
    expect(canonicalQueryString({ b: '2', a: '1 0' })).toBe('a=1%200&b=2')
    expect(canonicalQueryString({ uploads: '' })).toBe('uploads=')
  })
})
