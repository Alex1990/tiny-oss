function getObjectName() {
  return Math.random().toString(16) + Date.now();
}

describe('TinyOSS', () => {
  it('should throw if missing options', () => {
    function init() {
      return new TinyOSS();
    }
    expect(init).to.throw();
  });

  it('should initantiate successfully', (done) => {
    axios.get('/api/oss-config')
      .then((res) => {
        const {
          accessKeyId,
          accessKeySecret,
          region,
          bucket,
        } = res.data;
        const tinyOss = new TinyOSS({
          accessKeyId,
          accessKeySecret,
          region,
          bucket,
        });
        expect(tinyOss.opts).to.have.property('accessKeyId', accessKeyId);
        expect(tinyOss.opts).to.have.property('accessKeySecret', accessKeySecret);
        expect(tinyOss.opts).to.have.property('region', region);
        expect(tinyOss.opts).to.have.property('bucket', bucket);
        done();
      })
      .catch((err) => {
        done(err);
      });
  });

  it('put', (done) => {
    const content = 'hello 你好';
    const objectName = getObjectName();
    let oss = null;
    let tinyOss = null;

    axios.get('/api/oss-config')
      .then((res) => {
        const {
          accessKeyId,
          accessKeySecret,
          region,
          bucket,
        } = res.data;
        tinyOss = new TinyOSS({
          accessKeyId,
          accessKeySecret,
          region,
          bucket,
        });
        oss = new OSS({
          accessKeyId,
          accessKeySecret,
          region,
          bucket,
        });
        const blob = new Blob([content], { type: 'text/plain' });
        return tinyOss.put(objectName, blob);
      })
      .then(() => {
        const url = oss.signatureUrl(objectName);
        return axios.get(url, { responseType: 'text' })
          .then((res) => {
            expect(res.data).to.equal(content);
            done();
          });
      })
      .catch((err) => {
        done(err);
      });
  });

  it('signatureUrl', (done) => {
    const content = 'hello 你好';
    const objectName = getObjectName();
    let oss = null;
    let tinyOss = null;

    axios.get('/api/oss-config')
      .then((res) => {
        const {
          accessKeyId,
          accessKeySecret,
          region,
          bucket,
        } = res.data;
        tinyOss = new TinyOSS({
          accessKeyId,
          accessKeySecret,
          region,
          bucket,
        });
        oss = new OSS({
          accessKeyId,
          accessKeySecret,
          region,
          bucket,
        });
        const blob = new Blob([content], { type: 'text/plain' });
        return oss.put(objectName, blob);
      })
      .then(() => {
        const url = tinyOss.signatureUrl(objectName);
        return axios.get(url, { responseType: 'text' })
          .then((res) => {
            expect(res.data).to.equal(content);
            done();
          });
      })
      .catch((err) => {
        done(err);
      });
  });
});
