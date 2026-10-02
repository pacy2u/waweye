'use strict';
const { parkingHandler } = require('../lib/handler');
module.exports = (req, res) => parkingHandler(req, res);
