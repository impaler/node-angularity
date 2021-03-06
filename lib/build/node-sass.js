var path              = require('path');
var fs                = require('fs');
var through           = require('through2');
var minimatch         = require('minimatch');
var sass              = require('node-sass');
var gutil             = require('gulp-util');
var slash             = require('gulp-slash');
var rework            = require('rework');
var visit             = require('rework-visit');
var convert           = require('convert-source-map');
var SourceMapConsumer = require('source-map').SourceMapConsumer;
var mime              = require('mime');

/**
 * Search for the relative file reference from the <code>startPath</code> up to, but not including, the process
 * working directory.
 * @param {string} startPath The path to which the <code>relative</code> path might be specified
 * @param {string} relative A possibly relative file path
 * @param {string} [callerPath] The full path of the invoking function instance where recursion has occured
 * @returns {string} dataURI of the file where found or <code>undefined</code> otherwise
 */
function encodeRelativeURL(startPath, relative, callerPath) {

  // ensure we are at a valid start path that is not process working directory
  var absStart  = path.resolve(startPath);
  var parentDir = path.resolve(path.join(absStart, '..'));
  if (fs.existsSync(absStart)) {
    var fullPath = path.resolve(path.join(startPath, relative));
    if (fs.existsSync(fullPath)) {

      // file exists so get the dataURI
      var type     = mime.lookup(fullPath);
      var contents = fs.readFileSync(fullPath);
      var base64   = new Buffer(contents).toString('base64');
      return 'url(data:' + type + ';base64,' + base64 + ')';

    } else if (parentDir !== process.cwd()) { // will not jump across bower or npm packages

      // find parent and child directories
      var childDirs = fs.readdirSync(absStart)
        .map(function toAbsolute(filename) {
          return path.join(absStart, filename);
        }).filter(function directoriesOnly(absolute) {
          return fs.statSync(absolute).isDirectory();
        });

      // recurse paths down and up except the caller path
      //  return the first success
      var result;
      childDirs.concat(parentDir)
        .filter(function excludeCallerDir(absoluteDir) {
          return (absoluteDir !== callerPath);
        })
        .some(function encode(absoluteDir) {
          result = encodeRelativeURL(absoluteDir, relative, absStart);
          return result;
        });

      // may be undefined
      return result;
    }
  } else {
    return;
  }
}

/**
 * @param {number} [bannerWidth] The width of banner comment, zero or omitted for none
 */
module.exports = function (bannerWidth) {
  'use strict';
  var libList  = [ ];

  /**
   * Add string values to the <code>libList</code> uniquely.
   * @param {string|Array} value An explicit library path string or array thereof
   */
  function addUnique(value) {
    if ((typeof value === 'object') && (value instanceof Array)) {
      value.forEach(addUnique);
    } else if ((typeof value === 'string') && (libList.indexOf(value) < 0)) {
      libList.push(value);
    }
  }

  return {

    /**
     * Infer library paths from the <code>base</code> paths in the input stream in preparation for <code>compile</code>.
     * Any arguments given are treated as explicit paths and are added as-is to the library list.
     * Outputs a stream of the same files.
     * @param {...string|Array} Any number of explicit library path strings or arrays thereof
     * @returns {stream.Through} A through stream that performs the operation of a gulp stream
     */
    libraries: function () {
      addUnique(Array.prototype.slice.call(arguments));
      return through.obj(function (file, encoding, done) {
        addUnique(file.base);
        this.push(file);
        done();
      });
    },

    /**
     * Use <code>node-sass</code> to compile the files of the input stream.
     * Uses any library paths defined in <code>libraries</code>. Does not utilise the file content in the input stream.
     * Outputs a stream of compiled files and their source-maps, alternately.
     * @see https://github.com/sass/node-sass#outputstyle
     * @param {string?} outputStyle One of the <code>libsass</code> supported output styles
     * @returns {stream.Through} A through stream that performs the operation of a gulp stream
     */
    compile: function (outputStyle) {
      var output = [ ];
      return through.obj(function (file, encoding, done) {
        var stream = this;

        // setup parameters
        var sourcePath = file.path.replace(path.basename(file.path), '');
        var sourceName = path.basename(file.path, path.extname(file.path));
        var mapName    = sourceName + '.css.map';
        var stats      = { };
        var sourceMapConsumer;

        /**
         * Push file contents to the output stream.
         * @param {string} ext The extention for the file, including dot
         * @param {string|object?} contents The contents for the file or fields to assign to it
         * @return {vinyl.File} The file that has been pushed to the stream
         */
        function pushResult(ext, contents) {
          var pending = new gutil.File({
            cwd:      file.cwd,
            base:     file.base,
            path:     sourcePath + sourceName + ext,
            contents: (typeof contents === 'string') ? new Buffer(contents) : null
          });
          if (typeof contents === 'object') {
            for (var key in contents) {
              pending[key] = contents[key];
            }
          }
          stream.push(pending);
          return pending;
        }

        /**
         * Plugin for css rework that follows SASS transpilation
         * @param {object} stylesheet AST for the CSS output from SASS
         */
        function reworkPlugin(stylesheet) {

          // visit each node (selector) in the stylesheet recursively using the official utility method
          visit(stylesheet, function (declarations, node) {

            // each node may have multiple declarations
            declarations.forEach(function (declaration) {

              // reverse the original source-map to find the original sass file
              var cssStart  = declaration.position.start;
              var sassStart = sourceMapConsumer.originalPositionFor({
                line:   cssStart.line,
                column: cssStart.column
              });
              var sassDir = path.dirname(sassStart.source);

              // allow multiple url() values in the declaration
              //  the url will be every second value (i % 2)
              declaration.value = declaration.value
                .split(/url\s*\(\s*['"]?([^'"?#]*)[^)]*\)/g)  // split by url statements
                .map(function (token, i) {
                  return (i % 2) ? (encodeRelativeURL(sassDir, token) || ('url(' + token + ')')) : token;
                }).join('');
            });
          });
        }

        /**
         * Handler for successful transpilation using node-sass.
         * @param {string} css Compiled css
         * @param {string} map The source-map for the compiled css
         */
        function successHandler(css, map) {

          // adjust sourcemap
          var source = minimatch.makeRe(file.cwd).source
            .replace(/^\^|\$$/g, '')          // match text anywhere on the line by removing line start/end
            .replace(/\\\//g, '[\\\\\\/]') +  // detect any platform path format
            '|\\.\\.\\/';  			              // relative paths are an artifact and must be removed
          var parsable  = slash(map.replace(new RegExp(source, 'g'), ''));
          var sourceMap = JSON.parse(parsable);
          sourceMap.sources.forEach(function (value, i, array) {
            array[i] = path.resolve(value.replace(/^\//, '').replace(/\b\/+\b/g, '/'));  // ensure single slash absolute
          });
          sourceMapConsumer = new SourceMapConsumer(sourceMap);

          // embed sourcemap in css
          var cssWithMap = css.replace(
            /\/\*#\s*sourceMappingURL=[^*]*\*\//m,
            '/*# sourceMappingURL=data:application/json;base64,' + convert.fromObject(sourceMap).toBase64() + ' */'
          );

          // rework css
          var reworked = rework(cssWithMap, '')
            .use(reworkPlugin)
            .toString({
              sourcemap: true,
              sourcemapAsObject: true
            });

          // adjust overall sourcemap
          delete reworked.map.file;
          delete reworked.map.sourcesContent;
          reworked.map.sources.forEach(function (value, i, array) {
            array[i] = '/' + path.relative(process.cwd(), value);   // ensure root relative
          });

          // write stream output
          pushResult('.css', reworked.code + '\n/*# sourceMappingURL=' + mapName  + ' */');
          pushResult('.css.map', JSON.stringify(reworked.map, null, '  '));
          done();
        }

        /**
         * Handler for error in node-sass.
         * @param {string} error The error text from node-sass
         */
        function errorHandler(error) {
          var analysis = /(.*)\:(\d+)\:\s*error\:\s*(.*)/.exec(error);
          var message  = analysis ?
            (path.resolve(analysis[1]) + ':' + analysis[2] + ':0: ' + analysis[3] + '\n') :
            ('TODO parse this error\n' + error + '\n');
          if (output.indexOf(message) < 0) {
            output.push(message);
          }
          done();
        }

        /**
         * Perform the sass render with the given <code>sourceMap</code>, <code>error</code>, and <code>success</code>
         * parameters.
         * @param {string|boolean} map The source map filename or <code>false</code> for none
         * @param {function ({string})} error Handler for error
         * @param {function ({string}, {string})} success Handler for success
         */
        function render(map, error, success) {
          sass.render({
            file:         file.path,
            success:      success,
            error:        error,
            includePaths: libList,
            outputStyle:  outputStyle || 'compressed',
            stats:        stats,
            sourceMap:    map
          });
        }

        // run first without sourcemap as this can cause process exit where errors exist
        render(false, errorHandler, function () {
          render(mapName, errorHandler, successHandler);
        });

      // display the output buffer with padding before and after and between each item
      }, function (done) {
        if (output.length) {
          var width = Number(bannerWidth) || 0;
          var hr    = new Array(width + 1);   // this is a good trick to repeat a character N times
          var start = (width > 0) ? (hr.join('\u25BC') + '\n') : '';
          var stop  = (width > 0) ? (hr.join('\u25B2') + '\n') : '';
          process.stdout.write(start + '\n' + output.join('\n') + '\n' + stop);
        }
        done();
      });
    }
  };
};
