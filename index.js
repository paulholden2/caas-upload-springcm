const path = require('path');
const async = require('async');
const _ = require('lodash');
const rc = require('rc');
const winston = require('winston');
const etoj = require('utils-error-to-json');
const commander = require('commander');
const task = require('./task');
const WinstonCloudWatch = require('winston-cloudwatch');

require('winston-daily-rotate-file');

var config = rc('caas');

commander
  .version('0.1.0', '-v, --version', 'Display the current software version')
  .option('-c, --config [path]', 'Specify a configuration file to load')
  .parse(process.argv);

var fileTransport, consoleTransport, cwlTransport;

async.waterfall([
  (callback) => {
    /**
     * Configure the default Winston logger with any custom transports we
     * want to use. We have to use the default so that it can be easily
     * shared across different files.
     *
     * Also set up an unhandled exception logger, so that if the service
     * ever crashes, we have a log dump of the thrown exception to review.
     */

    // Daily rotating log files stored locally
    fileTransport = new (winston.transports.DailyRotateFile)({
      level: 'info',
      format: winston.format.json(),
      filename: path.join(__dirname, 'logs', 'log-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d'
    });

    consoleTransport = new (winston.transports.Console)({
      level: 'info',
      format: winston.format.simple(),
    });

    var transports = [
      consoleTransport,
      fileTransport
    ];

    var cw = _.get(config, 'upload-springcm.logs.cloudwatch');

    if (cw) {
      // Set up logging to AWS CloudWatch Logs
      cwlTransport = new WinstonCloudWatch(_.merge(cw, {
        messageFormatter: (entry) => {
          return JSON.stringify(_.get(entry, 'meta'));
        }
      }));

      transports.push(cwlTransport);
    }

    // Set up default logger with our transports
    winston.configure({
      transports: transports
    });

    // Set up unhandled exception logging to our local log files and console
    winston.exceptions.handle(transports);

    winston.info('========================================');
    winston.info('caas-upload-springcm');
    winston.info('========================================');

    callback();
  },
  (callback) => {
    /**
     * Run each configured upload task
     */

    async.eachSeries(_.get(config, 'upload-springcm.tasks'), task, callback);
  }
], (err) => {
  /**
   * Log any error and exit.
   */

  var code = 0;

  if (err) {
    code = 1;
    winston.error(err.message, {
      err: etoj(err)
    });
  }

  async.parallel([
    (callback) => fileTransport.on('finished', callback),
    (callback) => consoleTransport.on('finished', callback),
    (callback) => {
      if (cwlTransport) {
        cwlTransport.kthxbye(callback)
      } else {
        callback();
      }
    }
  ], () => {
    process.exit(code);
  });
});
