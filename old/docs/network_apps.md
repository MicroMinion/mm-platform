# Network Apps support

Supporting apps that modify routing tables is more complex. This document serves as a current version of design elements that could provide a clean interface for this.

## Possible use cases

### Tor App

Requires daemon listening on specific ports + forwarding rules in firewall configuration

### STUN/TURN server

Requires daemon listening on specific ports + forwarding rules in firewall configuration


## Potential API's  needed

* Manipulate filtering rules
* Set up forwarding rules
* Create tun/tap device
* Listen on specific network port
* Manipulate routing table
* Configure IP addresses
* Add DNS entries