'use strict';
const { fleetHandler } = require('../lib/handler');
module.exports = (req, res) => fleetHandler(req, res);
