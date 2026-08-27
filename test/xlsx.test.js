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

test('una riga con meno celle dell' + "'" + ' intestazione si scarta, non si indovina', async () => {
  // Excel non scrive le celle vuote, e certi generatori omettono anche il
  // riferimento della cella ("r=C6"). Allora le colonne slittano: l'importo di
  // un accredito finisce dove ci si aspetta un addebito, e la descrizione
  // sparisce oltre il bordo.
  //
  // Il segno non e' deducibile - una riga di quattro celle con un numero in
  // terza posizione puo' essere un addebito senza accrediti o un accredito
  // senza addebiti, e non c'e' modo di saperlo. Quindi non si sceglie: si
  // scarta e lo si dichiara. Un registro pieno di numeri plausibili e sbagliati
  // e' peggio di un registro con dei buchi, perche' non se ne accorge nessuno.
  const griglia = [
    ['Data Contabile', 'Data Valuta', 'Addebiti (euro)', 'Accrediti (euro)', 'Descrizione operazioni'],
    ['27/08/2026', '25/08/2026', '63.03', 'PAGAMENTO POS TIZIO 25/08/2026 18.51 BARI Op.600000 carta ****0000'],
    ['01/08/2026', '01/08/2026', '1850', 'STIPENDIO/PENSIONE DEL MESE'],
  ];
  const { movimenti, saltate, diagnostica } = parseEstrattoContoDaGriglia(griglia);

  assert.equal(movimenti.length, 0);
  assert.equal(saltate, 2);
  // E soprattutto: la diagnostica lo dice, invece di lasciare il buco muto.
  assert.equal(diagnostica.celleIntestazione, 5);
  assert.equal(diagnostica.righeCorte, 2);
  assert.equal(diagnostica.esempiSaltate.length, 2);
});

test('le righe complete restano leggibili accanto a quelle corte', async () => {
  const griglia = [
    ['Data Contabile', 'Data Valuta', 'Addebiti (euro)', 'Accrediti (euro)', 'Descrizione operazioni'],
    ['27/08/2026', '25/08/2026', '63.03', '', 'PAGAMENTO POS TIZIO 25/08/2026 18.51 BARI Op.600000 carta ****0000'],
    ['01/08/2026', '01/08/2026', '1850', 'STIPENDIO/PENSIONE DEL MESE'],
  ];
  const { movimenti, saltate } = parseEstrattoContoDaGriglia(griglia);
  assert.equal(movimenti.length, 1);
  assert.equal(movimenti[0].amount, 63.03);
  assert.equal(saltate, 1);
});

test('una cella vuota auto-chiusa non si mangia quella dopo', async () => {
  // Excel scrive le celle senza contenuto come `<c/>`. Leggendo gli attributi
  // con ingordigia, la barra finiva fra gli attributi, il ramo di chiusura non
  // scattava e la cella successiva veniva inghiottita: la descrizione perdeva
  // il proprio t="s" e restava l'indice grezzo nella tabella delle stringhe.
  //
  // Su un estratto conto vero questo faceva entrare 8 movimenti su 115: ogni
  // riga ha una delle due colonne degli importi vuota, quindi ogni riga si
  // accorciava di una cella e la descrizione slittava fuori posto.
  const { righe } = (await leggiXlsx(FILE))[0];
  const conAddebito = righe.find((r) => r[4] && r[4].startsWith('PAGAMENTO POS'));

  assert.ok(conAddebito, 'la descrizione deve stare nella quinta colonna');
  assert.equal(conAddebito.length, 5);
  assert.equal(conAddebito[3], '', 'la colonna degli accrediti resta vuota, non sparisce');
  assert.ok(Number(conAddebito[2]) > 0, 'l’addebito resta nella sua colonna');

  // E nessuna riga deve contenere un indice di stringa al posto del testo.
  for (const r of righe.slice(5)) {
    assert.ok(Number.isNaN(Number(r[4])), `riga con descrizione non risolta: ${JSON.stringify(r)}`);
  }
});

test('le celle vuote non fanno slittare le colonne, nemmeno senza riferimento', async () => {
  const { righe } = (await leggiXlsx(FILE))[0];
  // Tutte le righe di movimento hanno cinque celle: due date, due colonne di
  // importi (una vuota) e la descrizione.
  const movimenti = righe.slice(5);
  assert.ok(movimenti.length > 90);
  assert.ok(movimenti.every((r) => r.length === 5), 'ogni riga deve avere cinque celle');
  // Per ogni riga esattamente una delle due colonne degli importi e' piena.
  assert.ok(movimenti.every((r) => (r[2] === '') !== (r[3] === '')));
});
