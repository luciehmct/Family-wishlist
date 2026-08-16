import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, expiresAt, isExpired, occAfter, parseDay } from './logic.js';
import { fromDDMM } from './family.js';

const xmas = { date: '2000-12-25', yearly: true };
const bday = { date: '2000-05-15', yearly: true, birthday: true };
const once = { date: '2026-09-01', yearly: false };
const item = (createdAt) => ({ createdAt });

test('yearly events resolve to the next occurrence, today included', () => {
  assert.deepEqual(occAfter(xmas, new Date(2026, 0, 5)), new Date(2026, 11, 25));
  assert.deepEqual(occAfter(xmas, new Date(2026, 11, 25)), new Date(2026, 11, 25));
  assert.deepEqual(occAfter(xmas, new Date(2026, 11, 26)), new Date(2027, 11, 25));
});

test('non-recurring events keep their one date', () => {
  assert.deepEqual(occAfter(once, new Date(2030, 0, 1)), parseDay('2026-09-01'));
});

test('expiry is anchored on the item, not on today — yearly events still terminate', () => {
  assert.deepEqual(expiresAt(item('2026-11-10T10:00:00Z'), xmas), new Date(2027, 0, 1));
});

test('birthdays expire on the day, other events get 7 days', () => {
  assert.deepEqual(expiresAt(item('2026-01-02T00:00:00Z'), bday), new Date(2026, 4, 15));
  assert.deepEqual(expiresAt(item('2026-08-01T00:00:00Z'), once), new Date(2026, 8, 8));
});

test('only bought items expire', () => {
  const i = item('2026-11-10T10:00:00Z');
  const after = new Date(2027, 0, 2);
  assert.equal(isExpired(i, xmas, true, after), true);
  assert.equal(isExpired(i, xmas, false, after), false);
  assert.equal(isExpired(i, null, true, after), false);
  assert.equal(isExpired(i, xmas, true, new Date(2026, 11, 26)), false);
});

test('DD/MM is day-first and survives the leap day', () => {
  assert.equal(fromDDMM('05/03'), '2000-03-05');
  assert.equal(fromDDMM('29/02'), '2000-02-29');
  assert.throws(() => fromDDMM('2026-03-05'));
  assert.throws(() => fromDDMM('05/13'));
});

test('daysUntil ignores the time of day', () => {
  assert.equal(daysUntil(new Date(2026, 0, 3), new Date(2026, 0, 1, 23, 59)), 2);
  assert.equal(daysUntil(new Date(2026, 0, 1), new Date(2026, 0, 1, 23, 59)), 0);
});
