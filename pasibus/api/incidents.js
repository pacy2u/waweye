'use strict';
const { incidentsHandler } = require('../lib/handler');
module.exports = (req, res) => incidentsHandler(req, res);
