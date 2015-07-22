var mdns = require("multicast-dns")({
    multicast: true,
    loopback: true,
    reuseAddr: true
});

var crypto = require("crypto");
//var hash = crypto.createHash("sha256").update(key).digest('hex');

var data = {};

mdns.on("ready", function() {

});

mdns.on("error", function() {
    
});

mdns.on("warning", function(message) {
    console.log(message);
});

mdns.on("query", function(query) {
    console.log
    console.log(query);
});

mdns.on("response", function(response) {
    console.log(response);
});

//mdns.query({
//   questions:[{
//       name: '_googlecast._tcp.local',
//       type: 'PTR'
//    }]
//});

mdns.put = function(key, value, options) {
    data[key] = value;
};

module.exports = mdns;
