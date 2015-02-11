'use strict';
var _ = require("lodash");
var utmeServer = require("./lib/utmeServer");
var Promise = require('es6-promise').Promise;
var path = require("path");

var serverDefaultOptions = {
    port: 9043,
    appServer: "http://localhost:9000/",
    configFile: "utme.config.json",
    consoleLogging: true,
    runner: {
        speed: 'realtime',
        events: {
            click: true,
            focus: true,
            blur: true,
            dblclick: true,
            mousedown: true,
            mouseenter: true,
            mouseleave: true,
            mouseout: true,
            mouseover: true,
            mouseup: true,
            change: true
        }
    },
    recorder: {
        events: {
            click: true,
            focus: true,
            blur: true,
            dblclick: true,
            mousedown: true,
            mouseenter: true,
            mouseleave: true,
            mouseout: true,
            mouseover: true,
            mouseup: true,
            change: true
        }
    }
};

var runnerDefaultOptions = _.extend(_.extend({}, serverDefaultOptions), {
    consoleLogging: false,
    port: 9045,
    runner: _.extend(_.extend({}, serverDefaultOptions), {
        speed: 'realtime'
    })
});

var publicOptions = [
    "verbose",
    "consoleLogging",
    "runner",
    "recorder"
];

function flattenSettings(settings, output, baseKeyPath) {
    output = output || {};
    baseKeyPath = baseKeyPath || '';
    if (baseKeyPath) {
        baseKeyPath += '.';
    }
    for (var key in settings) {
        var keyPath = baseKeyPath + key;
        if (settings.hasOwnProperty(key)) {
            if (settings[key] instanceof Array || typeof settings[key] !== 'object') {
                output[keyPath] = settings[key];
            } else {
                flattenSettings(settings[key], output, keyPath);
            }
        }
    }
    return output;
}

// TODO: Get rid of this trash as soon as we can
module.exports = function(grunt) {

    function loadOptions(defaultOptions, userOptions) {
        var options = _.extend({}, defaultOptions);
        if (userOptions.configFile) {
            _.extend(options, loadConfigFile(userOptions.configFile));
        }
        return _.extend(options, userOptions);
    }

    function loadConfigFile(configFile) {
        var configPath = path.resolve(configFile);
        if (configPath) {
            return grunt.file.readJSON(configPath);
        }
        return {};
    }

    grunt.registerMultiTask("utmeTestRunner", 'Runs utme scenarios', function() {
        var me = this;
        var _done = this.async();
        var serverHandler;
        var runningScenario;
        var scenarioPromise;
        var resolver;
        var rejecter;
        var options = loadOptions(runnerDefaultOptions, this.options());
        var testServer = "http://localhost:" + getOption('port') + "/";
        var appServer = getOption('appServer');
        var phantom = new require('phantom-as-promise').PhantomAsPromise({
            parameters: {
                //'remote-debugger-port': 9099
            }
        });
        var scenarioToRun = grunt.option("scenario");
        var thisPage;
        var verbose = getOption('verbose');
        var manualLoad = getOption('manualLoad');
        var oldLog = console.log;
        var allScenarioFiles;

        console.log = function () {
            var args = Array.prototype.slice.call(arguments, 0);
            if (!args[0].match || !args[0].match(/^phantom (stdout|stderr)/)) {
                oldLog.apply(this, args);
            }
        };

        function startServer(port, callback) {
            serverHandler = utmeServer.createBasicServer(port, callback);
            serverHandler.on('loadSettings', function (callback) {
                var settings = {};
                publicOptions.forEach(function (opt) {
                    settings[opt] = options[opt];
                });
                callback(flattenSettings(settings));
            });
            serverHandler.on('loadScenario', function (name, scenarioCallback) {
                if (name == runningScenario.name) {
                    scenarioCallback(runningScenario);
                } else {
                    var foundScenarios = allScenarioFiles.filter(function (file) {
                        return file.endsWith(name + ".scenario");
                    });

                    if (foundScenarios.length > 0) {
                        scenarioCallback(grunt.file.readJSON(foundScenarios[0]));
                    } else {
                        scenarioCallback(null);
                    }
                }
            });
            serverHandler.on('logEntry', function (data) {
                grunt.log.ok(data);
            });
            serverHandler.on('successEntry', function (data) {
                if (resolver) {
                    resolver(data);
                } else {
                    grunt.log.error("resolver is null!");
                    stopServer();
                }
                grunt.log.writeln((data + '\n').green);
            });
            serverHandler.on('errorEntry', function(args) {
                if (rejecter) {
                    rejecter(args);
                }
            });
        }

        function createJUnitTestResults(resultArray) {
            var junitString = "";
            for (var i = 0; i < resultArray.length; i++) {
                var result = resultArray[i];
                junitString += '\t<testcase name="Utme.' + result.scenario.name + '" time="' + result.duration + '">\n';
                if (result.error) {
                    junitString += '\t\t<failure type="generic">' + result.error + "</failure>\n";
                }
                junitString += '\t</testcase>\n';
            }
            junitString = '<testsuite name="Utme">\n' + junitString + '</testsuite>';
            grunt.file.write('test-results.xml', junitString);
        }

        function stopServer(callback) {
            if (serverHandler) {
                serverHandler.close();
                serverHandler = null;
                grunt.log.ok("Stopped test server.");
            }
            callback();
        }

        allScenarioFiles = grunt.file.expand(this.filesSrc[0] + "**/*.{scenario, json}");
        if (allScenarioFiles.length > 0) {
            var files = allScenarioFiles;
            if (scenarioToRun) {
                files = files.filter(function (file) {
                    return file.endsWith(scenarioToRun + ".scenario");
                });
            }

            var results = [];
            var hasError = false;
            var port = getOption('port');
            startServer(port, function() {
                grunt.log.ok("Started utme test server at: " + port);
                function runNextOrStop(lastRunInfo) {
                    if (lastRunInfo) {
                        results.push(lastRunInfo);
                        if (lastRunInfo.error) {
                            hasError = true;
                            grunt.log.error(lastRunInfo.error);
                        }
                    }
                    if (files.length > 0) {
                        runScenario(files.pop());
                    } else {
                        stopServer(function() {
                            createJUnitTestResults(results);
                            phantom.exit();
                            if (hasError) {
                                grunt.fail.warn('Test Failures!');
                            } else {
                                done();
                            }
                        });
                    }
                }

                function runScenario(scenarioFile) {
                    var scenario = grunt.file.readJSON(scenarioFile);

                    if (scenario.abstract === true) {
                        setTimeout(function () {
                            runNextOrStop();
                        });
                        return;
                    }

                    grunt.log.ok(("\n" + scenario.name).bold);
                    grunt.log.ok(testServer);

                    if (!options || !manualLoad) {
                        phantom.page()
                            .then(function (page) {
                                setupServerForScenario(scenario);
                                thisPage = page;
                                page.set('viewportSize', {
                                      width: 1920,
                                      height: 1200
                                  });
                                page.evaluate(function() {
                                    localStorage.clear();
                                });
                                page.onError = function(msg, trace) {
                                    grunt.log.error(msg);
                                    if (trace) {
                                        try {
                                            grunt.log.error(JSON.stringify(trace));
                                        } catch (e) {

                                        }
                                    }
                                };

                                page.onNavigationRequested = function(url, type, willNavigate, main) {
                                    grunt.log.ok('navigating to ' + url);
                                };

                                page.onConsoleMessage = function(msg, lineNum, sourceId) {
                                    if (options.consoleLogging) {
                                        grunt.log.ok('CONSOLE: ' + msg);
                                    }
                                };

                                return phantom.clearCookies().then(function() {
                                    return page.open(appServer + "?utme_scenario=" + scenario.name + "&utme_test_server=" + testServer);
                                });
                            })
                            .then(function() {
                                return scenarioPromise;
                            })
                            .then(runNextOrStop)
                            .catch(function () {
                                //grunt.log.ok("Rendering page");
                                //thisPage.render("test.png");
                                runNextOrStop();
                            });
                    } else {
                        console.log("Go To: " + appServer + "?utme_scenario=" + scenario.name + "&utme_test_server=" + testServer);
                        setupServerForScenario(scenario);
                        scenarioPromise
                            .then(runNextOrStop)
                            .catch(function () {
                                //grunt.log.ok("Rendering page");
                                //thisPage.render("test.png");
                                runNextOrStop();
                            });
                    }
                }

                // Run first scenario
                runNextOrStop();
            });
        } else {
            done();
        }

        function setupServerForScenario(scenario) {
            var started = new Date().getTime();
            runningScenario = scenario;
            scenarioPromise = new Promise(function(resolve, reject) {
                resolver = function(arg) {
                    resolve({
                        scenario: scenario,
                        duration: (new Date().getTime() - started) / 1000
                    });
                    runningScenario = resolver = rejecter = null;
                };
                rejecter = function(arg) {
                    reject({
                        scenario: scenario,
                        duration: (new Date().getTime() - started) / 1000,
                        error: arg
                    });
                    runningScenario = resolver = rejecter = null;
                };
            });
        }

        function getOption(name) {
            var value =  grunt.option(name);
            if (typeof value != 'undefined') {
                return value;
            }
            return (me.options() || {})[name];
        }

        function done() {
            console.log = oldLog;
            _done();
        }
    });

    grunt.registerMultiTask("utmeServer", 'Starts a server for persisting and loading scenarios', function() {
        // throw new Error("lkajsdlgkjsagd");
        var _done = this.async();
        var options = loadOptions(serverDefaultOptions, this.options());
        var port = options.port || 9043;
        var server = utmeServer.createScenarioServer(port, function() {
            grunt.log.ok("Started utme server at: " + port);
        }, options.directory);

        server.on('loadSettings', function (callback) {
            var settings = {};
            publicOptions.forEach(function (opt) {
                settings[opt] = options[opt];
            });
            if (callback) {
                callback(flattenSettings(settings));
            }
        });
    });
};
