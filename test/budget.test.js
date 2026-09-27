import test from 'node:test';
import assert from 'node:assert/strict';

import {
  statoGiorno, giorniDelMese, disponibileDelMese, totaleUsciteFisse, mediaGiornaliera, ultimiGiorni,
  strisciaSettimana, risparmioDeiMesi, saldoStimato, andamentoDelMese, ripartizioneMese, budgetCategorie,
} from '../src/domain/budget.js';

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

test('ogni giorno della settimana porta il tetto che aveva lui', () => {
  // Duecento euro il 24, quando il tetto era 125: il giorno dopo il tetto e'
  // sceso da solo. Sono queste sette cifre diverse a far vedere il recupero -
  // un tetto solo, quello di oggi, ripetuto sette volte non lo direbbe.
  const registro = [spesa('2026-08-24', 200)];
  const settimana = strisciaSettimana(CONFIG, registro, '2026-08-26');
  const del = (g) => settimana.find((x) => x.giorno === g);

  assert.equal(settimana.length, 7);
  assert.equal(del('2026-08-24').soglia, 125);
  assert.equal(del('2026-08-24').totale, 200);
  assert.equal(del('2026-08-24').residuo, -75);
  assert.equal(del('2026-08-24').oltre, true);

  assert.equal(del('2026-08-25').soglia, 114.29);
  assert.equal(del('2026-08-25').oltre, false);
  assert.ok(new Set(settimana.map((g) => g.soglia)).size > 1);
});

test('senza budget la settimana non ha tetti e non ha sforamenti', () => {
  const settimana = strisciaSettimana({}, [spesa('2026-08-26', 40)], '2026-08-26');
  assert.equal(settimana[6].soglia, 0);
  assert.equal(settimana[6].totale, 40);
  assert.equal(settimana[6].oltre, false);
});

test('il tetto di domani dice quanto costa la spesa di adesso', () => {
  const intatto = statoGiorno(CONFIG, [], '2026-08-30');
  assert.equal(intatto.giorniRestanti, 2);
  assert.equal(intatto.soglia, 500);
  // Il numeratore del tetto, cioe' da dove viene quel 500.
  assert.equal(intatto.restoDaOggi, 1000);
  assert.equal(intatto.sogliaDomani, 1000);

  const speso = statoGiorno(CONFIG, [spesa('2026-08-30', 300)], '2026-08-30');
  assert.equal(speso.sogliaDomani, 700);

  // L'ultimo giorno del mese un domani non ce l'ha: meglio niente che un numero
  // inventato.
  assert.equal(statoGiorno(CONFIG, [], '2026-08-31').sogliaDomani, null);
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

// --- il saldo -------------------------------------------------------------

const CON_SALDO = { ...CONFIG, saldo: { importo: 2629.23, al: '2026-08-27' } };
const entrata = (giorno, amount) => ({ ...spesa(giorno, amount), entrata: true });

test('senza un saldo salvato non si stima niente', () => {
  assert.equal(saldoStimato(CONFIG, [], '2026-08-30'), null);
  assert.equal(saldoStimato({ saldo: { importo: 100 } }, [], '2026-08-30'), null, 'un saldo senza data non vale');
});

test('senza movimenti dopo quella data il saldo e' + "'" + ' ancora quello', () => {
  const s = saldoStimato(CON_SALDO, [spesa('2026-08-20', 50)], '2026-08-28');
  assert.equal(s.stimato, 2629.23);
  assert.equal(s.movimentiDopo, 0);
  assert.equal(s.giorni, 1);
});

test('le spese viste dopo il saldo lo abbassano, gli accrediti lo alzano', () => {
  const registro = [
    spesa('2026-08-20', 50),   // gia' dentro il saldo della banca
    spesa('2026-08-28', 30),
    spesa('2026-08-29', 12.5),
    entrata('2026-08-29', 100),
  ];
  const s = saldoStimato(CON_SALDO, registro, '2026-08-30');
  assert.equal(s.movimentiDopo, 3);
  assert.equal(s.stimato, 2686.73);
  assert.equal(s.dichiarato, 2629.23, 'il dato della banca resta separato dalla stima');
});

test('anche le uscite fisse escono dal conto', () => {
  // Al tetto giornaliero il mutuo non interessa; al saldo si', ed e' l'unico
  // posto dell'app in cui la distinzione non si applica.
  const mutuo = { ...spesa('2026-08-28', 630), fissa: true };
  assert.equal(saldoStimato(CON_SALDO, [mutuo], '2026-08-29').stimato, 1999.23);
});

test('del giorno del saldo contano solo le spese che la banca non aveva', () => {
  const registro = [
    // dall'estratto conto: e' gia' dentro il saldo che l'estratto conto dichiara
    { ...spesa('2026-08-27', 63.03), source: 'banca' },
    // vista dalla notifica, dopo aver scaricato il file
    { ...spesa('2026-08-27', 3.5), source: 'notifica' },
  ];
  const s = saldoStimato(CON_SALDO, registro, '2026-08-27');
  assert.equal(s.movimentiDopo, 1);
  assert.equal(s.stimato, 2625.73);
});

test('un saldo negativo resta negativo', () => {
  const rosso = { ...CONFIG, saldo: { importo: -120.4, al: '2026-08-27' } };
  assert.equal(saldoStimato(rosso, [], '2026-08-27').stimato, -120.4);
});

// --- andamento del mese, ripartizione, limiti per categoria ---------------

const vero = (giorno, merchant, amount, extra = {}) => ({
  id: `${giorno}-${merchant}-${amount}`, merchant, amount,
  occurredAt: `${giorno}T09:00:00+02:00`, source: 'banca', confidence: 'high', ...extra,
});

test('l' + "'" + 'andamento sale a somme crescenti, oggi compreso', () => {
  const a = andamentoDelMese(CONFIG, [
    vero('2026-09-01', 'A', 10), vero('2026-09-03', 'B', 5), vero('2026-09-04', 'C', 99),
  ], '2026-09-03');
  assert.deepEqual(a.questo, [10, 10, 15]);
  assert.equal(a.giorni, 30);
  assert.equal(a.ritmo, 100); // 1000 disponibili, 3 giorni su 30
});

test('il mese scorso si confronta allo stesso giorno, solo se e' + "'" + ' intero', () => {
  const agosto = [vero('2026-07-31', 'prima', 1), vero('2026-08-02', 'A', 30), vero('2026-08-20', 'B', 200)];
  const a = andamentoDelMese(CONFIG, [...agosto, vero('2026-09-01', 'C', 20)], '2026-09-03');
  assert.equal(a.precedenteCompleto, true);
  assert.equal(a.precedente.length, 31);
  assert.deepEqual(a.confronto, { questo: 20, scorso: 30, differenza: -10 });

  const mezzo = andamentoDelMese(CONFIG, [vero('2026-08-15', 'A', 30), vero('2026-09-01', 'C', 20)], '2026-09-03');
  assert.equal(mezzo.precedenteCompleto, false);
  assert.equal(mezzo.confronto, null);
});

test('il 31 si confronta con l' + "'" + 'ultimo giorno di un mese piu' + "'" + ' corto', () => {
  const r = [vero('2026-08-31', 'X', 1), vero('2026-09-30', 'A', 40), vero('2026-10-31', 'B', 5)];
  const a = andamentoDelMese(CONFIG, r, '2026-10-31');
  assert.equal(a.confronto.scorso, 40);
});

test('senza budget non c' + "'" + 'e' + "'" + ' un ritmo da disegnare', () => {
  assert.equal(andamentoDelMese({}, [], '2026-09-03').ritmo, null);
});

test('la ripartizione somma allo stipendio finche' + "'" + ' il mese regge', () => {
  const r = ripartizioneMese({ ...CONFIG, risparmio: 200 }, [vero('2026-09-02', 'A', 100)], '2026-09-03');
  assert.deepEqual(r.voci.map((v) => [v.chiave, v.importo]), [
    ['fisse', 1000], ['risparmio', 200], ['speso', 100], ['resta', 700],
  ]);
  assert.equal(r.totale, 2000);
  assert.equal(r.oltre, 0);
});

test('lo sfondamento si mangia prima il risparmio, poi va oltre lo stipendio', () => {
  const config = { ...CONFIG, risparmio: 200 };
  const poco = ripartizioneMese(config, [vero('2026-09-02', 'A', 900)], '2026-09-03');
  assert.deepEqual(poco.voci.map((v) => v.importo), [1000, 100, 900, 0]);
  assert.equal(poco.eroso, 100);
  assert.equal(poco.oltre, 0);

  const tanto = ripartizioneMese(config, [vero('2026-09-02', 'A', 1300)], '2026-09-03');
  assert.deepEqual(tanto.voci.map((v) => v.importo), [1000, 0, 1300, 0]);
  assert.equal(tanto.eroso, 200);
  assert.equal(tanto.oltre, 300);
});

test('un limite di categoria dice quanto resta e quanto al giorno', () => {
  const config = { ...CONFIG, categorie: { bar: 'Bar' }, limiti: { Bar: 60 } };
  const b = budgetCategorie(config, [vero('2026-09-01', 'Bar', 12), vero('2026-09-02', 'BAR', 8)], '2026-09', '2026-09-11');
  assert.equal(b.righe.length, 1);
  const bar = b.righe[0];
  assert.equal(bar.speso, 20);
  assert.equal(bar.resto, 40);
  assert.equal(bar.alGiorno, 2); // 40 euro su 20 giorni, oggi compreso
  assert.equal(bar.stato, 'sereno');
  assert.equal(b.assegnato, 60);
  assert.equal(b.daAssegnare, 940);
});

test('spendere piu' + "'" + ' in fretta dei giorni e' + "'" + ' attento, oltre il limite e' + "'" + ' oltre', () => {
  const config = { ...CONFIG, categorie: { bar: 'Bar' }, limiti: { Bar: 100 } };
  // Al 3 del mese e' passato un decimo: la meta' del limite e' troppo presto.
  assert.equal(budgetCategorie(config, [vero('2026-09-01', 'Bar', 50)], '2026-09', '2026-09-03').righe[0].stato, 'attento');
  assert.equal(budgetCategorie(config, [vero('2026-09-01', 'Bar', 120)], '2026-09', '2026-09-03').righe[0].stato, 'oltre');
});

test('un mese chiuso non ha un al giorno, e le categorie senza limite restano visibili', () => {
  const config = { ...CONFIG, categorie: { bar: 'Bar', famila: 'Spesa' }, limiti: { Bar: 60, Vuota: 0 } };
  const b = budgetCategorie(config, [vero('2026-08-01', 'Bar', 12), vero('2026-08-02', 'FAMILA', 80), vero('2026-08-03', 'Edicola', 2)], '2026-08', '2026-09-11');
  assert.equal(b.righe[0].alGiorno, null);
  assert.deepEqual(b.senzaLimite, [{ categoria: 'Spesa', speso: 80, quante: 1 }]);
  assert.equal(b.senzaCategoria.totale, 2);
});

test('i limiti non toccano il tetto giornaliero', () => {
  const r = [vero('2026-09-01', 'Bar', 90)];
  const senza = statoGiorno({ ...CONFIG, categorie: { bar: 'Bar' } }, r, '2026-09-02');
  const con = statoGiorno({ ...CONFIG, categorie: { bar: 'Bar' }, limiti: { Bar: 30 } }, r, '2026-09-02');
  assert.equal(con.soglia, senza.soglia);
});

test('un piano corto non e' + "'" + ' risparmio preso dalle spese', () => {
  const r = ripartizioneMese({ stipendio: 1000, usciteFisse: [{ importo: 800 }], risparmio: 300 }, [], '2026-09-10');
  assert.equal(r.eroso, 0);
  assert.equal(r.pianoCorto, 100);
  assert.deepEqual(r.voci.map((v) => v.importo), [800, 200, 0, 0]);
});
