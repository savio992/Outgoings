import test from 'node:test';
import assert from 'node:assert/strict';

import { cercaMovimenti, sommaMovimenti } from '../src/domain/ricerca.js';

let n = 0;
const riga = (giorno, merchant, amount, extra = {}) => ({
  id: `c${n++}`, merchant, amount,
  occurredAt: `${giorno}T09:00:00+02:00`, source: 'app', confidence: 'high',
  ...extra,
});

const REGISTRO = [
  riga('2026-09-03', 'Gocce Di Caffè', 4, { city: 'Bari' }),
  riga('2026-09-02', 'FAMILA', 42.3),
  riga('2026-08-28', 'Anna Bianchi', 50, { causale: 'Pannolini' }),
  riga('2026-08-27', 'BIANCHI ANNA', 120, { entrata: true }),
  riga('2026-08-05', 'ENEL', 80, { fissa: true }),
  riga('2026-08-04', 'Bar Via 4 Novembre', 1.2, { confidence: 'low' }),
  riga('2026-08-03', 'Edicola', 4.5, { source: 'manuale' }),
];

const nomi = (righe) => righe.map((t) => t.merchant);

test('il testo si trova senza accenti e senza maiuscole', () => {
  assert.deepEqual(nomi(cercaMovimenti(REGISTRO, { testo: 'caffe' })), ['Gocce Di Caffè']);
  assert.deepEqual(nomi(cercaMovimenti(REGISTRO, { testo: 'bari' })), ['Gocce Di Caffè']);
});

test('la causale si cerca come il nome', () => {
  assert.deepEqual(nomi(cercaMovimenti(REGISTRO, { testo: 'pannolini' })), ['Anna Bianchi']);
});

test('le parole valgono in qualunque ordine', () => {
  assert.deepEqual(nomi(cercaMovimenti(REGISTRO, { testo: 'anna bianchi' })), ['Anna Bianchi', 'BIANCHI ANNA']);
});

test('un numero intero trova gli importi di quegli euro, non gli indirizzi', () => {
  assert.deepEqual(nomi(cercaMovimenti(REGISTRO, { testo: '4' })), ['Gocce Di Caffè', 'Edicola']);
});

test('un numero con i centesimi trova solo se stesso', () => {
  assert.deepEqual(nomi(cercaMovimenti(REGISTRO, { testo: '4,50' })), ['Edicola']);
  assert.deepEqual(nomi(cercaMovimenti(REGISTRO, { testo: '42.3' })), ['FAMILA']);
});

test('la categoria scelta dall' + "'" + 'utente si cerca anche lei', () => {
  const config = { categorie: { famila: 'Spesa' } };
  assert.deepEqual(nomi(cercaMovimenti(REGISTRO, { testo: 'spesa' }, config)), ['FAMILA']);
});

test('i filtri usano le stesse definizioni dei conti', () => {
  assert.deepEqual(nomi(cercaMovimenti(REGISTRO, { filtro: 'entrate' })), ['BIANCHI ANNA']);
  assert.deepEqual(nomi(cercaMovimenti(REGISTRO, { filtro: 'fisse' })), ['ENEL']);
  assert.deepEqual(nomi(cercaMovimenti(REGISTRO, { filtro: 'verificare' })), ['Bar Via 4 Novembre']);
  assert.deepEqual(nomi(cercaMovimenti(REGISTRO, { filtro: 'mano' })), ['Edicola']);
  assert.equal(cercaMovimenti(REGISTRO, { filtro: 'spese' }).length, 5);
});

test('testo e filtro insieme', () => {
  assert.deepEqual(nomi(cercaMovimenti(REGISTRO, { testo: 'anna', filtro: 'entrate' })), ['BIANCHI ANNA']);
});

test('la somma tiene le entrate a parte', () => {
  assert.deepEqual(sommaMovimenti(cercaMovimenti(REGISTRO, { testo: 'anna' })),
    { quante: 2, uscite: 50, entrate: 120 });
});

test('le migliaia col punto, il segno e un importo scritto a meta' + "'", () => {
  const r = [riga('2026-09-01', 'Auto', 1234), riga('2026-09-01', 'Bar', 1.5), riga('2026-09-01', 'Spesa', 12.5)];
  assert.deepEqual(nomi(cercaMovimenti(r, { testo: '1.234' })), ['Auto']);
  assert.deepEqual(nomi(cercaMovimenti(r, { testo: '€1.234' })), ['Auto']);
  assert.deepEqual(nomi(cercaMovimenti(r, { testo: '1.234,00' })), ['Auto']);
  assert.deepEqual(nomi(cercaMovimenti(r, { testo: '-12,50' })), ['Spesa']);
  assert.deepEqual(nomi(cercaMovimenti(r, { testo: '12,' })), ['Spesa']);
});

test('accrediti e fisse non hanno categoria, neanche nella ricerca', () => {
  const config = { categorie: { enel: 'Casa' } };
  assert.deepEqual(nomi(cercaMovimenti(REGISTRO, { testo: 'casa' }, config)), []);
});
