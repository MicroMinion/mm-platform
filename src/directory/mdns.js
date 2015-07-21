
var put = function(key, value, options) {
    if(options && options.error) {
        options.error("Function not implemented");
    };
};

module.exports = {
    put: put
};
