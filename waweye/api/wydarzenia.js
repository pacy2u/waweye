'use strict';
const { eventsHandler } = require('../lib/handler');
module.exports = (req, res) => eventsHandler(req, res);
