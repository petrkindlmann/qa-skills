import test from 'node:test';
import assert from 'node:assert/strict';
import {quote} from './quote.mjs';
test('standard shipping below threshold',()=>assert.deepEqual(quote(4999),{subtotal:4999,shipping:500,total:5499}));
test('standard shipping above threshold',()=>assert.deepEqual(quote(5001),{subtotal:5001,shipping:0,total:5001}));
test('express cost',()=>assert.deepEqual(quote(6000,'express'),{subtotal:6000,shipping:1200,total:7200}));

test('standard shipping is free at exactly 5000 cents', () => {
  assert.deepEqual(quote(5000, 'standard'), {subtotal: 5000, shipping: 0, total: 5000});
});

test('zero subtotal still pays standard shipping', () => {
  assert.deepEqual(quote(0, 'standard'), {subtotal: 0, shipping: 500, total: 500});
});

for (const subtotal of [0, 4999, 5000, 5001]) {
  test(`express always costs 1200 cents for subtotal ${subtotal}`, () => {
    assert.deepEqual(quote(subtotal, 'express'), {subtotal, shipping: 1200, total: subtotal + 1200});
  });
}

for (const [label, subtotal] of [
  ['negative', -1], ['fractional', 1.5], ['numeric string', '5000'],
  ['null', null], ['boolean', true], ['object', {}], ['array', []],
  ['missing', undefined], ['NaN', NaN], ['infinity', Infinity],
]) {
  test(`rejects ${label} subtotal`, () => {
    assert.throws(() => quote(subtotal), /Invalid quote input/);
  });
}

for (const method of ['overnight', '', null, 1]) {
  test(`rejects unknown method ${JSON.stringify(method)}`, () => {
    assert.throws(() => quote(5000, method), /Invalid quote input/);
  });
}
