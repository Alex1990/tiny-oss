require('dotenv').config();
const path = require('path');
const Koa = require('koa');
const serve = require('koa-static');

const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
const bucket = process.env.OSS_BUCKET;
const region = process.env.OSS_REGION;
const endpoint = process.env.OSS_ENDPOINT;

const root = process.cwd();
const app = new Koa();
const PORT = 8080;

app.use(serve(path.resolve(__dirname)));
app.use(serve(path.join(root, 'dist')));

app.use(async (ctx, next) => {
  if (ctx.path === '/api/oss-config') {
    ctx.body = {
      accessKeyId,
      accessKeySecret,
      bucket,
      region,
      endpoint,
    };
  }
  next();
});

app.listen(PORT);

console.log('listening on port %s', PORT);
