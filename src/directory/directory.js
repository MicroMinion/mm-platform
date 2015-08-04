var _ = require("lodash");
var rateLimit = require("rate-limit");


/*
 * Thoughts on implementation:
 *
 * - local kunnen we for now niet doen omdat mDNS niet werkt dus ik zou dat blank laten
 * - options object bevat mogelijke volgende attributen:
 *     - success, warning, error: callbacks
 *     - realtime: true| false => of operatie onmiddellijk moet uitgevoerd worden of aan queue kan toegevoegd worden
 *
 * - rate-limit lijkt propere manier om queues te creeeren
 * - code die deze functies aanroept vind je in stores (contacts.js, profile.js) look for get/put methods
 * - aangezien key gaat gehashed worden gaan we ergens mapping moeten bijhouden van key => hash voor callbacks
 * - de stores gaan er van uit dat een lookup meerdere matches kan geven. het is dus perfect okay om voor een get request meerdere keren success callback aan te roepen
 */

var instances = {
    local: require("./mdns.js"),
    global: require("./dht.js")
};


var queues = {
    local: rateLimit.createQueue({interval: 100}),
    global: rateLimit.createQueue({interval: 100})
};

instances.local.on("error", function(err) {
    console.log("ERROR " + err);
    console.log("disabling mDNS directory");
    instances.local = null;
});




var put = function(key, value, options) {
    if(instances.local) {
        instances.local.put(key, value, options);
    } else {
        if(options && options.warning) {
            options.error("Not possible to publish key %s on the local network", key);
        };
    };
    if(instances.global) {
        instances.global.put(key, value, options);
    } else {
        if(options && options.error) {
            options.error("Not possible to publish key  %s on the global network", key);
        };
    };
};

var get = function(key, options) {
};


module.exports = {
    put: put,
    get: get
};
