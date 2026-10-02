'use strict';
const { vehiclesHandler } = require('../lib/handler');
module.exports = (req, res) => vehiclesHandler(req, res);
