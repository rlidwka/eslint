#!/usr/bin/env node
var cli = require("../lib/cli");
var exitCode = cli.execute(process.argv, function(err, code) {
    if (err) throw err;

    /*
     * Wait for the stdout buffer to drain.
     * See https://github.com/eslint/eslint/issues/317
     */
    process.on('exit', function() {
        process.exit(code);
    });
});

