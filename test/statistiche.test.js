import test from 'node:test';
import assert from 'node:assert/strict';

import {
  raggruppa, perRicorrenza, unaTantum, perCategoria, perGiornoSettimana,
  coperturaMese, riepilogoAnalitico, andamentoMesi, nomeDiGruppo, indiceGiorno,
} from '../src/domain/statistiche.js';

let n = 0;
const spesa = (giorno, merchant, amount, extra = {}) => ({
  id: `t${n++}`, merchant, amount,
  occurredAt: `${giorno}T12:00:00+02:00`, source: 'banca', confidence: 'high',
  ...extra,
});

const REGISTRO = [
  spesa('2026-08-03', 'Gocce di caffe', 1.2),
  spesa('2026-08-04', 'Gocce Di Caffe', 2.4),
  spesa('2026-08-05', 'GOCCE DI CAFFE', 1.2),
  spesa('2026-08-06', 'FAMILA MEGAGEST', 40),
  spesa('2026-08-07', 'SUPERMERCATO FAMILA', 30),
  spesa('2026-08-08', 'AUTO2000', 900),
  spesa('2026-08-09', 'ENEL ENERGIA', 170.61, { fissa: true }),
  spesa('2026-08-10', 'STIPENDIO', 1500, { entrata: true }),
];

test('le grafie dello stesso nome fanno un gruppo solo', () => {
  const g = raggruppa(REGISTRO, '2026-08');
  const caffe = g.find((x) => x.chiave === 'caffe di gocce');
  assert.equal(caffe.quante, 3);
  assert.equal(caffe.totale, 4.8);
  assert.equal(caffe.media, 1.6);
  // Il nome mostrato e' uno di quelli visti, mai inventato, e sempre lo stesso.
  assert.equal(caffe.nome, 'Gocce Di Caffe');
  assert.ok(caffe.grafie.includes('GOCCE DI CAFFE'));
});

test('uscite fisse ed entrate restano fuori dalla classifica', () => {
  const nomi = raggruppa(REGISTRO, '2026-08').map((g) => g.nome);
  assert.ok(!nomi.includes('ENEL ENERGIA'));
  assert.ok(!nomi.includes('STIPENDIO'));
});

test('le fisse non spariscono: si contano a parte', () => {
  const r = riepilogoAnalitico(REGISTRO, '2026-08');
  assert.equal(r.fisse.quante, 1);
  assert.equal(r.fisse.totale, 170.61);
  assert.equal(r.speso, 974.8);
  assert.equal(r.quante, 6);
  assert.equal(r.esercenti, 4);
});

test('un alias unisce due esercenti senza toccare il registro', () => {
  const config = { alias: { 'famila megagest': 'SUPERMERCATO FAMILA' } };
  const g = raggruppa(REGISTRO, '2026-08', config);
  const famila = g.find((x) => x.nome === 'SUPERMERCATO FAMILA');
  assert.equal(famila.quante, 2);
  assert.equal(famila.totale, 70);
  assert.ok(famila.unito);
  // Il registro non e' stato riscritto: la banca ha detto "FAMILA MEGAGEST".
  assert.equal(REGISTRO[3].merchant, 'FAMILA MEGAGEST');
});

test('l' + "'" + 'alias vale anche quando il nome scelto non e' + "'" + ' fra quelli del mese', () => {
  const config = { alias: { 'famila megagest': 'Famila', 'famila supermercato': 'Famila' } };
  const g = raggruppa(REGISTRO, '2026-08', config);
  const famila = g.find((x) => x.nome === 'Famila');
  assert.equal(famila.quante, 2);
  assert.equal(famila.totale, 70);
});

test('la classifica per ricorrenza non e' + "'" + ' quella per importo', () => {
  const g = raggruppa(REGISTRO, '2026-08');
  assert.equal(g[0].nome, 'AUTO2000');
  assert.equal(perRicorrenza(g)[0].nome, 'Gocce Di Caffe');
});

test('quello che si e' + "'" + ' visto una volta sola si somma a parte', () => {
  const u = unaTantum(raggruppa(REGISTRO, '2026-08'));
  assert.equal(u.quanti, 3);
  assert.equal(u.totale, 970);
});

test('senza categoria non e' + "'" + ' una categoria', () => {
  const config = { categorie: { 'caffe di gocce': 'Bar' } };
  const { categorie, senza } = perCategoria(raggruppa(REGISTRO, '2026-08', config));
  assert.equal(categorie.length, 1);
  assert.deepEqual(categorie[0], { categoria: 'Bar', quante: 3, totale: 4.8, esercenti: 1 });
  assert.equal(senza.esercenti, 3);
  assert.equal(senza.totale, 970);
});

test('la categoria segue l' + "'" + 'alias, non la grafia', () => {
  const config = {
    alias: { 'famila megagest': 'SUPERMERCATO FAMILA' },
    categorie: { 'famila supermercato': 'Spesa' },
  };
  const g = raggruppa(REGISTRO, '2026-08', config);
  assert.equal(g.find((x) => x.nome === 'SUPERMERCATO FAMILA').categoria, 'Spesa');
});

test('la copertura di un mese entrato a meta' + "'", () => {
  const parziale = [spesa('2026-07-27', 'X', 10), spesa('2026-08-31', 'Y', 10)];
  assert.deepEqual(coperturaMese(parziale, '2026-07'),
    { da: '2026-07-27', a: '2026-07-31', completo: false, giorni: 5 });
  assert.deepEqual(coperturaMese(parziale, '2026-08'),
    { da: '2026-08-01', a: '2026-08-31', completo: true, giorni: 31 });
  assert.equal(coperturaMese(parziale, '2026-06').giorni, 0);
});

test('il giorno della settimana si conta da lunedi' + "'", () => {
  assert.equal(indiceGiorno('2026-08-03'), 0); // lunedi'
  assert.equal(indiceGiorno('2026-08-09'), 6); // domenica
});

test('la media di un giorno divide per i giorni visti, non per quelli del calendario', () => {
  // Dal 3 al 9 agosto 2026: una settimana esatta, un lunedi' solo.
  const r = [spesa('2026-08-03', 'A', 20), spesa('2026-08-09', 'B', 10)];
  const g = perGiornoSettimana(r, '2026-08');
  assert.equal(g[0].giorni, 1);
  assert.equal(g[0].totale, 20);
  assert.equal(g[0].media, 20);
  assert.equal(g[6].media, 10);
  assert.equal(g[1].media, 0);
});

test('un mese intero ha cinque lunedi' + "'" + ' e quattro venerdi' + "'" + ' se il calendario dice cosi' + "'", () => {
  const r = [spesa('2026-08-01', 'A', 1), spesa('2026-08-31', 'B', 1)];
  const g = perGiornoSettimana(r, '2026-08');
  assert.equal(g[0].giorni, 5); // 3, 10, 17, 24, 31
  assert.equal(g[4].giorni, 4); // 7, 14, 21, 28
});

test('un mese coperto a meta' + "'" + ' non e' + "'" + ' confrontabile', () => {
  const r = [spesa('2026-07-27', 'X', 10), spesa('2026-08-20', 'Y', 10)];
  const a = andamentoMesi(r, '2026-08-27');
  assert.equal(a.mesi.length, 2);
  assert.equal(a.mesi[0].completo, false); // luglio: il registro parte il 27
  assert.equal(a.mesi[1].inCorso, true);
  assert.equal(a.confrontabili, 0);
});

test('un mese chiuso e coperto e' + "'" + ' confrontabile', () => {
  const r = [spesa('2026-07-01', 'X', 10), spesa('2026-07-31', 'Y', 10), spesa('2026-08-02', 'Z', 5)];
  const a = andamentoMesi(r, '2026-08-27');
  assert.equal(a.confrontabili, 1);
  assert.equal(a.mesi[0].speso, 20);
});

test('un mese nel futuro non entra', () => {
  const r = [spesa('2026-08-02', 'X', 10), spesa('2026-09-02', 'Y', 10)];
  assert.deepEqual(andamentoMesi(r, '2026-08-27').mesi.map((m) => m.mese), ['2026-08']);
});

test('nomeDiGruppo risolve un salto solo', () => {
  assert.equal(nomeDiGruppo('FAMILA MEGAGEST', { 'famila megagest': 'Famila' }), 'Famila');
  assert.equal(nomeDiGruppo('Altro', {}), 'Altro');
});

test('un registro vuoto non fa esplodere niente', () => {
  assert.deepEqual(raggruppa([], '2026-08'), []);
  assert.deepEqual(unaTantum([]), { quanti: 0, totale: 0 });
  assert.equal(perGiornoSettimana([], '2026-08')[0].media, 0);
  assert.deepEqual(andamentoMesi([], '2026-08-27'), { mesi: [], confrontabili: 0 });
});

test('la categoria sopravvive a un' + "'" + 'unione', () => {
  const config = {
    alias: { 'famila megagest': 'Famila', 'famila supermercato': 'Famila' },
    categorie: { 'famila megagest': 'Spesa' },
  };
  const g = raggruppa(REGISTRO, '2026-08', config);
  assert.equal(g.find((x) => x.nome === 'Famila').categoria, 'Spesa');
});

test('il giorno piu' + "'" + ' caro si porta dietro la spesa che lo ha reso tale', () => {
  const g = perGiornoSettimana(REGISTRO, '2026-08');
  const sabato = g[5]; // 8 agosto 2026
  assert.equal(sabato.maggiore.merchant, 'AUTO2000');
  assert.equal(sabato.maggiore.amount, 900);
  assert.equal(g[0].maggiore.amount, 1.2); // il lunedi' c'e' solo il caffe'
  assert.equal(g[6].maggiore, null); // la domenica ci sono solo una fissa e un accredito
});
