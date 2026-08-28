import test from 'node:test';
import assert from 'node:assert/strict';

import { parseNotifications, parseStructured, spezzaEsercente } from '../src/domain/parser.js';

const MERCOLEDI = new Date('2026-08-26T10:00:00+02:00');
const card = (...righe) => righe.join('\n');

test('i quattro campioni veri, tutti e quattro', () => {
  const testo = card(
    'Poste Italiane                    08:06',
    'Gocce Di Caffe. Bari, Puglia',
    '4,00 €',
    'Poste Italiane                    ieri, 18:51',
    "Famila Bistro'. Bari, Puglia",
    '63,03 €',
    'Poste Italiane                    ieri, 08:32',
    'Gocce Di Caffe. Bari, Puglia',
    '3,50 €',
    'Poste Italiane                    lun 20:03',
    'Crucotto Snc. Bari, Puglia',
    '19,00 €',
  );
  const t = parseNotifications(testo, MERCOLEDI);
  assert.equal(t.length, 4);
  assert.deepEqual(t.map((x) => x.merchant), ['Gocce Di Caffe', "Famila Bistro'", 'Gocce Di Caffe', 'Crucotto Snc']);
  assert.deepEqual(t.map((x) => x.amount), [4, 63.03, 3.5, 19]);
  assert.deepEqual(t.map((x) => x.occurredAt.slice(0, 16)), [
    '2026-08-26T08:06', '2026-08-25T18:51', '2026-08-25T08:32', '2026-08-24T20:03',
  ]);
  assert.ok(t.every((x) => x.confidence === 'high'));
  assert.ok(t.every((x) => x.city === 'Bari' && x.region === 'Puglia'));
  assert.ok(t.every((x) => x.source === 'screenshot'));
  assert.ok(t.every((x) => x.rawText.includes('€')));
});

test('l' + "'" + ' intestazione spezzata su due righe funziona uguale', () => {
  const testo = card('Poste Italiane', '08:06', 'Gocce Di Caffe. Bari, Puglia', '4,00 €');
  const t = parseNotifications(testo, MERCOLEDI);
  assert.equal(t.length, 1);
  assert.equal(t[0].occurredAt, '2026-08-26T08:06:00+02:00');
});

test('la card intera senza orario si legge, col giorno dell' + "'" + ' incollata', () => {
  // Non e' una card tagliata: nome dell'app, esercente e importo ci sono tutti,
  // manca solo il *quando*. Scartarla vorrebbe dire far sparire una spesa che si
  // legge per intero - e farla sparire in silenzio.
  const t = parseNotifications(card(
    'Poste Italiane',
    'Gocce Di Caffe. Bari, Puglia',
    '4,00 €',
  ), MERCOLEDI);
  assert.equal(t.length, 1);
  assert.equal(t[0].merchant, 'Gocce Di Caffe');
  assert.equal(t[0].amount, 4);
  assert.equal(t[0].city, 'Bari');
  assert.equal(t[0].occurredAt, '2026-08-26T00:00:00+02:00');
  assert.equal(t[0].timeKnown, false);
  assert.equal(t[0].confidence, 'low');
});

test('due card senza orario nello stesso giorno restano due', () => {
  // Senza ora e con lo stesso importo sarebbero indistinguibili: e' l'ordinale a
  // tenerle separate, come nella lista dell'app.
  const t = parseNotifications(card(
    'Poste Italiane', 'Gocce Di Caffe. Bari, Puglia', '4,00 €',
    'Poste Italiane', 'Gocce Di Caffe. Bari, Puglia', '4,00 €',
  ), MERCOLEDI);
  assert.equal(t.length, 2);
  assert.notEqual(t[0].id, t[1].id);
});

test('senza il nome dell' + "'" + ' app sopra, la card resta tagliata e si scarta', () => {
  // E' la differenza fra "manca l'ora" e "manca un pezzo": qui sopra l'importo
  // comincia gia' la card precedente, e completare vorrebbe dire attaccare un
  // importo a un esercente che non e' il suo.
  const t = parseNotifications(card(
    'Gocce Di Caffe. Bari, Puglia',
    '4,00 €',
  ), MERCOLEDI);
  assert.equal(t.length, 0);
});

test('l' + "'" + ' ora, quando c' + "'" + ' e' + "'" + ', vince sul giorno dell' + "'" + ' incollata', () => {
  const [conOra] = parseNotifications(card(
    'Poste Italiane   08:06', 'Gocce Di Caffe. Bari, Puglia', '4,00 €',
  ), MERCOLEDI);
  assert.equal(conOra.occurredAt, '2026-08-26T08:06:00+02:00');
  assert.equal(conOra.timeKnown, true);
  assert.equal(conOra.confidence, 'high');
  assert.equal(conOra.posizione, undefined);
});

test('la card tagliata in cima si scarta, non si indovina', () => {
  // Lo screenshot comincia a meta' di una card: c' + "'" + 'e' + "'" + ' l' + "'" + ' importo ma non l' + "'" + ' intestazione.
  const testo = card(
    'Gocce Di Caffe. Bari, Puglia',
    '3,50 €',
    'Poste Italiane   08:06',
    'Gocce Di Caffe. Bari, Puglia',
    '4,00 €',
  );
  const t = parseNotifications(testo, MERCOLEDI);
  assert.equal(t.length, 1);
  assert.equal(t[0].amount, 4);
});

test('la card tagliata in fondo si scarta', () => {
  const testo = card(
    'Poste Italiane   08:06',
    'Gocce Di Caffe. Bari, Puglia',
    '4,00 €',
    'Poste Italiane   lun 20:03',
    'Crucotto Snc. Bari, Puglia',
  );
  const t = parseNotifications(testo, MERCOLEDI);
  assert.equal(t.length, 1);
  assert.equal(t[0].amount, 4);
});

test('un solo importo orfano, senza niente sopra, non produce nulla', () => {
  assert.deepEqual(parseNotifications('4,00 €', MERCOLEDI), []);
  assert.deepEqual(parseNotifications(card('Poste Italiane   08:06', '4,00 €'), MERCOLEDI), []);
});

test('l' + "'" + ' importo con le migliaia arriva intero', () => {
  const testo = card('Poste Italiane   08:06', 'Concessionaria S.r.l. Bari, Puglia', '1.234,56 €');
  const t = parseNotifications(testo, MERCOLEDI);
  assert.equal(t[0].amount, 1234.56);
  assert.equal(t[0].merchant, 'Concessionaria S.r.l');
});

test('il simbolo perso trascina la transazione in revisione', () => {
  const testo = card('Poste Italiane   08:06', 'Gocce Di Caffe. Bari, Puglia', '4,00 C');
  const t = parseNotifications(testo, MERCOLEDI);
  assert.equal(t[0].amount, 4);
  assert.equal(t[0].confidence, 'low');
});

test('spezzaEsercente taglia sul primo ". " e non dentro le sigle', () => {
  assert.deepEqual(spezzaEsercente('Gocce Di Caffe. Bari, Puglia'),
    { merchant: 'Gocce Di Caffe', city: 'Bari', region: 'Puglia' });
  assert.deepEqual(spezzaEsercente('Crucotto Snc. Bari, Puglia'),
    { merchant: 'Crucotto Snc', city: 'Bari', region: 'Puglia' });
  assert.deepEqual(spezzaEsercente('Rossi S.r.l. Bari, Puglia'),
    { merchant: 'Rossi S.r.l', city: 'Bari', region: 'Puglia' });
  assert.deepEqual(spezzaEsercente("Famila Bistro'. Bari, Puglia"),
    { merchant: "Famila Bistro'", city: 'Bari', region: 'Puglia' });
});

test('senza citta' + "'" + ' i campi restano null invece di inventarsi', () => {
  assert.deepEqual(spezzaEsercente('Amazon'), { merchant: 'Amazon', city: null, region: null });
  assert.deepEqual(spezzaEsercente('Amazon. Milano'), { merchant: 'Amazon', city: 'Milano', region: null });
});

test('parseStructured legge i campi gia' + "'" + ' separati dell' + "'" + ' ANCS', () => {
  const t = parseStructured({
    subtitle: 'Gocce Di Caffe. Bari, Puglia',
    message: '4,00 €',
    receivedAt: '2026-08-26T08:06:42+02:00',
  });
  assert.equal(t.merchant, 'Gocce Di Caffe');
  assert.equal(t.amount, 4);
  assert.equal(t.source, 'ancs');
  assert.equal(t.occurredAt, '2026-08-26T08:06:00+02:00');
});

test('la stessa spesa vista da screenshot e da ANCS ha lo stesso id', () => {
  // E' la promessa che rende la v2 un innesto invece che una riscrittura: quando
  // arrivera' l' + "'" + ' ESP32, le due sorgenti si deduplicheranno a vicenda.
  const daScreenshot = parseNotifications(
    card('Poste Italiane   08:06', 'Gocce Di Caffe. Bari, Puglia', '4,00 €'), MERCOLEDI)[0];
  const daAncs = parseStructured({
    subtitle: 'Gocce Di Caffe. Bari, Puglia',
    message: '4,00 €',
    receivedAt: '2026-08-26T08:06:42+02:00',
  });
  assert.equal(daScreenshot.id, daAncs.id);
  assert.notEqual(daScreenshot.source, daAncs.source);
});

test('testo vuoto o spazzatura non produce transazioni', () => {
  for (const t of ['', '   ', 'Notifiche\nCancella tutto', null, undefined]) {
    assert.deepEqual(parseNotifications(t, MERCOLEDI), []);
  }
});
