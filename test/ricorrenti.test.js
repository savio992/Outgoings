import test from 'node:test';
import assert from 'node:assert/strict';

import { ricorrenti } from '../src/domain/ricorrenti.js';

let n = 0;
const fissa = (giorno, merchant, amount, extra = {}) => ({
  id: `r${n++}`, merchant, amount, fissa: true,
  occurredAt: `${giorno}T00:00:00+02:00`, source: 'banca', confidence: 'high',
  ...extra,
});

test('una fissa vista in due mesi e non ancora passata e' + "'" + ' in arrivo', () => {
  const r = ricorrenti([
    fissa('2026-07-28', 'BANCA MUTUI', 630),
    fissa('2026-08-28', 'BANCA MUTUI', 630),
  ], '2026-09-10');
  assert.equal(r.voci.length, 1);
  assert.equal(r.voci[0].stato, 'in arrivo');
  assert.equal(r.voci[0].prevista, '2026-09-28');
  assert.equal(r.voci[0].certa, true);
  assert.equal(r.daPagare, 630);
});

test('passata questo mese e' + "'" + ' pagata, e non pesa su quello che manca', () => {
  const r = ricorrenti([
    fissa('2026-08-05', 'ENEL', 80),
    fissa('2026-09-05', 'ENEL', 82.5),
  ], '2026-09-10');
  assert.equal(r.voci[0].stato, 'pagata');
  assert.equal(r.voci[0].importo, 82.5);
  assert.equal(r.daPagare, 0);
  assert.equal(r.pagate, 82.5);
});

test('il giorno passato senza vederla la lascia in attesa, non saltata', () => {
  const r = ricorrenti([
    fissa('2026-07-03', 'ENEL', 80),
    fissa('2026-08-03', 'ENEL', 80),
  ], '2026-09-10');
  assert.equal(r.voci[0].stato, 'attesa');
  assert.equal(r.daPagare, 80);
});

test('vista una volta sola si mostra ma non pesa sul da pagare', () => {
  const r = ricorrenti([fissa('2026-08-20', 'CONDOMINIO', 120)], '2026-09-10');
  assert.equal(r.voci[0].certa, false);
  assert.equal(r.voci[0].stato, 'in arrivo');
  assert.equal(r.daPagare, 0);
});

test('stesso beneficiario, causali diverse: due ricorrenze', () => {
  const r = ricorrenti([
    fissa('2026-08-10', 'Mario Rossi', 630, { causale: 'Mutuo' }),
    fissa('2026-08-12', 'Mario Rossi', 90, { causale: 'Condominio' }),
  ], '2026-09-01');
  assert.equal(r.voci.length, 2);
});

test('il 31 diventa l' + "'" + 'ultimo giorno dei mesi corti', () => {
  const r = ricorrenti([fissa('2026-08-31', 'CANONE', 10), fissa('2026-07-31', 'CANONE', 10)], '2026-09-02');
  assert.equal(r.voci[0].prevista, '2026-09-30');
});

test('una fissa che non si vede da due mesi esce dalla lista', () => {
  const r = ricorrenti([fissa('2026-06-15', 'ANNUALE', 50)], '2026-09-10');
  assert.equal(r.voci.length, 0);
});

test('accrediti e spese normali non sono ricorrenze', () => {
  const r = ricorrenti([
    { ...fissa('2026-08-27', 'STIPENDIO', 2000), fissa: false, entrata: true },
    { ...fissa('2026-08-27', 'BAR', 2), fissa: false },
  ], '2026-09-10');
  assert.equal(r.voci.length, 0);
});

test('prima quello che manca, in fondo quello che e' + "'" + ' pagato', () => {
  const r = ricorrenti([
    fissa('2026-09-02', 'A', 1), fissa('2026-08-02', 'A', 1),
    fissa('2026-08-25', 'B', 1), fissa('2026-07-25', 'B', 1),
    fissa('2026-08-15', 'C', 1), fissa('2026-07-15', 'C', 1),
  ], '2026-09-10');
  assert.deepEqual(r.voci.map((v) => [v.nome, v.stato]), [
    ['C', 'in arrivo'], ['B', 'in arrivo'], ['A', 'pagata'],
  ]);
});

test('a mesi alterni non e' + "'" + ' mensile: non si annuncia per il mese sbagliato', () => {
  const r = ricorrenti([fissa('2026-07-05', 'ACQUA', 90), fissa('2026-09-05', 'ACQUA', 90)], '2026-10-02');
  assert.equal(r.voci[0].certa, false);
  assert.equal(r.daPagare, 0);
});

test('una fissa pagata e mai vista prima si dichiara nuova', () => {
  const r = ricorrenti([
    fissa('2026-07-28', 'BANCA MUTUI', 630), fissa('2026-08-28', 'BANCA MUTUI', 630),
    fissa('2026-09-03', 'Mutuo casa', 630, { source: 'screenshot' }),
  ], '2026-09-10');
  assert.equal(r.nuove, 1);
  assert.equal(r.daPagare, 630);
});
