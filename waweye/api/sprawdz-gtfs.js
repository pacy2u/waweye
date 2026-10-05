'use strict';
const { gtfsProbeHandler } = require('../lib/handler');
module.exports = (req, res) => gtfsProbeHandler(req, res);
