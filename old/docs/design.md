# Design of Flunky PaaS framework

The Flunky PaaS framework contains the glue that binds the different framework services (like metadata service) and third party apps together.

We assume that all framework services live in their own docker container and communicate over a local (domain or Internet) socket with the rest of the framework.

The framework provides a Service Oriented Architecture. 

Applications and framework services register themselves as a service.
In addition, applications can also send 'events' to the framework. The framework also contains publish/subscribe functionality so it knows to which other services it needs to forward these events.

In terms of network connectivity the framework connects together three types of pipes:
-   The local domain or Internet socket which glues together all docker containers running on the local device
-   It also opens a CurveCP port to allow other devices in the same domain to connect seamlessly to the local services. This connection contains authorization controls. It will also contain logic to try to connect to the other devices in the same domain (except if a connection already exists in the other direction)
-   A public CurveCP connection where everybody can connect to. This connection can only receive messages. The messages will be broadcasted locally as events.
