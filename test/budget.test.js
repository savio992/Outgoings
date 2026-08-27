import test from 'node:test';
import assert from 'node:assert/strict';

import { statoGiorno, giorniDelMese, disponibileDelMese, totaleUsciteFisse, mediaGiornaliera, ultimiGiorni, risparmioDeiMesi } from '../src/domain/budget.js';

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

// --- il risparmio ---------------------------------------------------------

const CON_RISPARMIO = { ...CONFIG, risparmio: 300 };

test('il risparmio si toglie prima del tetto, non dopo', () => {
  assert.equal(disponibileDelMese(CON_RISPARMIO), 700);
  const s = statoGiorno(CON_RISPARMIO, [], '2026-08-01');
  // 700 su 31 giorni, non 1000: e' tutta la differenza fra risparmiare e
  // sperare che avanzi qualcosa.
  assert.equal(s.soglia, 22.58);
  assert.equal(s.risparmio, 300);
});

test('a mese intatto il messo da parte e' + "'" + ' tutto quello che entra meno le fisse', () => {
  const s = statoGiorno(CON_RISPARMIO, [], '2026-08-01');
  assert.equal(s.messoDaParte, 1000);
});

test('spendendo dentro il tetto l' + "'" + ' obiettivo resta coperto', () => {
  const registro = [spesa('2026-08-01', 20), spesa('2026-08-02', 20)];
  const s = statoGiorno(CON_RISPARMIO, registro, '2026-08-02');
  assert.equal(s.messoDaParte, 960);
  assert.ok(s.messoDaParte >= s.risparmio);
});

test('sforato il disponibile si intacca l' + "'" + ' obiettivo, ma resta qualcosa da parte', () => {
  const s = statoGiorno(CON_RISPARMIO, [spesa('2026-08-01', 900)], '2026-08-01');
  assert.equal(s.restoMese, -200);
  assert.equal(s.messoDaParte, 100);
});

test('oltre lo stipendio il messo da parte e' + "'" + ' negativo, non zero', () => {
  // Non e' un risparmio piccolo: e' il gruzzolo che si sta consumando, e
  // arrotondarlo a zero sarebbe la bugia piu' comoda di tutta l'app.
  const s = statoGiorno(CON_RISPARMIO, [spesa('2026-08-01', 1200)], '2026-08-01');
  assert.equal(s.messoDaParte, -200);
});

test('un obiettivo piu' + "'" + ' grande di quello che resta spegne il tetto e lo dice', () => {
  const s = statoGiorno({ ...CONFIG, risparmio: 1500 }, [], '2026-08-01');
  assert.equal(s.attiva, false);
  assert.equal(s.troppoRisparmio, true);
  // Senza stipendio il caso e' un altro, e la frase da mostrare pure.
  assert.equal(statoGiorno({ stipendio: 0, risparmio: 300 }, [], '2026-08-01').troppoRisparmio, false);
});

test('mese per mese: i mesi coperti a meta' + "'" + ' restano fuori dal totale', () => {
  const registro = [
    // luglio: il registro parte a mese iniziato, quindi non e' un risultato
    spesa('2026-07-20', 100),
    // agosto: chiuso e coperto per intero
    spesa('2026-08-05', 400),
    // settembre: e' il mese in corso
    spesa('2026-09-02', 50),
  ];
  const { mesi, totale } = risparmioDeiMesi(CON_RISPARMIO, registro, '2026-09-10');
  assert.deepEqual(mesi.map((m) => m.mese), ['2026-07', '2026-08', '2026-09']);
  assert.equal(mesi[0].parziale, true);
  assert.equal(mesi[1].contabile, true);
  assert.equal(mesi[2].inCorso, true);
  // 2000 - 1000 di fisse - 400 spesi = 600 messi da parte ad agosto, e basta.
  assert.equal(mesi[1].messoDaParte, 600);
  assert.equal(totale, 600);
});

test('mese per mese: i mesi futuri non esistono ancora', () => {
  const registro = [spesa('2026-08-05', 400), spesa('2026-09-02', 50)];
  const { mesi } = risparmioDeiMesi(CON_RISPARMIO, registro, '2026-08-31');
  assert.deepEqual(mesi.map((m) => m.mese), ['2026-08']);
});

test('senza registro non c' + "'" + 'e' + "'" + ' niente da raccontare', () => {
  assert.deepEqual(risparmioDeiMesi(CON_RISPARMIO, [], '2026-08-31'), { mesi: [], totale: 0 });
});
