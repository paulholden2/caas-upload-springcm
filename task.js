const fs = require('fs');
const path = require('path');
const glob = require('glob');
const async = require('async');
const _ = require('lodash');
const winston = require('winston');
const etoj = require('utils-error-to-json');
const SpringCM = require('springcm-node-sdk');
const rimraf = require('rimraf');

module.exports = (task, callback) => {
  var auth = _.get(task, 'auth');
  var springCm;

  async.waterfall([
    (callback) => {
      /**
       * Connect to SpringCM
       */

      winston.info('Connecting to SpringCM', {
        clientId: _.get(auth, 'clientId'),
        dataCenter: _.get(auth, 'dataCenter')
      });

      var client = new SpringCM(auth);

      client.connect((err) => {
        if (err) {
          return callback(err);
        }

        springCm = client;

        callback();
      });
    },
    (callback) => {
      async.eachSeries(_.get(task, 'paths'), (pathConfig, callback) => {
        var remote = _.get(pathConfig, 'remote');
        var local = _.get(pathConfig, 'local');
        var triggers = _.get(pathConfig, 'trigger');
        var filter = _.get(pathConfig, 'filter');
        var triggerFile;

        // To exit waterfall early
        const escape = callback;

        var remoteDir;

        async.waterfall([
          (callback) => {
            springCm.getFolder(remote, (err, folder) => {
              if (err) {
                return callback(err);
              }

              remoteDir = folder;

              callback();
            });
          },
          (callback) => {
            if (_.isString(triggers)) {
              triggers = [ triggers ];
            }

            if (!_.isArray(triggers)) {
              return callback(new Error('Invalid trigger pattern(s)'));
            }

            var mg = {
              nodir: true,
              nosort: true,
              cwd: local
            };

            var triggerFiles = []

            async.eachSeries(triggers, (trigger, callback) => {
              mg = new glob.Glob(trigger, mg, (err, files) => {
                if (err) {
                  return callback(err);
                }

                triggerFiles = _.uniq(_.concat(triggerFiles, files));

                var count = triggerFiles.length;

                winston.info(`Found ${count} trigger file${count !== 1 ? 's' : ''}`, {
                  fileList: count > 0 ? triggerFiles : undefined,
                  fileCount: count,
                  workingDirectory: local,
                  pattern: trigger
                });

                callback();
              });
            }, (err) => {
              if (err) {
                return callback(err);
              }

              if (triggerFiles.length > 0) {
                callback(null, triggerFiles);
              } else {
                escape();
              }
            });
          },
          (triggerFiles, callback) => {
            /**
             * Deliver the contents of the folder containing each found
             * trigger file
             */

            triggerFiles = triggerFiles.map((triggerFile) => {
              return path.join(local, triggerFile);
            });

            async.eachSeries(triggerFiles, (triggerFile, callback) => {
              var directory = path.dirname(triggerFile);

              // TODO: Move as much as possible into a separate function
              async.waterfall([
                (callback) => {
                  /**
                   * Get a listing of files filtered in.
                   */

                  var filteredIn = [];
                  var inGlobs = _.concat([], _.get(pathConfig, 'filter.in'));

                  var mg = {
                    nodir: true,
                    nosort: true,
                    cwd: directory
                  }

                  async.eachSeries(inGlobs, (pattern, callback) => {
                    mg = new glob.Glob(pattern, mg, (err, files) => {
                      if (err) {
                        return callback(err);
                      }

                      filteredIn = _.uniq(_.concat(filteredIn, files));

                      callback();
                    });
                  }, (err) => {
                    if (err) {
                      return callback(err);
                    }

                    callback(null, mg, filteredIn);
                  });
                },
                (mg, filteredIn, callback) => {
                  /**
                   * Get a listing of files filtered out, and apply the
                   * difference.
                   */

                  var filteredOut = [];
                  var outGlobs = _.concat([], _.get(pathConfig, 'filter.out'));

                  // If no out filters provided
                  if (outGlobs.length === 0) {
                    return callback(null, filteredIn);
                  }

                  async.eachSeries(outGlobs, (pattern, callback) => {
                    mg = new glob.Glob(pattern, mg, (err, files) => {
                      if (err) {
                        return callback(err);
                      }

                      filteredOut = _.uniq(_.concat(filteredOut, files));

                      callback();
                    });
                  }, (err) => {
                    if (err) {
                      return callback(err);
                    }

                    callback(null, _.difference(filteredIn, filteredOut));
                  });
                },
                (fileList, callback) => {
                  callback(null, _.map(fileList, file => path.join(directory, file)));
                },
                (fileList, callback) => {
                  winston.info('Upload manifest', {
                    triggerFile: triggerFile,
                    fileList: fileList
                  });

                  async.eachSeries(fileList, (file, callback) => {
                    winston.info('Uploading file', {
                      file: file,
                      destination: remote
                    });

                    var filename = path.basename(file);
                    var extname = path.extname(filename).slice(1);

                    springCm.uploadDocument(remoteDir, fs.createReadStream(file), {
                      name: filename,
                      fileType: extname
                    }, callback);
                  }, callback);
                },
                (callback) => {
                  winston.info('Deleting trigger file', {
                    triggerFile: triggerFile
                  });

                  fs.unlink(triggerFile, callback);
                },
                (callback) => {
                  /**
                   * Remove delivery folder
                   */

                  if (!_.get(pathConfig, 'delete')) {
                    return callback();
                  }

                  winston.info('Removing delivery folder', {
                    directory: directory
                  });

                  rimraf(directory, {
                    disableGlob: true
                  }, callback);
                }
              ], callback); // triggerFile waterfall
            }, callback); // eachSeries triggerFile
          }
        ], callback); // pathConfig waterfall
      }, callback); // eachSeries pathConfig
    }
  ], (err) => {
    if (err) {
      winston.error(err.message, {
        err: etoj(err)
      });
    }

    if (springCm) {
      winston.info('Disconnecting from SpringCM');

      springCm.close(callback);
    } else {
      callback();
    }
  });
};
