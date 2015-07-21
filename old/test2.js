var FlunkyPlatform = require("./index.js");

platform = new FlunkyPlatform();

var authentication = platform.getComponent("authentication");

authentication.on("joinConfirmation", function(user) {
    console.log("CONFIRMATION RECEIVED");
});

authentication.discoverUsersOnLocalNetwork(function(key, value) {
    authentication.sendRequestToJoinUser(value.publicKey);
});
