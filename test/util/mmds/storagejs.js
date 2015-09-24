var Q = require('q')

module.exports = {
  get: function(key) {
    console.log('get')
    var deferred = Q.defer()
    process.nextTick(function() {
      deferred.reject()
    })
    return deferred.promise
  },
  put: function(key, value) {
    console.log('put')
    var deferred = Q.defer()
    process.nextTick(function() {
      deferred.resolve()
    })
    return deferred.promise
  },
  delete: function(key) {
    console.log('delete')
    var deferred = Q.defer()
    process.nextTick(function() {
      deferred.resolve()
    })
    return deferred.promise
  }
}
