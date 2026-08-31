import test from 'node:test';
import assert from 'node:assert/strict';

import {
  merge, sostituisciPeriodo, eSpesaVariabile, totaleDelGiorno,
  transazioneAMano, esercentiAMano,
} from '../src/domain/registro.js';

const aMano = (merchant, amount, giorno, registro = [], fissa = false) =>
  transazioneAMano({ merchant, amount, giorno, fissa }, registro);

test('una spesa a mano nasce a mezzanotte, senza orario e con fiducia piena', () => {
  const t = aMano('  Gocce  Di Caffe ', 4, '2026-08-31');
  assert.equal(t.merchant, 'Gocce Di Caffe');
  assert.equal(t.amount, 4);
  assert.equal(t.occurredAt, '2026-08-31T00:00:00+02:00');
  assert.equal(t.timeKnown, false);
  assert.equal(t.entrata, false);
  assert.equal(t.source, 'manuale');
  assert.equal(t.confidence, 'high');
  assert.ok(t.id);
});

test('quello che non e' + "'" + ' una spesa non diventa una riga', () => {
  assert.equal(aMano('', 4, '2026-08-31'), null);
  assert.equal(aMano('   ', 4, '2026-08-31'), null);
  assert.equal(aMano('Bar', 0, '2026-08-31'), null);
  assert.equal(aMano('Bar', -3, '2026-08-31'), null);
  assert.equal(aMano('Bar', 'quattro', '2026-08-31'), null);
  assert.equal(aMano('Bar', 4, ''), null);
  assert.equal(aMano('Bar', 4, '31/08/2026'), null);
});

test('due caffe' + "'" + ' identici nello stesso giorno restano due spese', () => {
  const primo = aMano('Bar Gocce', 1.5, '2026-08-31', []);
  const dopoIlPrimo = merge([], [primo]);
  const secondo = aMano('Bar Gocce', 1.5, '2026-08-31', dopoIlPrimo.registro);

  assert.notEqual(primo.id, secondo.id);
  assert.equal(secondo.posizione, primo.posizione + 1);

  const esito = merge(dopoIlPrimo.registro, [secondo]);
  assert.equal(esito.registro.length, 2);
  assert.equal(totaleDelGiorno(esito.registro, '2026-08-31'), 3);
});

test('la stessa spesa aggiunta due volte con lo stesso registro non entra due volte', () => {
  const t = aMano('Bar Gocce', 1.5, '2026-08-31', []);
  const uno = merge([], [t]);
  const due = merge(uno.registro, [t]);
  assert.equal(due.aggiunte.length, 0);
  assert.equal(due.registro.length, 1);
});

test('una uscita fissa scritta a mano non consuma il tetto', () => {
  const t = aMano('Condominio', 120, '2026-08-31', [], true);
  assert.equal(t.fissa, true);
  assert.equal(eSpesaVariabile(t), false);
  assert.equal(totaleDelGiorno([t], '2026-08-31'), 0);
});

// --------------------------------------------------------------------------
// Il punto della sorgente 'manuale': i contanti nell'estratto conto non ci sono
// - c'e' il prelievo - quindi la regola "dentro il suo periodo vince la banca"
// li cancellerebbe per sempre.

const CONTO = [
  {
    id: 'b1', merchant: 'FAMILA', amount: 63.03, occurredAt: '2026-08-10T18:51:00+02:00',
    source: 'banca', confidence: 'high', operazione: '00123',
  },
];

test('una spesa a mano dentro il periodo della banca entra lo stesso', () => {
  const registro = merge([], CONTO).registro;
  const contanti = aMano('Bar del porto', 2, '2026-08-10', registro);

  const esito = merge(registro, [contanti]);
  assert.equal(esito.aggiunte.length, 1);
  assert.equal(esito.coperte.length, 0);
  assert.ok(esito.registro.some((t) => t.id === contanti.id));
});

test('una lettura automatica dentro lo stesso periodo continua a non entrare', () => {
  const registro = merge([], CONTO).registro;
  const daSchermata = {
    id: 's1', merchant: 'Famila Bistro', amount: 63.03,
    occurredAt: '2026-08-10T18:51:00+02:00', source: 'screenshot', confidence: 'high',
  };

  const esito = merge(registro, [daSchermata]);
  assert.equal(esito.aggiunte.length, 0);
  assert.equal(esito.coperte.length, 1);
});

test('reimportare l' + "'" + 'estratto conto non porta via le spese scritte a mano', () => {
  const contanti = aMano('Bar del porto', 2, '2026-08-10', []);
  const daSchermata = {
    id: 's1', merchant: 'Famila Bistro', amount: 63.03,
    occurredAt: '2026-08-10T18:51:00+02:00', source: 'screenshot', confidence: 'high',
  };
  const prima = [contanti, daSchermata];

  const esito = sostituisciPeriodo(prima, CONTO, '2026-08-01', '2026-08-31');

  assert.deepEqual(esito.rimosse.map((t) => t.id), ['s1']);
  assert.ok(esito.registro.some((t) => t.id === contanti.id));
  assert.ok(esito.registro.some((t) => t.operazione === '00123'));
  assert.equal(esito.registro.length, 2);
});

test('sostituisciPeriodo e' + "'" + ' idempotente anche col contante dentro', () => {
  const contanti = aMano('Bar del porto', 2, '2026-08-10', []);
  const uno = sostituisciPeriodo([contanti], CONTO, '2026-08-01', '2026-08-31');
  const due = sostituisciPeriodo(uno.registro, CONTO, '2026-08-01', '2026-08-31');
  assert.equal(due.registro.length, uno.registro.length);
  assert.equal(due.aggiunte.length, 0);
});

// --------------------------------------------------------------------------

test('le grafie proposte sono solo quelle che hai scritto tu', () => {
  const registro = [
    aMano('Bar Gocce', 1.5, '2026-08-31'),
    { merchant: 'WWW.AMAZON.IT', amount: 10, occurredAt: '2026-08-30T00:00:00+02:00', source: 'banca' },
    aMano('Edicola', 2, '2026-08-29'),
    aMano('Bar Gocce', 1.5, '2026-08-28'),
  ];
  assert.deepEqual(esercentiAMano(registro), ['Bar Gocce', 'Edicola']);
  assert.deepEqual(esercentiAMano(registro, 1), ['Bar Gocce']);
  assert.deepEqual(esercentiAMano([]), []);
  assert.deepEqual(esercentiAMano(null), []);
});
