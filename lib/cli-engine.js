/**
 * @fileoverview Main CLI object.
 * @author Nicholas C. Zakas
 */

"use strict";

/*
 * The CLI object should *not* call process.exit() directly. It should only return
 * exit codes. This allows other programs to use the CLI object and still control
 * when the program exits.
 */

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

var fs = require("fs"),
    path = require("path"),

    assign = require("object-assign"),
    debug = require("debug"),
    Ignore = require("fstream-ignore"),

    rules = require("./rules"),
    eslint = require("./eslint"),
    Config = require("./config"),
    FileFinder = require("./file-finder");

//------------------------------------------------------------------------------
// Constants
//------------------------------------------------------------------------------

var ESLINT_IGNORE_FILENAME = ".eslintignore";

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/**
 * The options to configure a CLI engine with.
 * @typedef {Object} CLIEngineOptions
 * @property {string} configFile The configuration file to use.
 * @property {boolean} reset True disables all default rules and environments.
 * @property {boolean} ignore False disables use of .eslintignore.
 * @property {string[]} rulePaths An array of directories to load custom rules from.
 * @property {boolean} useEslintrc False disables looking for .eslintrc
 * @property {string[]} envs An array of environments to load.
 * @property {string[]} globals An array of global variables to declare.
 * @property {Object<string,*>} rules An object of rules to use.
 * @property {string} ignorePath The ignore file to use instead of .eslintignore.
 */

/**
 * A linting warning or error.
 * @typedef {Object} LintMessage
 * @property {string} message The message to display to the user.
 */

/**
 * A linting result.
 * @typedef {Object} LintResult
 * @property {string} filePath The path to the file that was linted.
 * @property {LintMessage[]} messages All of the messages for the result.
 */

/**
 * @callback ResultsCallback
 * @param {Error|null} error
 * @param {LintResults[]} results
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

debug = debug("eslint:cli-engine");

/**
 * Processes an individual file using ESLint.
 * @param {string} filename The filename of the file being checked.
 * @param {Object} configHelper The configuration options for ESLint.
 * @returns {Result} The results for linting on this file.
 * @private
 */
function processFile(filename, configHelper) {

    // clear all existing settings for a new file
    eslint.reset();

    var filePath = path.resolve(filename),
        config,
        text,
        messages;

    if (fs.existsSync(filePath)) {
        debug("Linting " + filePath);
        config = configHelper.getConfig(filePath);
        text = fs.readFileSync(path.resolve(filename), "utf8");
        messages = eslint.verify(text, config, filename);
    } else {
        debug("Couldn't find " + filePath);
        messages = [{
            fatal: true,
            message: "Could not find file at '" + filePath + "'."
        }];
    }

    return {
        filePath: filename,
        messages: messages
    };
}

var ignoreFileFinder;

/**
 * Find an ignore file in the directory.
 * @param {string} dir The path to the directory.
 * @returns {Array} path of ignore file if found, or false if no ignore is found
 */
function findIgnoreFiles(dir) {
    if (!ignoreFileFinder) {
        ignoreFileFinder = new FileFinder(ESLINT_IGNORE_FILENAME);
    }

    return ignoreFileFinder.findAll(dir);
}

/**
 * Processes an individual directory using ESLint.
 * @param {string} dir The path to the directory being checked.
 * @param {Object} configHelper The configuration options for ESLint.
 * @param {ResultsCallback} cb Callback.
 * @returns {void}
 * @private
 */
function executeOnDirectory(dir, configHelper, cb) {
    debug("Processing directory " + dir);
    var results = [];
    var ignore = new Ignore({
        path: dir,
        ignoreFiles: [ESLINT_IGNORE_FILENAME]
    });
    ignore.on("child", function(c) {
        if (path.extname(c.path) === ".js") {
            results.push(processFile(c.path, configHelper));
        }
    });
    ignore.on("error", function(err) {
        cb(err);
    });
    ignore.on("end", function() {
        cb(null, results);
    });

    var counter = 0,
        ignoreFilesInParentDirs;

    try {
        ignoreFilesInParentDirs = findIgnoreFiles(path.resolve(dir, ".."));
    } catch(err) {
        return cb(err);
    }

    if (ignoreFilesInParentDirs.length !== 0) {
       ignore.pause();
       ignoreFilesInParentDirs.forEach(function(file) {
           ignore.addIgnoreFile(file, function() {
               if (++counter === ignoreFilesInParentDirs.length) {
                   ignore.resume();
               }
           });
       });
    }
}

/**
 * Processes a file or directory using ESLint.
 * @param {string} file The filename of the file being checked.
 * @param {Object} configHelper The configuration options for ESLint.
 * @param {ResultsCallback} cb callback.
 * @returns {void}
 * @private
 */
function executeOnFileOrDirectory(file, configHelper, cb) {
    debug("Processing file " + file);
    fs.stat(file, function(err, stats) {
        if (err) {
            return cb(err);
        }

        if (!stats.isDirectory()) {
            cb(null, [processFile(file, configHelper)]);
        } else {
            executeOnDirectory(file, configHelper, cb);
        }
    });
}

//------------------------------------------------------------------------------
// Private
//------------------------------------------------------------------------------


var defaultOptions = {
    configFile: null,
    reset: false,
    rulePaths: [],
    useEslintrc: true,
    envs: [],
    globals: [],
    rules: {},
    ignore: true,
    ignorePath: null
};

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * Creates a new instance of the core CLI engine.
 * @param {CLIEngineOptions} options The options for this instance.
 * @constructor
 */
function CLIEngine(options) {

    /**
     * Stored options for this instance
     * @type {Object}
     */
    this.options = assign(Object.create(defaultOptions), options || {});

    // load in additional rules
    if (this.options.rulePaths) {
        this.options.rulePaths.forEach(function(rulesdir) {
            debug("Loading rules from " + rulesdir);
            rules.load(rulesdir);
        });
    }
}

CLIEngine.prototype = {

    constructor: CLIEngine,

    /**
     * Executes the current configuration on an array of file and directory names.
     * @param {string[]} files An array of file and directory names.
     * @param {ResultsCallback} callback Callback.
     * @returns {void}
     */
    executeOnFiles: function executeOnFiles(files, callback) {
        var configHelper = new Config(this.options),
            results = [];

        function next() {
            if (!files.length) {
                return callback(null, results);
            }

            executeOnFileOrDirectory(files.shift(), configHelper, function(err, res) {
                if (err) {
                   return callback(err);
                }

                results = results.concat(res);
                next();
            }.bind(this));
        }
        next();
    }
};

module.exports = CLIEngine;
