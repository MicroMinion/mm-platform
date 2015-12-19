var NanoTimer = require('nanotimer')

var timer = new NanoTimer('log')

var task = function () {
  console.log('TRIGGERING TIMEOUT')
}

var delay = '1000n'

timer.setTimeout(task, [], delay, function (data) {
  console.log('CALLBACK')
  console.log(data)
})
