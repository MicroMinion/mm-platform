# FlunkyPaaS

This is the module that binds together all Flunky platform components

Currently, it is only tested on NodeJS but the goal is to make this also work in chrome apps, cordova apps (and potentially the browser later on).

This module provides user authentication and the plumbing for the service-oriented architecture and pulls together the following components:

* flunky-directory for host / user lookup
* flunky-connectivity for secure/authenticated communication between devices/instances of the platform belonging to the same user.
* flunky-service-share: part of SOA for sharing metadata with other users
* flunky-service-data: part of SOA for managing data
* flunky-service-db: part of SOA for storing metadata and syncing it between devices

## Installation

```bash
npm install
```

## Running

Currently there is a test program that you can run to experiment with the platform. It requires that a directory server is running on the localhost. See paas-directory repository on how to set this up

```bash
./scripts/test-directory
```