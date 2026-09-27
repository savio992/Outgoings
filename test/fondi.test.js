import test from 'node:test';
import assert from 'node:assert/strict';

import {
  statoFondo, storiaFondo, quoteFondi, nuovoFondo, staccaFondo, pagamentiOrfani, fondoValido,
} from '../src/domain/fondi.js';
import { statoGiorno, ripartizioneMese, risparmioDeiMesi, disponibileDelMese } from '../src/domain/budget.js';
import { eSpesaVariabile, riepilogoMese } from '../src/domain/registro.js';
import { cercaMovimenti } from '../src/domain/ricerca.js';

// L'assicurazione dell'auto: 480 euro a novembre, fondo aperto a settembre.
const AUTO = { id: 'f1', nome: 'Assicurazione auto', importo: 480, ogniMesi: 12, scadenza: '2026-11', inizio: '2026-09' };

const pagamento = (giorno, amount, fondo = 'f1') => ({
  id: `${giorno}-${amount}`, merchant: 'Assicurazioni', amount, fondo,
  occurredAt: `${giorno}T00:00:00+01:00`, source: 'banca', confidence: 'high',
});
const spesa = (giorno, amount) => ({
  id: `${giorno}-${amount}-s`, merchant: 'Bar', amount,
  occurredAt: `${giorno}T00:00:00+02:00`, source: 'app', confidence: 'high',
});

test('aperto a due mesi dalla scadenza, il fondo chiede tre quote e non dodici', () => {
  // 480/12 = 40 al mese vorrebbe dire arrivare a novembre con 120 euro: il
  // conto arriva lo stesso, e i 360 mancanti li pagherebbe il tetto di un giorno.
  const st = storiaFondo(AUTO, [], '2026-11');
  assert.deepEqual(st.mesi.map((m) => m.quota), [160, 160, 160]);
  assert.equal(st.daParte, 480);
  assert.equal(statoFondo(AUTO, [], '2026-11').pronto, true);
});

test('pagato alla scadenza, il fondo riparte con la quota dell' + "'" + 'anno', () => {
  const registro = [pagamento('2026-11-10', 480)];
  const nov = statoFondo(AUTO, registro, '2026-11');
  assert.equal(nov.quota, 160);
  assert.equal(nov.pagatoMese, 480);
  assert.equal(nov.daParte, 0);
  assert.equal(nov.scadenza, '2027-11');
  assert.equal(statoFondo(AUTO, registro, '2026-12').quota, 40);
});

test('pagato in anticipo, il mese della scadenza non chiede di riempirlo di nuovo', () => {
  // Il pagamento di ottobre salda la scadenza di novembre: a novembre non c'e'
  // niente da rimettere per quella, e il buco dell'anticipo si spalma sui
  // tredici mesi fino alla prossima.
  const registro = [pagamento('2026-10-20', 480)];
  const nov = statoFondo(AUTO, registro, '2026-11');
  assert.equal(nov.scadenza, '2027-11');
  assert.equal(nov.quota, 49.23);
  assert.ok(nov.quota < 160);
});

test('pagato in ritardo, la scadenza resta aperta e non si prende quella dopo', () => {
  const senza = statoFondo(AUTO, [], '2026-12');
  assert.equal(senza.scaduta, true);
  assert.equal(senza.scadenza, '2026-11');
  // Il fondo e' pieno: finche' la spesa non arriva non chiede altro.
  assert.equal(senza.quota, 0);

  const registro = [pagamento('2026-12-03', 480)];
  const dic = statoFondo(AUTO, registro, '2026-12');
  assert.equal(dic.scaduta, false);
  assert.equal(dic.scadenza, '2027-11');
  // Gennaio divide per gli undici mesi che restano fino a novembre.
  assert.equal(statoFondo(AUTO, registro, '2027-01').quota, 43.64);
});

test('pagato a pezzi, ogni pezzo salda una parte e l' + "'" + 'anno fa sempre l' + "'" + 'importo', () => {
  const REGALI = { id: 'f2', nome: 'Regali', importo: 300, ogniMesi: 12, scadenza: '2026-12', inizio: '2026-09' };
  const registro = [
    pagamento('2026-10-05', 30, 'f2'), // un compleanno
    pagamento('2026-12-15', 300, 'f2'), // Natale, un po' oltre
  ];
  const st = storiaFondo(REGALI, registro, '2027-01');
  assert.deepEqual(st.mesi.map((m) => m.quota), [75, 75, 75, 75, 25]);
  // I trenta di troppo a Natale li rimette l'anno dopo, un poco al mese.
  const gen = statoFondo(REGALI, registro, '2027-01');
  assert.equal(gen.scadenza, '2027-12');
  assert.equal(gen.serve, 270);
});

test('un pagamento piu' + "'" + ' caro del previsto lascia il fondo sotto, e i mesi dopo lo recuperano', () => {
  const registro = [pagamento('2026-11-10', 510)];
  const nov = statoFondo(AUTO, registro, '2026-11');
  assert.equal(nov.daParte, -30);
  // 30 euro in piu' gia' spesi della prossima: servono 450 in 12 mesi, e i
  // -30 da recuperare fanno di nuovo 40 al mese. Il conto torna.
  assert.equal(statoFondo(AUTO, registro, '2026-12').quota, 40);
});

test('quello che c' + "'" + 'e' + "'" + ' gia' + "'" + ' da parte abbassa la quota', () => {
  const st = storiaFondo({ ...AUTO, giaDaParte: 200 }, [], '2026-09');
  assert.equal(st.mesi[0].quota, 93.33);
});

test('prima di nascere un fondo non chiede niente', () => {
  assert.equal(statoFondo(AUTO, [], '2026-08').quota, 0);
  assert.equal(quoteFondi({ fondi: [AUTO] }, [], '2026-08'), 0);
});

test('un fondo scritto a meta' + "'" + ' non toglie niente al tetto', () => {
  assert.equal(fondoValido({ ...AUTO, importo: 0 }), false);
  assert.equal(fondoValido({ ...AUTO, scadenza: '' }), false);
  assert.equal(quoteFondi({ fondi: [{ ...AUTO, importo: 0 }] }, [], '2026-09'), 0);
});

test('le quote escono dal disponibile prima del tetto', () => {
  const config = { stipendio: 2000, usciteFisse: [{ nome: 'Affitto', importo: 1000 }], fondi: [AUTO] };
  assert.equal(disponibileDelMese(config, [], '2026-09'), 840);
  // Senza mese non c'e' quota da togliere: vale come prima dei fondi.
  assert.equal(disponibileDelMese(config), 1000);
  const s = statoGiorno(config, [], '2026-09-01');
  assert.equal(s.fondi, 160);
  assert.equal(s.soglia, 28);
});

test('la spesa pagata dal fondo non tocca il tetto del giorno in cui arriva', () => {
  const config = { stipendio: 2000, usciteFisse: [{ nome: 'Affitto', importo: 1000 }], fondi: [AUTO] };
  const registro = [pagamento('2026-11-10', 480), spesa('2026-11-10', 12)];
  const s = statoGiorno(config, registro, '2026-11-10');
  assert.equal(s.spesoOggi, 12);
  assert.equal(eSpesaVariabile(registro[0]), false);
  // E la quota di novembre resta quella di inizio mese: pagare a meta' mese
  // non sposta il tetto dei giorni gia' passati.
  assert.equal(s.fondi, 160);
});

test('il piano del mese ha la sua voce, e il piano corto conta anche i fondi', () => {
  const config = { stipendio: 1200, usciteFisse: [{ nome: 'Affitto', importo: 1000 }], risparmio: 100, fondi: [AUTO] };
  const r = ripartizioneMese(config, [], '2026-09-10');
  const fondi = r.voci.find((v) => v.chiave === 'fondi');
  // Dopo fisse e risparmio restano 100: la barra non disegna 160.
  assert.equal(fondi.importo, 100);
  assert.equal(r.pianoCorto, 60);
  assert.equal(ripartizioneMese({ ...config, fondi: [] }, [], '2026-09-10').voci.some((v) => v.chiave === 'fondi'), false);
});

test('il risparmio dei mesi usa le quote di ogni mese', () => {
  const config = { stipendio: 2000, usciteFisse: [{ nome: 'Affitto', importo: 1000 }], fondi: [AUTO] };
  const registro = [spesa('2026-09-01', 800), spesa('2026-10-01', 800), spesa('2026-12-01', 800)];
  const { mesi } = risparmioDeiMesi(config, registro, '2026-12-15');
  assert.equal(mesi.find((m) => m.mese === '2026-09').messoDaParte, 40);
  // Dicembre, senza pagamento segnato: scadenza passata e fondo pieno, quota zero.
  assert.equal(mesi.find((m) => m.mese === '2026-12').messoDaParte, 200);
});

test('il riepilogo e la ricerca non perdono le spese pagate da un fondo', () => {
  const registro = [pagamento('2026-11-10', 480), spesa('2026-11-10', 12)];
  assert.equal(riepilogoMese(registro, '2026-11').nonMensili, 480);
  assert.equal(riepilogoMese(registro, '2026-11').spese, 12);
  assert.equal(cercaMovimenti(registro, { filtro: 'nonMensili' }).length, 1);
  assert.equal(cercaMovimenti(registro, { filtro: 'spese' }).length, 1);
});

test('un fondo nuovo prende un id che nessuna spesa porta ancora', () => {
  const f = nuovoFondo({ fondi: [{ id: 'f1' }] }, [{ fondo: 'f3' }],
    { nome: ' Bollo ', importo: '180', ogniMesi: 12, scadenza: '2027-03' }, '2026-09-27');
  assert.equal(f.id, 'f4');
  assert.equal(f.nome, 'Bollo');
  assert.equal(f.importo, 180);
  assert.equal(f.inizio, '2026-09');
  assert.equal(nuovoFondo({}, [], { nome: 'X', importo: 1, scadenza: '2027-01' }, '2026-09-27').id, 'f1');
});

test('cancellare un fondo rimette le sue spese nel tetto', () => {
  const registro = [pagamento('2026-11-10', 480), pagamento('2026-11-11', 20, 'f2'), spesa('2026-11-10', 12)];
  const staccato = staccaFondo(registro, 'f1');
  assert.equal(staccato[0].fondo, undefined);
  assert.equal(eSpesaVariabile(staccato[0]), true);
  assert.equal(staccato[1].fondo, 'f2');
  assert.equal(staccato[2], registro[2]);
});

test('le spese segnate su un fondo che non c' + "'" + 'e' + "'" + ' piu' + "'" + ' si trovano', () => {
  const registro = [pagamento('2026-11-10', 480), pagamento('2026-11-11', 20, 'f9')];
  assert.deepEqual(pagamentiOrfani(registro, { fondi: [AUTO] }).map((t) => t.fondo), ['f9']);
  assert.equal(pagamentiOrfani(registro, { fondi: [{ ...AUTO, importo: 0 }] }).length, 2);
});
