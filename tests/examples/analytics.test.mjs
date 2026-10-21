import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { loadFunctions } from './snippets.mjs';

const source = 'skills/analytics-tracking-testing/references/ga4-interception.md';
const { parseGA4, attachGA4Collector } = loadFunctions(source, 'function parseGA4(',
  ['parseGA4', 'attachGA4Collector']);
const request = (query = '', body = null, host = 'www.google-analytics.com', path = '/g/collect') => ({
  url: () => `https://${host}${path}?${query}`,
  postData: () => body,
});

test('GET event preserves its exact event name and value', () => {
  const events = parseGA4(request('v=2&tid=G-TEST&en=add_to_cart&ep.currency=CZK&epn.value=49.99'));
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'add_to_cart');
  assert.equal(events[0].params['ep.currency'], 'CZK');
  assert.equal(events[0].params['epn.value'], '49.99');
});

test('POST batch inherits common query parameters for every event', () => {
  const events = parseGA4(request('v=2&tid=G-TEST&ep.currency=CZK',
    'en=view_item&ep.item_id=42\nen=add_to_cart&epn.value=49.99'));
  assert.deepEqual(events.map(e => e.name), ['view_item', 'add_to_cart']);
  for (const event of events) {
    assert.equal(event.params['ep.currency'], 'CZK');
    assert.equal(event.params.tid, 'G-TEST');
  }
});

test('POST fields override shared parameters without a phantom query-only event', () => {
  const events = parseGA4(request('en=purchase&ep.currency=USD', 'ep.currency=CZK&epn.value=0'));
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'purchase');
  assert.equal(events[0].params['ep.currency'], 'CZK');
  assert.equal(events[0].params['epn.value'], '0');
});

test('URL query supplies a default event name but each POST row is one event', () => {
  const events = parseGA4(request('en=page_view&tid=G-TEST', 'en=add_to_cart&ep.item_id=42\nen=purchase&epn.value=20'));
  assert.deepEqual(events.map(e => e.name), ['add_to_cart', 'purchase']);
});

test('blank POST rows do not create extra events', () => {
  const events = parseGA4(request('tid=G-TEST', '\nen=one\r\n\nen=two\n'));
  assert.deepEqual(events.map(e => e.name), ['one', 'two']);
});

test('consent-only request with no event name produces no business event', () => {
  assert.deepEqual(parseGA4(request('v=2&gcs=G100')), []);
});

test('missing and empty event names are ignored', () => {
  assert.deepEqual(parseGA4(request('en=&epn.value=0')), []);
});

test('lookalike hosts and paths containing collect in query are ignored', () => {
  for (const req of [request('en=purchase', null, 'google-analytics.com.attacker.test'),
    request('en=purchase', null, 'evil.test'),
    request('next=/g/collect&en=purchase', null, 'www.google-analytics.com', '/proxy')]) {
    assert.deepEqual(parseGA4(req), []);
  }
});

test('configured first-party collector is accepted explicitly', () => {
  const events = parseGA4(request('en=purchase', null, 'metrics.example.test'), ['metrics.example.test']);
  assert.equal(events.length, 1);
});

test('duplicate events remain duplicated for the caller to detect', () => {
  const events = parseGA4(request('tid=G-TEST', 'en=purchase&ep.transaction_id=42\nen=purchase&ep.transaction_id=42'));
  assert.equal(events.length, 2);
});

test('collector captures early events and can release its listener', () => {
  const page = new EventEmitter();
  const collector = attachGA4Collector(page);
  page.emit('request', request('en=page_view'));
  assert.equal(collector.events.length, 1);
  collector.stop();
  assert.equal(page.listenerCount('request'), 0);
  page.emit('request', request('en=purchase'));
  assert.equal(collector.events.length, 1);
});
