'use strict';

function metricUnit(name) {
  if (name.endsWith('AgeSeconds')) return 'Seconds';
  if (name.endsWith('Bytes')) return 'Bytes';
  if (name.endsWith('Milliseconds')) return 'Milliseconds';
  return 'Count';
}

function emitMetrics({ namespace = process.env.WEBHOOK_METRIC_NAMESPACE || 'NetworkSurvey/Email', environment, release, dimensions = {}, metrics }) {
  const names = Object.keys(metrics || {});
  if (!environment || names.length === 0) return;
  const dimensionNames = ['Environment', ...Object.keys(dimensions)];
  const record = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: namespace,
        Dimensions: [dimensionNames],
        Metrics: names.map((Name) => ({ Name, Unit: metricUnit(Name) })),
      }],
    },
    Environment: environment,
    Release: release || 'unknown',
    ...dimensions,
    ...metrics,
  };
  console.log(JSON.stringify(record));
}

module.exports = { emitMetrics };
