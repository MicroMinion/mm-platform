var _ = require("lodash");


var instances = {
    local: require("./directory/mdns.js"),
    global: require("./directory/dht.js")
};

var put = function(key, value, options) {
    if(instances.local) {
        instances.local.put(key, value, options);
    } else {
        if(options && options.error) {
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


module.exports = {
    put: put
};
