$(() => {
  $.ajax({
    url: '/api/oss-config',
    method: 'GET',
    success(ossConfig) {
      const oss = new TinyOSS(ossConfig);
      const objectName = 'foo';
      const blob = new Blob(['0123456789'], { type: 'text/plain' });
      oss.put(objectName, blob)
        .then(() => {
          console.log('put success');
        })
        .catch((err) => {
          console.log('put failed');
          console.error(err);
        });

      oss.signatureUrl(objectName)
        .then((url) => {
          console.log('download url: ', url);
        })
        .catch((err) => {
          console.log('get download url failed');
          console.error(err);
        });
    },
  });
});
