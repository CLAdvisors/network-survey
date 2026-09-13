'use strict';

const crypto = require('crypto');

function routeTemplate(req) {
  const route = typeof req.route?.path === 'string' ? req.route.path : null;
  if (!route) return 'unmatched';
  const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  return `${base}${route}` || '/';
}

function createAccessErrorTelemetry({ env = process.env, log = console.log, now = () => process.hrtime.bigint(), requestId = () => crypto.randomUUID() } = {}) {
  return function accessErrorTelemetry(req, res, next) {
    if (String(env.ACCESS_ERROR_TELEMETRY_ENABLED || '').toLowerCase() !== 'true') return next();

    const startedAt = now();
    const id = requestId();
    res.setHeader('X-Request-Id', id);
    res.once('finish', () => {
      if (res.statusCode < 400) return;
      const elapsedNanoseconds = now() - startedAt;
      log(JSON.stringify({
        event: 'api_request_error',
        requestId: id,
        method: req.method,
        route: routeTemplate(req),
        status: res.statusCode,
        durationMs: Math.max(0, Math.round(Number(elapsedNanoseconds) / 1e6)),
      }));
    });
    next();
  };
}

module.exports = { createAccessErrorTelemetry, routeTemplate };
