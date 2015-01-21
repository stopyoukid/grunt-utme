'use strict';
var _ = require("lodash");
var utmeServer = require("./lib/utmeServer");
var Promise = require('es6-promise').Promise;

// TODO: Get rid of this trash as soon as we can
module.exports = function(grunt) {

    grunt.registerMultiTask("utmeTestRunner", 'Runs utme scenarios', function() {
        var me = this;
        var _done = this.async();
        var serverHandler;
        var runningScenario;
        var scenarioPromise;
        var resolver;
        var rejecter;
        var options = _.extend({}, this.options());
        var port = getOption('port') || 9045;
        var testServer = "http://localhost:" + port + "/";
        var appServer = getOption('appServer') || "http://localhost:9000/";
        var phantom = new require('phantom-as-promise').PhantomAsPromise({
            'remote-debugger-port': 9099
        });
        var scenarioToRun = grunt.option( "scenario" );
        var thisPage;
        var verbose = getOption('verbose');
        var done = function() {
            console.log = oldLog;
            _done();
        };
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
                if (data.indexOf("[SUCCESS]") >= 0) {
                    resolver(data);
                }
                if (verbose || data.indexOf("Could not") < 0 || data.indexOf("Validate:") == 0) {
                    grunt.log.ok(data);
                }
            });
            serverHandler.on('errorEntry', function(args) {
                rejecter(args);
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
                    grunt.log.ok("Attempting to run " + scenario.name);
                    grunt.log.ok(testServer);
                    // grunt.log.ok("Loading Scenario '" + scenario.name + "'");
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
                                return phantom.clearCookies().then(function() {
                                    return page.open(appServer + "?utme_scenario=" + scenario.name + "&utme_test_server=" + testServer);
                                });
                            })
                            .then(function() {
                                return scenarioPromise;
                            })
                            .then(runNextOrStop)
                            .catch(runNextOrStop);
                    } else {
                        console.log("Go To: " + appServer + "?utme_scenario=" + scenario.name + "&utme_test_server=" + testServer);
                        setupServerForScenario(scenario);
                        scenarioPromise
                            .then(runNextOrStop)
                            .catch(runNextOrStop);
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
    });

    grunt.registerMultiTask("utmeServer", 'Starts a server for persisting and loading scenarios', function() {
        // throw new Error("lkajsdlgkjsagd");
        var _done = this.async();
        var options = _.extend({}, this.options());
        var port = options.port || 9043;
        utmeServer.createScenarioServer(port, function() {
            grunt.log.ok("Started utme server at: " + port);
        }, options.directory);
    });
};
