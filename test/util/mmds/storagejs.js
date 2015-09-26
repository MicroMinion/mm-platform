var Q = require('q')

module.exports = {
  get: function(key) {
    var deferred = Q.defer()
    process.nextTick(function() {
      deferred.reject()
    })
    return deferred.promise
  },
  put: function(key, value) {
    var deferred = Q.defer()
    process.nextTick(function() {
      deferred.resolve()
    })
    return deferred.promise
  },
  delete: function(key) {
    var deferred = Q.defer()
    process.nextTick(function() {
      deferred.resolve()
    })
    return deferred.promise
  }
}
