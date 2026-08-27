import test from 'node:test';
import assert from 'node:assert/strict';

import {
  risolviTempo, istanteLocale, isoRoma, risolviGiornoApp, risolviIstanteApp,
} from '../src/domain/tempo.js';

// Mercoledi' 26 agosto 2026, ora legale.
const MERCOLEDI = new Date('2026-08-26T10:00:00+02:00');

test('un' + "'" + ' ora sola vuol dire oggi', () => {
  const r = risolviTempo('Poste Italiane   08:06', MERCOLEDI);
  assert.equal(r.occurredAt, '2026-08-26T08:06:00+02:00');
  assert.equal(r.confidence, 'high');
});

test('ieri toglie un giorno', () => {
  assert.equal(risolviTempo('ieri, 18:51', MERCOLEDI).occurredAt, '2026-08-25T18:51:00+02:00');
});

test('ieri sa scavalcare la mezzanotte', () => {
  // Catturato alle 00:05 di giovedi': "ieri, 00:12" e' mercoledi', non giovedi'.
  const notte = new Date('2026-08-27T00:05:00+02:00');
  assert.equal(risolviTempo('ieri, 00:12', notte).occurredAt, '2026-08-26T00:12:00+02:00');
});

test('lun risolto da un martedi' + "'" + ' e' + "'" + ' ieri, da una domenica sei giorni fa', () => {
  const martedi = new Date('2026-08-25T10:00:00+02:00');
  const domenica = new Date('2026-08-30T10:00:00+02:00');
  assert.equal(risolviTempo('lun 20:03', martedi).occurredAt, '2026-08-24T20:03:00+02:00');
  assert.equal(risolviTempo('lun 20:03', domenica).occurredAt, '2026-08-24T20:03:00+02:00');
});

test('lo stesso giorno di oggi vale una settimana intera, non zero', () => {
  // Da un mercoledi', "mer" non puo' essere oggi: per oggi il telefono mostra
  // solo l'ora.
  assert.equal(risolviTempo('mer 09:00', MERCOLEDI).occurredAt, '2026-08-19T09:00:00+02:00');
});

test('tutti i nomi dei giorni', () => {
  const attesi = {
    dom: '2026-08-23', lun: '2026-08-24', mar: '2026-08-25',
    mer: '2026-08-19', gio: '2026-08-20', ven: '2026-08-21', sab: '2026-08-22',
  };
  for (const [g, data] of Object.entries(attesi)) {
    assert.equal(risolviTempo(`${g} 12:00`, MERCOLEDI).occurredAt.slice(0, 10), data, g);
  }
});

test('un' + "'" + ' ora di oggi che cade nel futuro e' + "'" + ' uno screenshot vecchio: low', () => {
  const r = risolviTempo('Poste Italiane 23:59', MERCOLEDI);
  assert.equal(r.confidence, 'low');
  assert.equal(r.occurredAt, '2026-08-26T23:59:00+02:00');
});

test('i due punti letti come punto passano, ma in revisione', () => {
  const r = risolviTempo('08.06', MERCOLEDI);
  assert.equal(r.occurredAt, '2026-08-26T08:06:00+02:00');
  assert.equal(r.confidence, 'low');
});

test('senza orario non c' + "'" + 'e' + "'" + ' niente da risolvere', () => {
  assert.equal(risolviTempo('Poste Italiane', MERCOLEDI), null);
  assert.equal(risolviTempo('Gocce Di Caffe. Bari, Puglia', MERCOLEDI), null);
  assert.equal(risolviTempo('25:00', MERCOLEDI), null);
});

test('ora legale e ora solare danno offset diversi', () => {
  // In Italia nel 2026 la legale va dal 29 marzo al 25 ottobre.
  assert.equal(isoRoma(istanteLocale(2026, 7, 15, 12, 0)), '2026-07-15T12:00:00+02:00');
  assert.equal(isoRoma(istanteLocale(2026, 1, 15, 12, 0)), '2026-01-15T12:00:00+01:00');
});

test('il giorno del cambio ora non sballa la data', () => {
  // Ultima domenica di ottobre: il giorno dura 25 ore.
  const domenicaSolare = new Date('2026-10-25T23:00:00+01:00');
  assert.equal(risolviTempo('ieri, 23:30', domenicaSolare).occurredAt, '2026-10-24T23:30:00+02:00');
  // Ultima domenica di marzo: ne dura 23.
  const domenicaLegale = new Date('2026-03-29T23:00:00+02:00');
  assert.equal(risolviTempo('ieri, 23:30', domenicaLegale).occurredAt, '2026-03-28T23:30:00+01:00');
});

test('l' + "'" + ' ora ripetuta di ottobre sceglie la seconda occorrenza', () => {
  // Le 02:30 del 25 ottobre 2026 esistono due volte, a un' + "'" + ' ora di distanza.
  // Non capita in una notifica vera, ma la funzione deve restare totale e
  // scegliere sempre allo stesso modo: vince quella gia' in ora solare.
  assert.equal(isoRoma(istanteLocale(2026, 10, 25, 2, 30)), '2026-10-25T02:30:00+01:00');
});

test('l' + "'" + ' ora inesistente di marzo scivola in avanti invece di esplodere', () => {
  assert.equal(isoRoma(istanteLocale(2026, 3, 29, 2, 30)), '2026-03-29T03:30:00+02:00');
});

// Le date assolute della schermata dei movimenti. Qui non c'e' niente di
// relativo da ricostruire: la data e' scritta, e o si legge o non si legge.

test('il mese abbreviato vale come quello per esteso', () => {
  for (const [testo, giorno] of [
    ['27 ago 2026', '2026-08-27'],
    ['1 gen 2026', '2026-01-01'],
    ['31 dic 2025', '2025-12-31'],
    ['5 set 2026', '2026-09-05'],
    ['5 sett 2026', '2026-09-05'],
    ['5 set. 2026', '2026-09-05'],
    ['5 settembre 2026', '2026-09-05'],
  ]) {
    assert.deepEqual(risolviGiornoApp(testo, MERCOLEDI), { giorno, confidence: 'high' }, testo);
  }
});

test('la data numerica dell' + "'" + ' app si legge, quella impossibile no', () => {
  assert.deepEqual(risolviGiornoApp('27/08/2026', MERCOLEDI), { giorno: '2026-08-27', confidence: 'high' });
  // Il 31 febbraio non esiste: senza controllarlo diventerebbe il 3 marzo, e
  // una data inventata non si vede piu'.
  assert.equal(risolviGiornoApp('31/02/2026', MERCOLEDI), null);
  assert.equal(risolviGiornoApp('31 feb 2026', MERCOLEDI), null);
  assert.equal(risolviGiornoApp('27/13/2026', MERCOLEDI), null);
});

test('data e ora insieme fanno un istante vero', () => {
  assert.deepEqual(risolviIstanteApp('27/08/2026 16:36'), {
    giorno: '2026-08-27',
    occurredAt: '2026-08-27T16:36:00+02:00',
    ts: istanteLocale(2026, 8, 27, 16, 36),
    confidence: 'high',
  });
  // Con i due punti letti come un punto si legge lo stesso, ma si controlla.
  assert.equal(risolviIstanteApp('27/08/2026 16.36').confidence, 'low');
  // L'ora solare la sceglie il calendario, non chi legge.
  assert.equal(risolviIstanteApp('15/01/2026 09:00').occurredAt, '2026-01-15T09:00:00+01:00');
});

test('un istante che non e' + "'" + ' un istante resta null', () => {
  for (const t of ['27/08/2026', '16:36', '27/08/2026 25:00', '27/08/2026 16:99', '', null]) {
    assert.equal(risolviIstanteApp(t), null, String(t));
  }
});
