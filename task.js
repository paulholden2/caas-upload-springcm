const fs = require('fs');
const path = require('path');
const glob = require('glob');
const async = require('async');
const _ = require('lodash');
const winston = require('winston');
const etoj = require('utils-error-to-json');
const SpringCM = require('springcm-node-sdk');

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

        async.waterfall([
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

                winston.info('Found trigger file(s)', {
                  files: triggerFiles,
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
             * Map each directory containing a trigger to its filtered
             * file listing.
             */
            var directories = _.uniq(_.map(triggerFiles, (file) => {
              return path.join(local, path.dirname(file));
            }));

            // Map each directory
            async.mapSeries(directories, (directory, callback) => {
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
                }
              ], callback);
            }, callback);
          },
          (listing, callback) => {
            /**
             * Listing is currently an array of arrays: one array for each
             * directory a trigger file was found in. Flatten it before
             * beginning upload.
             */

            callback(null, _.flatten(listing));
          },
          (listing, callback) => {
            winston.info('Upload manifest', {
              listing: listing
            });

            async.eachSeries(listing, (file, callback) => {
              // Upload
              callback();
            }, callback)
          },
          (callback) => {
            if (_.get(pathConfig, 'delete')) {
              // rimraf folder
              callback();
            } else {
              // delete trigger file so we don't deliver multiple times
              callback();
            }
          }
        ], callback);
      }, callback);
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
