var Directory = function(messaging) {
    var directory = this;
    if(typeof chrome !== "undefined" && typeof chrome.gcm !== "undefined") {
        this.gcm = require("./gcm.js");
    };
    this.messaging = messaging;
    this.messaging.on("self.directory.get", function(topic, publicKey, data) {
        if(directory.gcm) {
            var options = {
                success: function(key, value) {
                    directory.messsaging.send("directory.getReply", "local", {key: key, value: value});
                }
            };
            directory.gcm.get(data.key, options);
        };
    });
    this.messaging.on("self.directory.put", function(topic, publicKey, data) {
        if(directory.gcm) {
            directory.gcm.put(data.key, data.value);
        };
    });
};

module.exports = Directory;
