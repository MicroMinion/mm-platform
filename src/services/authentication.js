
/*
 * AUTHENTICATION
 */

FlunkyPlatform.prototype.create_user = function(name, description, email) {
    this._config.createNewUser(name, description, email);
};

/*
 * Put out a request to discover users on the local network
 */
FlunkyPlatform.prototype.discover_local_users = function(callback) {
    this._directory.get("users", "local", callback);
};

/*
 * Request to be notified whenever somebody wants to join our user instance so that we can add the device if we want to
 */
FlunkyPlatform.prototype.subscribe_to_user_requests = function(callback) {
    setTimeout(function() { 
        callback({
            publicKey: "abadfadfafdafd",
            name: "Thomas' Nexus Tablet"
        })
    }, 3000);
};

/*
 * Subscribe to user confirmation request
 */
FlunkyPlatform.prototype.subscribe_to_user_confirmation = function(callback) {
        
};

/*
 * Sends out a request to join a user instance
 */
FlunkyPlatform.prototype.send_user_request = function(user_public_key) {
    
};

/*
 * Confirm adding a new instance to the user 
 */
FlunkyPlatform.prototype.add_instance_to_user = function(publicKey, callback) {

};
