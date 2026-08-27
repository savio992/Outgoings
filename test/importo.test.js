import test from 'node:test';
import assert from 'node:assert/strict';

import { parseImporto } from '../src/domain/importo.js';

test('legge i campioni veri', () => {
  assert.deepEqual(parseImporto('4,00 €'), { amount: 4, confidence: 'high', simbolo: '€' });
  assert.equal(parseImporto('63,03 €').amount, 63.03);
  assert.equal(parseImporto('3,50 €').amount, 3.5);
  assert.equal(parseImporto('19,00 €').amount, 19);
});

test('le migliaia usano il punto', () => {
  assert.equal(parseImporto('1.234,56 €').amount, 1234.56);
  assert.equal(parseImporto('1.234,56 €').confidence, 'high');
  assert.equal(parseImporto('12.345.678,90 €').amount, 12345678.9);
});

test('il simbolo puo' + "'" + ' stare da entrambe le parti, attaccato o staccato', () => {
  assert.equal(parseImporto('€ 19,00').confidence, 'high');
  assert.equal(parseImporto('19,00€').confidence, 'high');
  assert.equal(parseImporto('€19,00').confidence, 'high');
});

test('simbolo perso o scambiato: si legge ma non ci si fida', () => {
  for (const t of ['4,00', '4,00 C', '4,00 e', '4,00 E', '4,00 £']) {
    const r = parseImporto(t);
    assert.equal(r.amount, 4, t);
    assert.equal(r.confidence, 'low', t);
  }
});

test('il punto decimale e' + "'" + ' una virgola letta male, quindi low', () => {
  const r = parseImporto('4.00 €');
  assert.equal(r.amount, 4);
  assert.equal(r.confidence, 'low');
});

test('senza centesimi si legge ma si manda in revisione', () => {
  assert.deepEqual(
    { a: parseImporto('12 €').amount, c: parseImporto('12 €').confidence },
    { a: 12, c: 'low' },
  );
});

test('le migliaia non raggruppate a tre non si indovinano', () => {
  assert.equal(parseImporto('12.34.56 €'), null);
});

test('cio' + "'" + ' che non e' + "'" + ' un importo non lo diventa', () => {
  for (const t of ['Gocce Di Caffe. Bari, Puglia', 'Poste Italiane', 'Caffe', '', '   ', 'ieri, 18:51', '€', '0,00 €']) {
    assert.equal(parseImporto(t), null, t);
  }
});
