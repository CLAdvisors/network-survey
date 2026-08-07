'use strict';

function emitMetrics({ namespace = process.env.WEBHOOK_METRIC_NAMESPACE || 'NetworkSurvey/Email', environment, release, metrics }) {
  const names = Object.keys(metrics || {});
  if (!environment || names.length === 0) return;
  const record = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: namespace,
        Dimensions: [['Environment']],
        Metrics: names.map((Name) => ({ Name, Unit: Name.endsWith('AgeSeconds') ? 'Seconds' : 'Count' })),
      }],
    },
    Environment: environment,
    Release: release || 'unknown',
    ...metrics,
  };
  console.log(JSON.stringify(record));
}

module.exports = { emitMetrics };
