import 'dotenv/config';
import Koa from 'koa';
import aliOss from 'ali-oss';
import type { Context, Next } from 'koa';

const { STS } = aliOss;

const autoKill = process.env.AUTO_KILL;
const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
const bucket = process.env.OSS_BUCKET;
const region = process.env.OSS_REGION;
const endpoint = process.env.OSS_ENDPOINT;
const arn = process.env.OSS_ARN;

const app = new Koa();
const PORT = 8080;

// CORS middleware - allow any domain
app.use(async (ctx: Context, next: Next) => {
  ctx.set('Access-Control-Allow-Origin', '*');
  ctx.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  ctx.set('Access-Control-Allow-Credentials', 'true');

  if (ctx.method === 'OPTIONS') {
    ctx.status = 204;
    return;
  }

  await next();
});

let lastReqTime = Date.now();

app.use(async (ctx: Context, next: Next) => {
  lastReqTime = Date.now();
  if (ctx.path === '/api/oss-config') {
    ctx.body = {
      accessKeyId,
      accessKeySecret,
      bucket,
      region,
      endpoint,
    };
  }
  if (ctx.path === '/api/sts') {
    const sts = new STS({
      accessKeyId,
      accessKeySecret,
    });
    // 60 mins
    const expires = 60 * 60;
    const sessionName = 'foo';
    const stsToken = await sts.assumeRole(arn, undefined, expires, sessionName);
    ctx.body = {
      bucket,
      region,
      endpoint,
      stsToken,
    };
  }
  next();
});

app.listen(PORT);
console.log('listening on port %s', PORT);

if (autoKill) {
  setInterval(() => {
    if (Date.now() - lastReqTime > 5000) {
      process.exit(0);
    }
  }, 500);
}
