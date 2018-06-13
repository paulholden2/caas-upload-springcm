const path = require('path');
const async = require('async');
const _ = require('lodash');
const winston = require('winston');
const commander = require('commander');

require('winston-daily-rotate-file');

commander
  .version('0.1.0', '-v, --version', 'Display the current software version')
  .option('-c, --config [path]', 'Specify a configuration file to load')
  .parse(process.argv);

var fileTransport, consoleTransport;

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

     var fileFormat = winston.format.printf((info, opts) => {
       return `${info.timestamp} - ${info.level}: ${info.message}`
     });

    // Daily rotating log files stored locally
    fileTransport = new (winston.transports.DailyRotateFile)({
      level: 'info',
      format: winston.format.combine(winston.format.timestamp(), winston.format.prettyPrint(), fileFormat),
      filename: path.join(__dirname, 'logs', 'log-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d'
    });

    consoleTransport = new (winston.transports.Console)({
      level: 'info',
      format: winston.format.simple()
    });

    // Set up default logger with our transports
    winston.configure({
      transports: [
        consoleTransport,
        fileTransport
      ]
    });

    // Set up unhandled exception logging to our local log files and console
    winston.exceptions.handle([ consoleTransport, fileTransport ]);

    winston.info('========================================');
    winston.info('caas-upload-springcm');
    winston.info('========================================');

    callback();
  }
], (err) => {
  /**
   * Log any error and exit.
   */

  var code = 0;

  if (err) {
    code = 1;
    winston.error(err);
  }

  async.parallel([
    callback => fileTransport.on('finished', callback),
    callback => consoleTransport.on('finished', callback)
  ], () => {
    process.exit(code);
  });
});
