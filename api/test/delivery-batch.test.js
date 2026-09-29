'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { insertDeliveriesBatched, batchDeliveryRecord } = require('../lifecycle');

test('5,000 deliveries use bounded bulk inserts with no persisted bearer tokens', async () => {
  const calls = [];
  const client = { async query(sql, values) { calls.push({ sql, values }); } };
  const records = Array.from({ length: 5000 }, (_, index) => batchDeliveryRecord([
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    index + 1, `person${index}@example.test`, `Person ${index}`, 'english', 'from@example.test',
    'Invitation', 'hash', 'https://survey.test', 'v1', JSON.stringify({ surveyName: 'Team' }), 'payload-hash', `survey-delivery-${index}`,
  ]));
  await insertDeliveriesBatched(client, records, 'pending');
  assert.equal(calls.length, 25);
  assert.equal(calls.every(call => JSON.parse(call.values[0]).length === 200), true);
  assert.equal(calls.every(call => call.values[1] === 'pending'), true);
  assert.equal(calls.every(call => !call.values[0].includes('bearer-secret')), true);
  assert.match(calls[0].sql, /jsonb_to_recordset/);
  assert.equal(JSON.parse(calls.at(-1).values[0])[199].respondent_id, 5000);
});
