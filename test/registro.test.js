import test from 'node:test';
import assert from 'node:assert/strict';

import { merge, aJsonl, daJsonl, idTransazione, totaleDelGiorno, statoSoglia, normalizzaEsercente, correggi, elimina, aBackup, daBackup, mesiDelRegistro, meseSpostato, riepilogoMese } from '../src/domain/registro.js';
import { parseNotifications } from '../src/domain/parser.js';
import { actualBudget } from '../src/domain/export.js';

const MERCOLEDI = new Date('2026-08-26T10:00:00+02:00');

const SCHERMATA = [
  'Poste Italiane   08:06',
  'Gocce Di Caffe. Bari, Puglia',
  '4,00 €',
  'Poste Italiane   ieri, 18:51',
  "Famila Bistro'. Bari, Puglia",
  '63,03 €',
].join('\n');

test('l' + "'" + ' id non dipende dalla sorgente', () => {
  const campi = { merchant: 'Gocce Di Caffe', amount: 4, occurredAt: '2026-08-26T08:06:00+02:00' };
  assert.equal(idTransazione({ ...campi, source: 'screenshot' }), idTransazione({ ...campi, source: 'ancs' }));
});

test('l' + "'" + ' id ignora maiuscole, spazi doppi e punti finali', () => {
  const a = idTransazione({ merchant: 'Gocce Di Caffe', amount: 4, occurredAt: '2026-08-26T08:06:00+02:00' });
  const b = idTransazione({ merchant: 'GOCCE  DI CAFFE.', amount: 4, occurredAt: '2026-08-26T08:06:00+02:00' });
  assert.equal(a, b);
  assert.equal(normalizzaEsercente('GOCCE  DI CAFFE.'), 'gocce di caffe');
});

test('l' + "'" + ' id cambia se cambia l' + "'" + ' importo, il minuto o l' + "'" + ' esercente', () => {
  const base = { merchant: 'Gocce Di Caffe', amount: 4, occurredAt: '2026-08-26T08:06:00+02:00' };
  const id = idTransazione(base);
  assert.notEqual(id, idTransazione({ ...base, amount: 4.5 }));
  assert.notEqual(id, idTransazione({ ...base, occurredAt: '2026-08-26T08:07:00+02:00' }));
  assert.notEqual(id, idTransazione({ ...base, merchant: 'Altro Bar' }));
});

test('i secondi non entrano nella chiave', () => {
  const a = idTransazione({ merchant: 'X', amount: 1, occurredAt: '2026-08-26T08:06:00+02:00' });
  const b = idTransazione({ merchant: 'X', amount: 1, occurredAt: '2026-08-26T08:06:59+02:00' });
  assert.equal(a, b);
});

test('rifare lo screenshot senza svuotare le notifiche non duplica niente', () => {
  // E' il caso normale, non un caso limite: se non regge, il registro si sporca
  // al secondo uso.
  const prima = merge([], parseNotifications(SCHERMATA, MERCOLEDI));
  assert.equal(prima.aggiunte.length, 2);
  assert.equal(prima.duplicate.length, 0);

  const dopo = merge(prima.registro, parseNotifications(SCHERMATA, MERCOLEDI));
  assert.equal(dopo.aggiunte.length, 0);
  assert.equal(dopo.duplicate.length, 2);
  assert.deepEqual(dopo.registro, prima.registro);
});

test('merge non tocca gli argomenti', () => {
  const registro = [];
  merge(registro, parseNotifications(SCHERMATA, MERCOLEDI));
  assert.equal(registro.length, 0);
});

test('due caffe uguali in minuti diversi restano due spese', () => {
  const testo = [
    'Poste Italiane   08:06', 'Gocce Di Caffe. Bari, Puglia', '4,00 €',
    'Poste Italiane   08:07', 'Gocce Di Caffe. Bari, Puglia', '4,00 €',
  ].join('\n');
  assert.equal(merge([], parseNotifications(testo, MERCOLEDI)).registro.length, 2);
});

test('il registro esce ordinato dalla piu' + "'" + ' recente', () => {
  const { registro } = merge([], parseNotifications(SCHERMATA, MERCOLEDI));
  assert.deepEqual(registro.map((t) => t.amount), [4, 63.03]);
});

test('JSONL e' + "'" + ' un giro chiuso', () => {
  const { registro } = merge([], parseNotifications(SCHERMATA, MERCOLEDI));
  assert.deepEqual(daJsonl(aJsonl(registro)), registro);
});

test('un JSONL troncato restituisce le righe buone, non zero', () => {
  const { registro } = merge([], parseNotifications(SCHERMATA, MERCOLEDI));
  const troncato = aJsonl(registro).trimEnd().split('\n').slice(0, 1).join('\n')
    + '\n{"id":"rot' + '\n';
  assert.equal(daJsonl(troncato).length, 1);
});

test('il totale del giorno somma solo quel giorno', () => {
  const { registro } = merge([], parseNotifications(SCHERMATA, MERCOLEDI));
  assert.equal(totaleDelGiorno(registro, '2026-08-26'), 4);
  assert.equal(totaleDelGiorno(registro, '2026-08-25'), 63.03);
  assert.equal(totaleDelGiorno(registro, '2026-08-24'), 0);
});

test('la soglia dice superata, residuo e totale', () => {
  const { registro } = merge([], parseNotifications(SCHERMATA, MERCOLEDI));
  assert.deepEqual(statoSoglia(registro, '2026-08-25', 50),
    { giorno: '2026-08-25', totale: 63.03, soglia: 50, superata: true, residuo: 0 });
  assert.deepEqual(statoSoglia(registro, '2026-08-26', 50),
    { giorno: '2026-08-26', totale: 4, soglia: 50, superata: false, residuo: 46 });
});

test('soglia a zero vuol dire nessuna soglia', () => {
  assert.equal(statoSoglia([], '2026-08-26', 0).superata, false);
});

test('l' + "'" + ' export per Actual ha le colonne giuste e le uscite in negativo', () => {
  const { registro } = merge([], parseNotifications(SCHERMATA, MERCOLEDI));
  const righe = actualBudget.serializza(registro).trim().split('\n');
  assert.equal(righe[0], 'date,payee,amount,notes');
  assert.equal(righe[1], '2026-08-26,Gocce Di Caffe,-4.00,"Bari, Puglia"');
  assert.equal(righe[2], "2026-08-25,Famila Bistro',-63.03,\"Bari, Puglia\"");
});

test('l' + "'" + ' export segnala le voci da verificare', () => {
  const testo = ['Poste Italiane   08:06', 'Gocce Di Caffe. Bari, Puglia', '4,00 C'].join('\n');
  const { registro } = merge([], parseNotifications(testo, MERCOLEDI));
  assert.ok(actualBudget.serializza(registro).includes('da verificare'));
});

test('le virgolette nel nome non rompono il CSV', () => {
  const csv = actualBudget.serializza([
    { merchant: 'Bar "Da Gino"', amount: 5, occurredAt: '2026-08-26T08:06:00+02:00', city: null, region: null, confidence: 'high' },
  ]);
  assert.ok(csv.includes('"Bar ""Da Gino"""'));
});

test('correggere una spesa la marca sicura e ne ricalcola l' + "'" + ' id', () => {
  const { registro } = merge([], parseNotifications(SCHERMATA, MERCOLEDI));
  const sbagliata = registro.find((t) => t.amount === 63.03);
  const dopo = correggi(registro, sbagliata.id, { merchant: 'Famila Bistro', amount: 4 });

  const corretta = dopo.find((t) => t.merchant === 'Famila Bistro');
  assert.equal(corretta.amount, 4);
  assert.equal(corretta.confidence, 'high');
  assert.equal(corretta.correttaAMano, true);
  assert.notEqual(corretta.id, sbagliata.id);
  assert.equal(corretta.idOriginale, sbagliata.id);
  assert.equal(dopo.length, registro.length);
});

test('una correzione sopravvive al reimport della stessa schermata', () => {
  // Senza ricordare l' + "'" + ' id originale, reimportare rimetterebbe dentro la lettura
  // sbagliata accanto a quella corretta, e la fatica sarebbe da rifare ogni volta.
  const { registro } = merge([], parseNotifications(SCHERMATA, MERCOLEDI));
  const sbagliata = registro.find((t) => t.amount === 63.03);
  const dopo = correggi(registro, sbagliata.id, { amount: 6.30 });

  const reimport = merge(dopo, parseNotifications(SCHERMATA, MERCOLEDI));
  assert.equal(reimport.aggiunte.length, 0);
  assert.equal(reimport.registro.length, 2);
  assert.equal(reimport.registro.find((t) => t.merchant === "Famila Bistro'").amount, 6.30);
});

test('correggere due volte tiene sempre il primo id', () => {
  const { registro } = merge([], parseNotifications(SCHERMATA, MERCOLEDI));
  const originale = registro.find((t) => t.amount === 4).id;
  const una = correggi(registro, originale, { amount: 5 });
  const idUna = una.find((t) => t.amount === 5).id;
  const due = correggi(una, idUna, { amount: 6 });
  assert.equal(due.find((t) => t.amount === 6).idOriginale, originale);
});

test('eliminare toglie solo quella spesa', () => {
  const { registro } = merge([], parseNotifications(SCHERMATA, MERCOLEDI));
  const dopo = elimina(registro, registro[0].id);
  assert.equal(dopo.length, registro.length - 1);
  assert.ok(!dopo.some((t) => t.id === registro[0].id));
});

test('il backup porta con se' + "'" + ' anche le impostazioni', () => {
  // Senza, chi riparte da un file su un altro dispositivo si ritrova il registro
  // giusto e il tetto giornaliero a zero.
  const { registro } = merge([], parseNotifications(SCHERMATA, MERCOLEDI));
  const config = { stipendio: 2000, usciteFisse: [{ nome: 'Affitto', importo: 700 }] };

  const riletto = daBackup(aBackup(registro, config));
  assert.deepEqual(riletto.registro, registro);
  assert.deepEqual(riletto.config, config);
});

test('un backup e' + "'" + ' riconoscibile da un JSONL, e viceversa', () => {
  const { registro } = merge([], parseNotifications(SCHERMATA, MERCOLEDI));
  assert.equal(daBackup(aJsonl(registro)), null);
  assert.equal(daBackup('non sono json'), null);
  assert.equal(daBackup('{"formato":"altro","registro":[]}'), null);
  assert.ok(daBackup(aBackup(registro, {})));
});

test('un backup manomesso non infila spese senza importo', () => {
  const rotto = JSON.stringify({
    formato: 'briciole/1',
    config: {},
    registro: [{ id: 'x', merchant: 'Falsa' }, { id: 'y', merchant: 'Vera', amount: 3, occurredAt: '2026-08-26T00:00:00+02:00' }],
  });
  assert.equal(daBackup(rotto).registro.length, 1);
});

test('reimportare il proprio backup non duplica niente', () => {
  const { registro } = merge([], parseNotifications(SCHERMATA, MERCOLEDI));
  const riletto = daBackup(aBackup(registro, {}));
  assert.equal(merge(registro, riletto.registro).aggiunte.length, 0);
});

test('il numero d' + "'" + ' operazione della banca vale come identita' + "'" + '', () => {
  const base = { merchant: 'X', amount: 4, occurredAt: '2026-08-26T08:06:00+02:00' };
  // Due acquisti gemelli: stessa cassa, stesso importo, stesso minuto. Per una
  // chiave dedotta dai campi sarebbero la stessa spesa; per la banca no.
  assert.notEqual(idTransazione({ ...base, operazione: '1' }), idTransazione({ ...base, operazione: '2' }));
  assert.equal(idTransazione({ ...base, operazione: '1' }), idTransazione({ ...base, operazione: '1' }));
});

test('un id mancante non fa collassare l' + "'" + ' import', () => {
  // `visti.has(undefined)` sarebbe vero per ogni riga successiva senza id, e
  // sei movimenti diventerebbero uno.
  const senzaId = [
    { merchant: 'A', amount: 1, occurredAt: '2026-08-26T00:00:00+02:00' },
    { merchant: 'B', amount: 2, occurredAt: '2026-08-26T00:00:00+02:00' },
    { merchant: 'C', amount: 3, occurredAt: '2026-08-26T00:00:00+02:00' },
  ];
  assert.equal(merge([], senzaId).aggiunte.length, 3);
});

test('i mesi del registro escono dal piu' + "'" + ' recente', () => {
  const t = (giorno) => ({ id: giorno, merchant: 'X', amount: 1, occurredAt: `${giorno}T00:00:00+02:00` });
  const registro = [t('2026-08-26'), t('2026-07-03'), t('2026-08-01'), t('2025-12-31')];
  assert.deepEqual(mesiDelRegistro(registro), ['2026-08', '2026-07', '2025-12']);
});

test('spostarsi di un mese scavalca l' + "'" + ' anno', () => {
  assert.equal(meseSpostato('2026-08', -1), '2026-07');
  assert.equal(meseSpostato('2026-01', -1), '2025-12');
  assert.equal(meseSpostato('2026-12', 1), '2027-01');
});

test('il riepilogo del mese tiene separate spese, fisse ed entrate', () => {
  // Sommarle darebbe un numero che non risponde a nessuna domanda.
  const registro = [
    { id: 'a', merchant: 'Bar', amount: 4, occurredAt: '2026-08-26T00:00:00+02:00' },
    { id: 'b', merchant: 'Affitto', amount: 700, fissa: true, occurredAt: '2026-08-05T00:00:00+02:00' },
    { id: 'c', merchant: 'Stipendio', amount: 1850, entrata: true, occurredAt: '2026-08-01T00:00:00+02:00' },
    { id: 'd', merchant: 'Bar', amount: 9, occurredAt: '2026-07-26T00:00:00+02:00' },
  ];
  assert.deepEqual(riepilogoMese(registro, '2026-08'), { mese: '2026-08', spese: 4, fisse: 700, entrate: 1850, quante: 3 });
  assert.deepEqual(riepilogoMese(registro, '2026-07'), { mese: '2026-07', spese: 9, fisse: 0, entrate: 0, quante: 1 });
  assert.deepEqual(riepilogoMese(registro, '2026-06'), { mese: '2026-06', spese: 0, fisse: 0, entrate: 0, quante: 0 });
});
