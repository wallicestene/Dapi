import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSamples } from '../src/compare.js';

const sample = (values, label = 'S') => ({ label, values });

test('exact match passes', () => {
  const [r] = compareSamples([{ Name: 'Teijin', Cycle: '4' }], [sample({ Name: 'Teijin', Cycle: '4' })]);
  assert.equal(r.status, 'pass');
});

test('numbers in rows match string samples', () => {
  const [r] = compareSamples([{ Name: 'Teijin', Cycle: 4 }], [sample({ Name: 'Teijin', Cycle: '4' })]);
  assert.equal(r.status, 'pass');
});

test('a whitespace-only difference from a PDF line wrap is a warning', () => {
  const [r] = compareSamples(
    [{ Ref: 'Decree 136/2020/ND-CP, Arts. 5(1)(dd), 20' }],
    [sample({ Ref: 'Decree 136/2020/ND-CP, Arts. 5(1) (dd), 20' })]
  );
  assert.equal(r.status, 'warn');
});

test('a trailing slash difference is a warning', () => {
  const [r] = compareSamples([{ Site: 'https://www.hkdesigns.co' }], [sample({ Site: 'https://www.hkdesigns.co/' })]);
  assert.equal(r.status, 'warn');
});

test('a different value fails, and so does a case difference', () => {
  const rows = [{ Name: 'Teijin', Status: 'pipeline' }];
  const [r] = compareSamples(rows, [sample({ Name: 'Teijin', Status: 'Pipeline' })]);
  assert.equal(r.status, 'fail');
  assert.equal(r.checks.find((c) => c.column === 'Status').status, 'fail');
});

test('picks the right row among rows that share most columns', () => {
  const rows = [
    { Factory: 'Teijin', Issue: 'Fire detection and alarm system' },
    { Factory: 'Teijin', Issue: 'Number of emergency exits' },
  ];
  const [r] = compareSamples(rows, [sample({ Factory: 'Teijin', Issue: 'Number of emergency exits' })]);
  assert.equal(r.status, 'pass');
  assert.equal(r.row, 1);
});

test('a sample with no matching row is not found', () => {
  const [r] = compareSamples([{ Factory: 'Teijin', Country: 'Vietnam' }], [sample({ Factory: 'GP Solutions', Country: 'China' })]);
  assert.equal(r.status, 'not found');
});

test('a blank sample value must be blank in the row', () => {
  const rows = [
    { Factory: 'PT Bintang', Issue: '' },
    { Factory: 'Teijin', Issue: 'Fire detection' },
  ];
  assert.equal(compareSamples(rows, [sample({ Factory: 'PT Bintang', Issue: '' })])[0].status, 'pass');
  assert.equal(compareSamples([{ Factory: 'PT Bintang', Issue: 'Fire' }], [sample({ Factory: 'PT Bintang', Issue: '' })])[0].status, 'fail');
});
