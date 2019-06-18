// Karma configuration
module.exports = function (config) {
  config.set({

    // base path that will be used to resolve all patterns (eg. files, exclude)
    basePath: '',


    // frameworks to use
    // available frameworks: https://npmjs.org/browse/keyword/karma-adapter
    frameworks: ['mocha'],


    // list of files / patterns to load in the browser
    files: [
      'node_modules/es6-promise/dist/es6-promise.auto.js',
      'node_modules/chai/chai.js',
      'node_modules/axios/dist/axios.js',
      'node_modules/ali-oss/dist/aliyun-oss-sdk.js',
      'dist/tiny-oss.js',
      'test/setup.js',
      'test/index.spec.js',
    ],


    // test results reporter to use
    // possible values: 'dots', 'progress'
    // available reporters: https://npmjs.org/browse/keyword/karma-reporter
    reporters: ['progress', 'coverage'],

    preprocessors: {
      'dist/tiny-oss.js': ['coverage'],
    },

    coverageReporter: {
      reporters: [
        { type: 'lcovonly', subdir: '.' },
        { type: 'json', subdir: '.' },
      ],
    },

    proxies: {
      '/api': 'http://127.0.0.1:8080/api',
    },

    // web server port
    port: 9876,


    // enable / disable colors in the output (reporters and logs)
    colors: true,


    // level of logging
    // possible values:
    //
    // * config.LOG_DISABLE
    // * config.LOG_ERROR
    // * config.LOG_WARN
    // * config.LOG_INFO
    // * config.LOG_DEBUG
    logLevel: config.LOG_DEBUG,


    // enable / disable watching file and executing tests whenever any file changes
    autoWatch: false,


    // start these browsers
    // available browser launchers: https://npmjs.org/browse/keyword/karma-launcher
    browsers: ['ChromeNoSandboxHeadless'],

    customLaunchers: {
      ChromeNoSandboxHeadless: {
        base: 'Chrome',
        flags: [
          '--no-sandbox',
          '--headless',
          '--disable-gpu',
          '--remote-debugging-port=9222',
        ],
      },
    },


    // Continuous Integration mode
    // if true, Karma captures browsers, runs the tests and exits
    singleRun: true,

    // Concurrency level
    // how many browser should be started simultaneous
    concurrency: Infinity,
  });
};
