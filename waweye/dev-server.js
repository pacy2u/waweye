'use strict';
// Local server: static files from public/ + /api/vehicles. Reads .env if present.
const fs = require('fs');
const path = require('path');
const http = require('http');

try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

const { vehiclesHandler, parkingHandler, incidentsHandler, fleetHandler, sportHandler, eventsHandler, gtfsProbeHandler, routeHandler, routesRefreshHandler } = require('./lib/handler');
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/geo+json', '.webp': 'image/webp', '.mp4': 'video/mp4' };

function createServer(opts = {}) {
  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname === '/api/vehicles') return vehiclesHandler(req, res, opts);
    if (pathname === '/api/parking') return parkingHandler(req, res, opts);
    if (pathname === '/api/fleet') return fleetHandler(req, res, opts);
    if (pathname === '/api/incidents') return incidentsHandler(req, res, opts);
    if (pathname === '/api/sport') return sportHandler(req, res, opts);
    if (pathname === '/api/wydarzenia') return eventsHandler(req, res, opts);
    if (pathname === '/api/sprawdz-gtfs') return gtfsProbeHandler(req, res, opts);
    if (pathname === '/api/trasa') return routeHandler(req, res, opts);
    if (pathname === '/api/odswiez-trasy') return routesRefreshHandler(req, res, opts);
    // Clean URLs like Vercel's cleanUrls: /o-serwisie serves o-serwisie.html.
    const clean = pathname === '/' ? 'index.html' : path.extname(pathname) ? pathname : pathname + '.html';
    const file = path.normalize(path.join(PUBLIC, clean));
    if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.statusCode = 404; return res.end('Not found'); }
      res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
      res.end(data);
    });
  });
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createServer().listen(port, () => console.log(`wawEye on http://localhost:${port}${process.env.MOCK === '1' ? ' (MOCK)' : ''}`));
}
module.exports = { createServer };
