import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAppList } from '../src/domain/parser.js';
import { merge } from '../src/domain/registro.js';
import { risolviGiornoApp } from '../src/domain/tempo.js';

// La schermata vera: catturata alle 23:02 di mercoledi' 26 agosto 2026.
const SERA = new Date('2026-08-26T23:02:00+02:00');

const SCHERMATA = [
  '23:02',
  'Gocce Di Caffe', '4,00 €', 'Bari, Puglia', '14 ore fa',
  "Famila Bistro'", '63,03 €', 'Bari, Puglia', 'Ieri',
  'Gocce Di Caffe', '3,50 €', 'Bari, Puglia', 'Ieri',
  'Crucotto Snc', '19,00 €', 'Bari, Puglia', 'Lunedì',
  'Azzaro', '17,98 €', 'Bari, Puglia', 'Lunedì',
  'Gocce Di Caffe', '8,00 €', 'Bari, Puglia', 'Lunedì',
  'Fuori Dal Comune', '17,00 €', 'Bari, Puglia', 'Domenica',
  'Crudammare', '34,50 €', 'Bari, Puglia', 'Domenica',
  'Qua La Zampa!', '15,90 €', 'Monopoli, Puglia', 'Venerdì',
].join('\n');

test('legge tutte e nove le spese della schermata vera', () => {
  const t = parseAppList(SCHERMATA, SERA);
  assert.equal(t.length, 9);
  assert.equal(t.reduce((s, x) => s + x.amount, 0).toFixed(2), '182.91');
  assert.ok(t.every((x) => x.source === 'app'));
  assert.ok(t.every((x) => x.timeKnown === false));
});

test('esercente e citta' + "'" + ' arrivano gia' + "'" + ' separati, senza tagliare su un punto', () => {
  const t = parseAppList(SCHERMATA, SERA);
  assert.equal(t.find((x) => x.amount === 19).merchant, 'Crucotto Snc');
  assert.equal(t.find((x) => x.amount === 15.9).merchant, 'Qua La Zampa!');
  assert.equal(t.find((x) => x.amount === 15.9).city, 'Monopoli');
  assert.equal(t.find((x) => x.amount === 63.03).merchant, "Famila Bistro'");
  assert.ok(t.every((x) => x.region === 'Puglia'));
});

test('i giorni relativi si risolvono in date vere', () => {
  const per = Object.fromEntries(parseAppList(SCHERMATA, SERA).map((t) => [t.amount, t.occurredAt.slice(0, 10)]));
  assert.equal(per[4], '2026-08-26');    // 14 ore fa
  assert.equal(per[63.03], '2026-08-25'); // Ieri
  assert.equal(per[19], '2026-08-24');    // Lunedi'
  assert.equal(per[17], '2026-08-23');    // Domenica
  assert.equal(per[15.9], '2026-08-21');  // Venerdi'
});

test('l' + "'" + ' orario dell' + "'" + ' app e' + "'" + ' una finestra, non un istante', () => {
  // Nei due screenshot veri la stessa spesa e' "08:06" nella notifica e
  // "14 ore fa" nella lista, catturata alle 23:02: ricostruirla darebbe le
  // 09:02. Il giorno e' giusto, l' + "'" + ' ora no, e infatti non si usa.
  assert.equal(parseAppList(SCHERMATA, SERA)[0].occurredAt, '2026-08-26T00:00:00+02:00');
});

test('la finestra che scavalca la mezzanotte manda il giorno in revisione', () => {
  const notte = new Date('2026-08-27T01:10:00+02:00');
  assert.deepEqual(risolviGiornoApp('1 ora fa', notte), { giorno: '2026-08-27', confidence: 'low' });
  assert.deepEqual(risolviGiornoApp('2 ore fa', notte), { giorno: '2026-08-26', confidence: 'high' });
});

test('la voce tagliata in cima non viene emessa', () => {
  // Lo screenshot comincia a meta': la prima voce ha importo e citta' ma la sua
  // data e' rimasta fuori dallo schermo.
  const t = parseAppList(['Bari, Puglia', 'Gocce Di Caffe', '4,00 €', 'Bari, Puglia', '14 ore fa'].join('\n'), SERA);
  assert.equal(t.length, 1);
  assert.equal(t[0].amount, 4);
});

test('la voce tagliata in fondo non viene emessa', () => {
  const t = parseAppList([
    'Gocce Di Caffe', '4,00 €', 'Bari, Puglia', '14 ore fa',
    'Crucotto Snc', '19,00 €', 'Bari, Puglia',
  ].join('\n'), SERA);
  assert.equal(t.length, 1);
});

test('una data che non conosciamo salta la voce invece di inventarla', () => {
  const t = parseAppList(['Gocce Di Caffe', '4,00 €', 'Bari, Puglia', 'la settimana scorsa'].join('\n'), SERA);
  assert.deepEqual(t, []);
});

test('l' + "'" + ' importo in coda al nome, se l' + "'" + ' OCR tiene le colonne unite', () => {
  const t = parseAppList(['Gocce Di Caffe 4,00 €', 'Bari, Puglia', '14 ore fa'].join('\n'), SERA);
  assert.equal(t.length, 1);
  assert.equal(t[0].merchant, 'Gocce Di Caffe');
  assert.equal(t[0].amount, 4);
});

test('senza la riga del luogo si legge lo stesso, ma in revisione', () => {
  const t = parseAppList(['Amazon', '12,90 €', 'Ieri'].join('\n'), SERA);
  assert.equal(t.length, 1);
  assert.equal(t[0].merchant, 'Amazon');
  assert.equal(t[0].city, null);
  assert.equal(t[0].confidence, 'low');
});

test('due spese identiche nello stesso giorno restano due', () => {
  // Senza orario le distingue solo la posizione nel giorno.
  const t = parseAppList([
    'Gocce Di Caffe', '4,00 €', 'Bari, Puglia', '14 ore fa',
    'Gocce Di Caffe', '4,00 €', 'Bari, Puglia', '16 ore fa',
  ].join('\n'), SERA);
  assert.equal(t.length, 2);
  assert.notEqual(t[0].id, t[1].id);
  assert.equal(merge([], t).registro.length, 2);
});

test('reimportare la stessa schermata non aggiunge niente', () => {
  const prima = merge([], parseAppList(SCHERMATA, SERA));
  assert.equal(prima.aggiunte.length, 9);
  const dopo = merge(prima.registro, parseAppList(SCHERMATA, SERA));
  assert.equal(dopo.aggiunte.length, 0);
  assert.equal(dopo.duplicate.length, 9);
});

test('la numerazione si conta dalla piu' + "'" + ' vecchia, cosi' + "'" + ' regge quando ne arrivano di nuove', () => {
  // La lista cresce dall' + "'" + ' alto. Contando dal basso, la spesa gia' + "'" + ' importata
  // tiene il suo numero e non torna a sembrare nuova.
  const ieri = ['Gocce Di Caffe', '4,00 €', 'Bari, Puglia', '14 ore fa'].join('\n');
  const oggi = ['Gocce Di Caffe', '4,00 €', 'Bari, Puglia', '2 ore fa',
                'Gocce Di Caffe', '4,00 €', 'Bari, Puglia', '14 ore fa'].join('\n');

  const primo = merge([], parseAppList(ieri, SERA));
  const secondo = merge(primo.registro, parseAppList(oggi, SERA));
  assert.equal(secondo.aggiunte.length, 1);
  assert.equal(secondo.duplicate.length, 1);
  assert.equal(secondo.registro.length, 2);
});

test('spazzatura e schermate vuote non producono spese', () => {
  for (const s of ['', '   ', '23:02\nCerca\nAltro', null]) {
    assert.deepEqual(parseAppList(s, SERA), []);
  }
});

test('dentro il giorno si conserva l' + "'" + ' ordine in cui l' + "'" + ' app le mostra', () => {
  // Nella lista Famila (63,03) sta sopra Gocce (3,50): e' piu' recente, e nel
  // registro deve restare sopra. Senza orario lo sa solo la posizione.
  const { registro } = merge([], parseAppList(SCHERMATA, SERA));
  const ieri = registro.filter((t) => t.occurredAt.startsWith('2026-08-25'));
  assert.deepEqual(ieri.map((t) => t.amount), [63.03, 3.5]);

  const lunedi = registro.filter((t) => t.occurredAt.startsWith('2026-08-24'));
  assert.deepEqual(lunedi.map((t) => t.amount), [19, 17.98, 8]);
});

// L'ordine in cui l'OCR sputa le righe di una voce non e' garantito: l'importo
// sta nella colonna di destra e puo' uscire prima o dopo il blocco di sinistra.
// Il parser deve leggere le stesse spese in entrambi i casi.
const ORDINI = {
  'importo dopo il nome': ['Gocce Di Caffe', '4,00 €', 'Bari, Puglia', '14 ore fa',
    "Famila Bistro'", '63,03 €', 'Bari, Puglia', 'Ieri'],
  'importo dopo la data': ['Gocce Di Caffe', 'Bari, Puglia', '14 ore fa', '4,00 €',
    "Famila Bistro'", 'Bari, Puglia', 'Ieri', '63,03 €'],
  'importo in coda al nome': ['Gocce Di Caffe 4,00 €', 'Bari, Puglia', '14 ore fa',
    "Famila Bistro' 63,03 €", 'Bari, Puglia', 'Ieri'],
};

for (const [come, righe] of Object.entries(ORDINI)) {
  test(`l'importo resta sulla sua spesa — ${come}`, () => {
    // Il bug vero: con l'importo dopo la data ogni importo scivolava sulla voce
    // seguente, e Gocce Di Caffe si ritrovava i 63,03 € della cena.
    const t = parseAppList(righe.join('\n'), SERA);
    assert.equal(t.length, 2, come);
    assert.deepEqual(t.map((x) => [x.merchant, x.amount, x.occurredAt.slice(0, 10)]), [
      ['Gocce Di Caffe', 4, '2026-08-26'],
      ["Famila Bistro'", 63.03, '2026-08-25'],
    ], come);
  });
}

test('l' + "'" + ' orologio della barra di stato non apre una voce', () => {
  const t = parseAppList(['23:02', 'Gocce Di Caffe', 'Bari, Puglia', '14 ore fa', '4,00 €'].join('\n'), SERA);
  assert.equal(t.length, 1);
  assert.equal(t[0].merchant, 'Gocce Di Caffe');
});

// Il dump vero, copiato con Live Text da una schermata catturata alle 07:42 di
// giovedi' 27 agosto. Non e' un campione inventato: e' esattamente il testo che
// Vision restituisce, spazzatura della barra di stato compresa.
const GIOVEDI = new Date('2026-08-27T07:42:00+02:00');

const DUMP = `07:42 (
X
134
E23
(
• ••
Gocce Di Caffe
Bari, Puglia
leri
4,00 €
>
Famila Bistro'
Bari, Puglia
Martedi
63,03 €
Gocce Di Caffe
Bari, Puglia
Martedì
3,50 €
>
Crucotto Snc
Bari, Puglia
Lunedì
19,00 €
Azzaro
Bari, Puglia
Lunedì
17,98 €
>
Gocce Di Caffe
Bari, Puglia
Lunedi
8,00 €
>
Fuori Dal Comune
Bari, Puglia
Domenica
17,00€ >
Crudammare
Bari, Puglia
Domenica
34,50 €
>
Qua La Zampa!
Monopoli, Puglia
15,90 € >`;

test('il dump vero: otto spese, ognuna col suo importo', () => {
  const t = parseAppList(DUMP, GIOVEDI);
  assert.deepEqual(t.map((x) => [x.merchant, x.amount, x.occurredAt.slice(0, 10)]), [
    ['Gocce Di Caffe', 4, '2026-08-26'],
    ["Famila Bistro'", 63.03, '2026-08-25'],
    ['Gocce Di Caffe', 3.5, '2026-08-25'],
    ['Crucotto Snc', 19, '2026-08-24'],
    ['Azzaro', 17.98, '2026-08-24'],
    ['Gocce Di Caffe', 8, '2026-08-24'],
    ['Fuori Dal Comune', 17, '2026-08-23'],
    ['Crudammare', 34.5, '2026-08-23'],
  ]);
});

test('la spazzatura della barra di stato non diventa una spesa', () => {
  // "X" apre una voce e "134" le si attacca come importo, ma senza una data
  // quella voce non viene mai emessa.
  const t = parseAppList(DUMP, GIOVEDI);
  assert.ok(!t.some((x) => x.merchant === 'X'));
  assert.ok(!t.some((x) => x.amount === 134));
});

test('"leri" e' + "'" + ' "Ieri" con la I letta come l', () => {
  assert.equal(parseAppList(DUMP, GIOVEDI)[0].occurredAt.slice(0, 10), '2026-08-26');
});

test('l' + "'" + ' importo col chevron attaccato si legge lo stesso', () => {
  // "17,00€ >": senza togliere il chevron quella spesa spariva in silenzio.
  const t = parseAppList(DUMP, GIOVEDI);
  assert.equal(t.find((x) => x.merchant === 'Fuori Dal Comune').amount, 17);
});

test('la voce tagliata in fondo resta fuori', () => {
  // "Qua La Zampa!" ha nome, luogo e importo ma la sua data e' finita sotto il
  // bordo dello schermo. Senza data non si emette: sarebbe la data di un altro.
  assert.ok(!parseAppList(DUMP, GIOVEDI).some((x) => x.merchant === 'Qua La Zampa!'));
});

test('i giorni senza accento valgono come quelli con l' + "'" + ' accento', () => {
  const t = parseAppList(DUMP, GIOVEDI);
  assert.equal(t.find((x) => x.amount === 63.03).occurredAt.slice(0, 10), '2026-08-25'); // "Martedi"
  assert.equal(t.find((x) => x.amount === 8).occurredAt.slice(0, 10), '2026-08-24');     // "Lunedi"
});
