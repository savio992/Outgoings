import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { leggiXlsx, dataDaSeriale } from '../src/domain/xlsx.js';
import { parseEstrattoContoDaGriglia, stipendioDaMovimenti } from '../src/domain/banca.js';

// Un .xlsx vero: ZIP con deflate, stringhe condivise, date come seriali con il
// loro stile. Il file e' committato, e `npm run fixture` lo rifa': un binario
// nel repo senza il modo di riprodurlo e' un dato che nessuno osa piu' toccare.
const QUI = path.dirname(fileURLToPath(import.meta.url));
const FILE = fs.readFileSync(path.join(QUI, 'dati/estratto-conto.xlsx'));

test('legge il foglio, il nome e tutte le righe', async () => {
  const fogli = await leggiXlsx(FILE);
  assert.equal(fogli.length, 1);
  assert.equal(fogli[0].nome, 'Lista Movimenti');
  assert.equal(fogli[0].righe.length, 105); // 4 di preambolo + intestazione + 100
});

test('i seriali di Excel tornano date, non numeri a sei cifre', async () => {
  // E' il motivo per cui vale la pena leggere gli stili: senza, un 46265 e' un
  // numero, e non c'e' modo di sapere che e' il 3 agosto.
  const { righe } = (await leggiXlsx(FILE))[0];
  assert.equal(righe[5][0], '03/08/2026');
  assert.equal(righe[5][1], '01/08/2026');
});

test('dataDaSeriale conosce il baco del 1900', () => {
  // Excel conta dal 30 dicembre 1899 perche' tratta il 1900 come bisestile:
  // un baco di Lotus 1-2-3 copiato per compatibilita' e mai piu' tolto. Il
  // giorno 1 e' quindi il 31 dicembre 1899, non il 1 gennaio 1900.
  assert.equal(dataDaSeriale(1), '31/12/1899');
  assert.equal(dataDaSeriale(46237), '03/08/2026');
  assert.equal(dataDaSeriale(46259), '25/08/2026');
});

test('la parte decimale del seriale e' + "'" + ' l' + "'" + ' ora', () => {
  assert.equal(dataDaSeriale(46259.5), '25/08/2026 12.00');
  // 18:51, cioe' 1131 minuti su 1440. Non 18,51 in decimale: quello sarebbe
  // un altro orario, e la differenza sono venti minuti.
  assert.equal(dataDaSeriale(46259 + (18 * 60 + 51) / 1440), '25/08/2026 18.51');
});

test('le stringhe condivise arrivano intere', async () => {
  const { righe } = (await leggiXlsx(FILE))[0];
  assert.equal(righe[0][0], 'Intestato a: ROSSI MARIO');
  assert.deepEqual(righe[4], ['Data Contabile', 'Data Valuta', 'Addebiti (euro)', 'Accrediti (euro)', 'Descrizione operazioni']);
  assert.ok(righe[5][4].startsWith('BONIFICO STIPENDIO'));
});

test('le celle vuote non fanno slittare le colonne', async () => {
  // Excel non scrive le celle vuote: se non si tiene conto del riferimento
  // ("D6" e non "la quarta cella scritta"), un accredito finisce nella colonna
  // degli addebiti - cioe' uno stipendio diventa la spesa piu' grossa del mese.
  const { righe } = (await leggiXlsx(FILE))[0];
  const stipendio = righe[5];
  assert.equal(stipendio[2], '', 'la colonna degli addebiti deve restare vuota');
  assert.equal(Number(stipendio[3]), 1850);
  assert.ok(stipendio[4].startsWith('BONIFICO STIPENDIO'));
});

test('il giro completo: dal file .xlsx ai movimenti', async () => {
  const fogli = await leggiXlsx(FILE);
  const { movimenti, periodo, saltate } = parseEstrattoContoDaGriglia(fogli[0].righe);

  assert.equal(movimenti.length, 100);
  assert.equal(saltate, 0);
  assert.deepEqual(periodo, { da: '2026-08-01', a: '2026-08-26' });

  const spese = movimenti.filter((m) => !m.entrata && !m.fissa);
  assert.equal(spese.length, 96);
  assert.equal(spese.every((m) => m.timeKnown), true);
  assert.equal(movimenti.filter((m) => m.fissa).length, 3);
  assert.equal(movimenti.filter((m) => m.entrata).length, 1);
});

test('lo stipendio si ricava anche da un file vero', async () => {
  const fogli = await leggiXlsx(FILE);
  const { movimenti } = parseEstrattoContoDaGriglia(fogli[0].righe);
  assert.equal(stipendioDaMovimenti(movimenti).importo, 1850);
});

test('ogni operazione resta distinta: cento righe, cento spese', async () => {
  const fogli = await leggiXlsx(FILE);
  const { movimenti } = parseEstrattoContoDaGriglia(fogli[0].righe);
  assert.equal(new Set(movimenti.map((m) => m.id)).size, 100);
});

test('un file che non e' + "'" + ' uno .xlsx lo dice invece di rompersi in silenzio', async () => {
  await assert.rejects(() => leggiXlsx(new Uint8Array([1, 2, 3, 4])), /xlsx/i);
  await assert.rejects(() => leggiXlsx(new TextEncoder().encode('ciao'.repeat(100))), /xlsx/i);
});
