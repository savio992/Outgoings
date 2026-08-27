import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAppList } from '../src/domain/parser.js';
import { merge } from '../src/domain/registro.js';

// L'altra schermata dell'app: non "ultime spese" ma "movimenti", il conto per
// intero. Ogni voce vale il doppio delle righe e non dice la citta', ma in
// cambio da' l'ora esatta, il segno e il tipo d'operazione.
const GIOVEDI = new Date('2026-08-27T18:00:00+02:00');

// Lo screenshot vero, riga per riga come lo restituisce Live Text.
const SCHERMATA = [
  'PAGAMENTO POS',
  '27 ago 2026',
  'WWW.AMAZON.IT',
  '-14,27 €',
  '27/08/2026 16:36',
  '● Non contabilizzato',
  'BONIFICO SEPA ISTANTANEO',
  '27 ago 2026',
  'TRN BCITITMMXXX',
  '+7,50 €',
  '030692333852510848…',
].join('\n');

test('la schermata dei movimenti: due voci, col segno giusto', () => {
  const t = parseAppList(SCHERMATA, GIOVEDI);
  assert.equal(t.length, 2);
  assert.deepEqual(t.map((x) => [x.merchant, x.amount, x.entrata]), [
    ['WWW.AMAZON.IT', 14.27, false],
    ['BONIFICO SEPA ISTANTANEO', 7.5, true],
  ]);
  assert.ok(t.every((x) => x.source === 'app'));
});

test('l' + "'" + ' importo resta positivo: il verso e' + "'" + ' un fatto della transazione', () => {
  // Un importo negativo nel registro si sommerebbe con gli altri e il totale
  // del giorno smetterebbe di essere un totale.
  assert.ok(parseAppList(SCHERMATA, GIOVEDI).every((x) => x.amount > 0));
});

test('qui l' + "'" + ' ora c' + "'" + ' e' + "'" + ' davvero, e non e' + "'" + ' una finestra', () => {
  // E' l'unica cosa che i movimenti danno e le ultime spese no: sotto il nome
  // c'e' la data con il minuto dell'acquisto.
  const [pos] = parseAppList(SCHERMATA, GIOVEDI);
  assert.equal(pos.occurredAt, '2026-08-27T16:36:00+02:00');
  assert.equal(pos.timeKnown, true);
  assert.equal(pos.confidence, 'high');
});

test('senza l' + "'" + ' ora resta la data, a mezzanotte e in revisione', () => {
  const [, bonifico] = parseAppList(SCHERMATA, GIOVEDI);
  assert.equal(bonifico.occurredAt, '2026-08-27T00:00:00+02:00');
  assert.equal(bonifico.timeKnown, false);
});

test('il TRN non diventa il nome di chi ha mandato i soldi', () => {
  // Un bonifico ricevuto porta il codice di tracciamento al posto del mittente.
  // Scriverlo nel registro riempirebbe l'elenco di righe che si chiamano
  // "TRN BCITITMMXXX"; buttare la voce perderebbe dei soldi in silenzio. Resta
  // il tipo d'operazione, che la banca ha scritto davvero, con il pallino.
  const [, bonifico] = parseAppList(SCHERMATA, GIOVEDI);
  assert.equal(bonifico.merchant, 'BONIFICO SEPA ISTANTANEO');
  assert.equal(bonifico.confidence, 'low');
});

test('il numero d' + "'" + ' operazione non passa per un importo da miliardi', () => {
  // Venti cifre senza virgola e senza segno: parseImporto le leggerebbe, e
  // arrivando prima dell'importo vero ne prenderebbero il posto.
  const t = parseAppList([
    'BONIFICO SEPA ISTANTANEO',
    'TRN BCITITMMXXX',
    '030692333852510848',
    '27 ago 2026',
    '+7,50 €',
  ].join('\n'), GIOVEDI);
  assert.equal(t.length, 1);
  assert.equal(t[0].amount, 7.5);
});

test('la data per esteso non si spezza sull' + "'" + ' anno', () => {
  // "27 ago 2026" tagliato dopo "ago" diventa una data senza anno e un "2026"
  // che passa per duemila euro.
  const t = parseAppList(SCHERMATA, GIOVEDI);
  assert.ok(t.every((x) => x.occurredAt.startsWith('2026-08-27')));
  assert.ok(!t.some((x) => x.amount === 2026));
});

test('le colonne unite dall' + "'" + ' OCR si leggono come quelle separate', () => {
  // Sullo schermo sono due colonne: a sinistra tipo e nome, a destra data e
  // importo. Che l'OCR le stacchi o no non lo decide nessuno.
  const unite = parseAppList([
    'PAGAMENTO POS    27 ago 2026',
    'WWW.AMAZON.IT    -14,27 €',
    '27/08/2026 16:36',
    '● Non contabilizzato',
    'BONIFICO SEPA ISTANTANEO   27 ago 2026',
    'TRN BCITITMMXXX   +7,50 €',
    '030692333852510848…',
  ].join('\n'), GIOVEDI);
  const separate = parseAppList(SCHERMATA, GIOVEDI);
  assert.deepEqual(
    unite.map((x) => [x.merchant, x.amount, x.entrata, x.occurredAt]),
    separate.map((x) => [x.merchant, x.amount, x.entrata, x.occurredAt]),
  );
});

test('lo stato del movimento non diventa un esercente', () => {
  // "● Non contabilizzato" dice una cosa vera - la banca non l'ha ancora
  // contabilizzato, cioe' il caso per cui questa app esiste - ma non e' un
  // negozio.
  const t = parseAppList(SCHERMATA, GIOVEDI);
  assert.ok(!t.some((x) => /contabilizzat/i.test(x.merchant)));
});

test('uscita fissa per forma dell' + "'" + ' operazione, come nell' + "'" + ' estratto conto', () => {
  const righe = (tipo, nome) => [tipo, nome, '26/08/2026 09:00', '26 ago 2026', '-61,20 €'].join('\n');
  const legge = (tipo, nome) => parseAppList(righe(tipo, nome), GIOVEDI)[0];

  // Un mandato che si ripete da solo: non consuma il tetto del giorno.
  assert.equal(legge('ADDEBITO DIRETTO SDD', 'ENEL ENERGIA').fissa, true);
  // Un bonifico e' una decisione: puo' essere l'affitto come i pannolini.
  assert.equal(legge('BONIFICO SEPA', 'ANNA BIANCHI').fissa, false);
  // Una carta e' sempre una spesa discrezionale.
  assert.equal(legge('PAGAMENTO POS', 'IPERCOOP').fissa, false);
  assert.equal(legge('PAGAMENTO POS', 'IPERCOOP').merchant, 'IPERCOOP');
});

test('un tipo d' + "'" + ' operazione che non conosciamo non porta via la spesa', () => {
  // Il tipo sta sopra il nome: se non lo riconosciamo resta un nome, apre una
  // voce che nessun importo completera' e sparisce. Si perde l'intestazione,
  // non l'acquisto.
  const t = parseAppList([
    'OPERAZIONE STRANA XY',
    'WWW.AMAZON.IT',
    '27/08/2026 16:36',
    '27 ago 2026',
    '-14,27 €',
  ].join('\n'), GIOVEDI);
  assert.equal(t.length, 1);
  assert.equal(t[0].merchant, 'WWW.AMAZON.IT');
  assert.equal(t[0].amount, 14.27);
  assert.equal(t[0].timeKnown, true);
});

test('due date che non dicono la stessa cosa mandano la voce in revisione', () => {
  const t = parseAppList([
    'PAGAMENTO POS', 'WWW.AMAZON.IT', '27/08/2026 16:36', '26 ago 2026', '-14,27 €',
  ].join('\n'), GIOVEDI);
  assert.equal(t.length, 1);
  assert.equal(t[0].confidence, 'low');
});

test('reimportare la stessa schermata non aggiunge niente', () => {
  const prima = merge([], parseAppList(SCHERMATA, GIOVEDI));
  assert.equal(prima.aggiunte.length, 2);
  const dopo = merge(prima.registro, parseAppList(SCHERMATA, GIOVEDI));
  assert.equal(dopo.aggiunte.length, 0);
  assert.equal(dopo.duplicate.length, 2);
});

test('la voce con l' + "'" + ' ora non cambia id quando sopra ne arrivano altre', () => {
  // Dove il minuto c'e' distingue gia' lui: numerarla vorrebbe dire cambiarle
  // l'id a ogni acquisto nuovo, e a ogni import tornerebbe a sembrare nuova.
  const sola = parseAppList(SCHERMATA, GIOVEDI)[0];
  const dopo = parseAppList([
    'PAGAMENTO POS', '27 ago 2026', 'CRUCOTTO SNC', '-19,00 €', '27/08/2026 20:11',
    SCHERMATA,
  ].join('\n'), GIOVEDI);
  assert.equal(dopo.find((x) => x.merchant === 'WWW.AMAZON.IT').id, sola.id);
});

test('le ultime spese restano quello che erano: niente segno, niente verso', () => {
  // Nell'altra schermata l'importo non ha segno e il tipo d'operazione non
  // c'e': chiedere il verso a chi non lo scrive vorrebbe dire inventarlo.
  const t = parseAppList(['Gocce Di Caffe', '4,00 €', 'Bari, Puglia', 'Ieri'].join('\n'), GIOVEDI);
  assert.equal(t.length, 1);
  assert.equal(t[0].entrata, undefined);
  assert.equal(t[0].fissa, undefined);
  assert.equal(t[0].city, 'Bari');
});
