'use strict';

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const dest = String(req.headers['sec-fetch-dest'] || '');
  if ((req.method !== 'GET') || (dest && dest !== 'script')) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  res.statusCode = 200;
  res.end(require('./_g.js'));
};
