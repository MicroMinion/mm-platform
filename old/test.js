var FlunkyPlatform = require("./index.js");

platform = new FlunkyPlatform();

var authentication = platform.getComponent("authentication");

authentication.on("joinRequest", function(device) {
    authentication.addDeviceToUser(device.publicKey);
});

authentication.createUser("Thomas Delaet","", "thomas@delaet.org");
