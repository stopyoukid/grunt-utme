'use strict';

var express = require('express');
var bodyParser = require('body-parser');
var methodOverride = require('method-override');
var events = require('events');
var util = require('util');

function Server(port, callback) {

    var me = this;

    var app = express();
    var serverHandler;

    // Allow Cross Origin Crap, cause we don't care
    app.use(function(req, res, next) {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        next();
    });

    app.use(methodOverride());
    app.use(bodyParser.json({limit: '50mb'}));
    app.use(bodyParser.urlencoded({
        extended: true
    }));

    app.get("/settings", function (req, res) {
        res.status(200).end();
        me.emit('loadSettings', req.params.name, function (settings) {
            if (settings) {
                res.body(settings).end();
            } else {
                res.status(404).end();
            }
        });
    });

    app.post("/log", function (req, res) {
        me.emit('logEntry', req.body.data);
        res.status(200).end();
    });
    app.post("/error", function (req, res) {
        me.emit('errorEntry', req.body.data);
        res.status(200).end();
    });

    app.get("/scenario/:name", function (req, res) {
        me.emit('loadScenario', req.params.name, function (scenario) {
            if (scenario) {
                res.jsonp(scenario).end();
            } else {
                res.status(404).end();
            }
        });
    });

    app.post("/scenario", function (req, res) {
        me.emit('saveScenario', req.body);
        res.status(200).end();
    });

    serverHandler = app.listen(port, function() {
        var addr = this.address(),
        base = ["http://", addr.address, ":", addr.port].join("");
        if (callback) {
            callback();
        }
    });

    this.close = function() {
        if (serverHandler) {
            serverHandler.close();
            serverHandler = app = null;
        }
        me.emit('close');
    }
}
util.inherits(Server, events.EventEmitter);

var fs = require('fs');
var path = require('path');

module.exports = {
    createBasicServer: function (port, callback) {
        return new Server(port, callback);
    },
    createScenarioServer: function (port, callback, directory) {
        var server = new Server(port, callback);
        server.on('loadScenario', function (name, scenarioCallback) {
            fs.readFile(path.join(directory, name + ".scenario"), function (err, data) {
                if (err) {
                    scenarioCallback(null);
                } else {
                    scenarioCallback(JSON.parse(data.toString()));
                }
            });
        });

        server.on('saveScenario', function (scenario) {
            fs.writeFile(path.join(directory, scenario.name + ".scenario"), JSON.stringify(scenario, null, " "));
        });

        return server;
    }
};
