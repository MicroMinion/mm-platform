module.exports = ServiceDiscoveryComponent;

var debug = require("debug")("flunky-component:discovery");
var FlunkyComponent = require("flunky-component");
var inherits = require("inherits");

inherits(ServiceDiscoveryComponent, FlunkyComponent);

function ServiceDiscoveryComponent(opts) {
    debug("initializing discovery component");
    FlunkyComponent.call(this, opts);
    this.localProvides = ["discovery"];
    this.provides = ["discovery"];
};

ServiceDiscoveryComponent.prototype.setup = function(peerID) {
    this.push({
        to: peerID,
        service: "discovery",
        payload: {
            needs: null,
            provides: null
        }
    });
};

ServiceDiscoveryComponent.prototype.tearDown = function(peerID) {
    //NO-OP
};

ServiceDiscoveryComponent.prototype._write = function(chunk, encoding, done) {
    var needs = this.componentManager.neededServices;
    var provides = this.componentManager.providedServices;
    var services = _.union(_.intersection(needs, chunk.provides),_.intersection(provides, chunk.needs));
    this.componentManager.setupPeer(chunk.from, services);
    done();
};
