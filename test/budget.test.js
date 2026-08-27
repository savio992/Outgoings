import test from 'node:test';
import assert from 'node:assert/strict';

import { statoGiorno, giorniDelMese, disponibileDelMese, totaleUsciteFisse, mediaGiornaliera, ultimiGiorni } from '../src/domain/budget.js';

const CONFIG = {
  stipendio: 2000,
  usciteFisse: [
    { nome: 'Affitto', importo: 700 },
    { nome: 'Rata auto', importo: 250 },
    { nome: 'Abbonamenti', importo: 50 },
  ],
};

const spesa = (giorno, amount) => ({
  id: `${giorno}-${amount}`, merchant: 'X', amount,
  occurredAt: `${giorno}T00:00:00+02:00`, source: 'app', confidence: 'high',
});

test('i giorni del mese, bisestili compresi', () => {
  assert.equal(giorniDelMese(2026, 8), 31);
  assert.equal(giorniDelMese(2026, 2), 28);
  assert.equal(giorniDelMese(2028, 2), 29);
  assert.equal(giorniDelMese(2026, 4), 30);
});

test('il disponibile e' + "'" + ' lo stipendio meno le uscite fisse', () => {
  assert.equal(totaleUsciteFisse(CONFIG), 1000);
  assert.equal(disponibileDelMese(CONFIG), 1000);
});

test('a mese intatto la soglia e' + "'" + ' il disponibile diviso i giorni', () => {
  const s = statoGiorno(CONFIG, [], '2026-08-01');
  assert.equal(s.giorniRestanti, 31);
  assert.equal(s.soglia, 32.26);
  assert.equal(s.residuo, 32.26);
  assert.equal(s.superata, false);
});

test('sforare ieri abbassa il tetto di oggi', () => {
  // Primo giorno speso 200 invece di 32: restano 800 su 30 giorni.
  const s = statoGiorno(CONFIG, [spesa('2026-08-01', 200)], '2026-08-02');
  assert.equal(s.spesoPrima, 200);
  assert.equal(s.giorniRestanti, 30);
  assert.equal(s.soglia, 26.67);
});

test('spendere poco lo alza', () => {
  const s = statoGiorno(CONFIG, [spesa('2026-08-01', 0.01)], '2026-08-02');
  assert.equal(s.soglia, 33.33);
});

test('la soglia guarda solo i giorni passati, non quello in corso', () => {
  // Quello che spendo oggi consuma il residuo di oggi, non abbassa il tetto di
  // oggi mentre lo sto usando.
  const oggi = statoGiorno(CONFIG, [spesa('2026-08-15', 100)], '2026-08-15');
  const vuoto = statoGiorno(CONFIG, [], '2026-08-15');
  assert.equal(vuoto.soglia, 58.82); // 1000 su 17 giorni
  assert.equal(oggi.soglia, 58.82);  // spendere oggi non muove il tetto di oggi
  assert.equal(oggi.spesoOggi, 100);
  assert.equal(oggi.residuo, -41.18);
  assert.equal(oggi.superata, true);
});

test('le spese di altri mesi non entrano nel conto', () => {
  const s = statoGiorno(CONFIG, [spesa('2026-07-31', 900), spesa('2026-09-01', 900)], '2026-08-10');
  assert.equal(s.spesoPrima, 0);
  assert.equal(s.spesoMese, 0);
});

test('mese finito: il tetto e' + "'" + ' zero, non un numero negativo', () => {
  const s = statoGiorno(CONFIG, [spesa('2026-08-01', 5000)], '2026-08-20');
  assert.equal(s.soglia, 0);
  assert.equal(s.restoMese, -4000);
  // Con tetto a zero non ha senso dire "superata": lo dice gia' il resto.
  assert.equal(s.superata, false);
});

test("l'ultimo giorno del mese ha un giorno solo davanti", () => {
  const s = statoGiorno(CONFIG, [], '2026-08-31');
  assert.equal(s.giorniRestanti, 1);
  assert.equal(s.soglia, 1000);
});

test('senza stipendio il budget e' + "'" + ' spento invece che sforato', () => {
  const s = statoGiorno({ stipendio: 0, usciteFisse: [] }, [spesa('2026-08-10', 20)], '2026-08-10');
  assert.equal(s.attiva, false);
  assert.equal(s.superata, false);
});

test('uscite fisse maggiori dello stipendio spengono il budget', () => {
  const s = statoGiorno({ stipendio: 500, usciteFisse: [{ nome: 'Affitto', importo: 700 }] }, [], '2026-08-10');
  assert.equal(s.disponibile, -200);
  assert.equal(s.attiva, false);
});

test('la media giornaliera e' + "'" + ' il ritmo vero, oggi incluso', () => {
  const registro = [spesa('2026-08-01', 30), spesa('2026-08-02', 10), spesa('2026-08-03', 20)];
  assert.equal(mediaGiornaliera(registro, '2026-08-03'), 20);
  assert.equal(mediaGiornaliera(registro, '2026-08-02'), 20);
});

test('un registro che parte a mese iniziato lo dichiara', () => {
  // Il tetto e' inevitabilmente ottimista - quello che hai speso dall' + "'" + ' 1 al 20
  // nessuno lo sa - ma dev' + "'" + ' essere l' + "'" + ' app a dirlo, non tu ad accorgertene.
  const s = statoGiorno(CONFIG, [spesa('2026-08-21', 40)], '2026-08-26');
  assert.equal(s.parziale, true);
  assert.equal(s.daQuando, '2026-08-21');

  const pieno = statoGiorno(CONFIG, [spesa('2026-08-01', 40)], '2026-08-26');
  assert.equal(pieno.parziale, false);
});

test('un registro che viene da mesi precedenti copre il mese', () => {
  const s = statoGiorno(CONFIG, [spesa('2026-07-03', 40), spesa('2026-08-10', 20)], '2026-08-26');
  assert.equal(s.parziale, false);
});

test('registro vuoto: niente da dichiarare', () => {
  assert.equal(statoGiorno(CONFIG, [], '2026-08-26').parziale, false);
});

test('gli ultimi giorni escono in ordine, dal piu' + "'" + ' vecchio', () => {
  const registro = [spesa('2026-08-24', 19), spesa('2026-08-26', 4), spesa('2026-08-26', 6)];
  const settimana = ultimiGiorni(registro, '2026-08-26', 7);
  assert.equal(settimana.length, 7);
  assert.equal(settimana[0].giorno, '2026-08-20');
  assert.equal(settimana[6].giorno, '2026-08-26');
  assert.equal(settimana[6].totale, 10);
  assert.equal(settimana[4].totale, 19);
  assert.equal(settimana[5].totale, 0);
});

test('gli ultimi giorni scavalcano il cambio di mese', () => {
  const settimana = ultimiGiorni([spesa('2026-07-31', 12)], '2026-08-02', 7);
  assert.equal(settimana[6].giorno, '2026-08-02');
  assert.equal(settimana.find((g) => g.giorno === '2026-07-31').totale, 12);
});

test('leggiNumero accetta la virgola, che e' + "'" + ' quello che da' + "'" + ' la tastiera italiana', async () => {
  const { leggiNumero } = await import('../src/ui/comune.js');
  assert.equal(leggiNumero('12,50'), 12.5);
  assert.equal(leggiNumero('1.234,56'), 1234.56);
  assert.equal(leggiNumero('12.50'), 12.5);
  assert.equal(leggiNumero('2000'), 2000);
  assert.equal(leggiNumero('12,50 €'), 12.5);
  assert.equal(leggiNumero(''), 0);
  assert.equal(leggiNumero('   '), 0);
  assert.ok(Number.isNaN(leggiNumero('ciao')));
  assert.ok(Number.isNaN(leggiNumero('-5')));
});
