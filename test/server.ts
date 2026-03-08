import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import aliOss from 'ali-oss';

const { STS } = aliOss;

const autoKill = process.env.AUTO_KILL;
const accessKeyId = process.env.OSS_ACCESS_KEY_ID as string;
const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET as string;
const bucket = process.env.OSS_BUCKET;
const region = process.env.OSS_REGION;
const endpoint = process.env.OSS_ENDPOINT;
const arn = process.env.OSS_ARN as string;

const app = new Hono();
const PORT = 8080;

// CORS middleware - allow any domain
app.use(async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  c.header('Access-Control-Allow-Credentials', 'true');

  if (c.req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  await next();
});

let lastReqTime = Date.now();

app.use(async (c, next) => {
  lastReqTime = Date.now();
  await next();
});

app.get('/api/oss-config', (c) => {
  return c.json({
    accessKeyId,
    accessKeySecret,
    bucket,
    region,
    endpoint,
  });
});

app.get('/api/sts', async (c) => {
  const sts = new STS({
    accessKeyId,
    accessKeySecret,
  });
  // 60 mins
  const expires = 60 * 60;
  const sessionName = 'foo';
  const stsToken = await sts.assumeRole(arn, undefined, expires, sessionName);
  return c.json({
    bucket,
    region,
    endpoint,
    stsToken,
  });
});

serve({
  fetch: app.fetch,
  port: PORT,
});
console.log('listening on port %s', PORT);

if (autoKill) {
  setInterval(() => {
    if (Date.now() - lastReqTime > 5000) {
      process.exit(0);
    }
  }, 500);
}
