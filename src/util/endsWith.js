var endsWith = function (subjectString, searchString, position) {
  if (String.prototype.endsWith) {
    return subjectString.endsWith(searchString, position)
  } else {
    if (position === undefined || position > subjectString.length) {
      position = subjectString.length
    }
    position -= searchString.length
    var lastIndex = subjectString.indexOf(searchString, position)
    return lastIndex !== -1 && lastIndex === position
  }
}

module.exports = endsWith
