import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAppList, parseNotifications, parseStructured } from '../src/domain/parser.js';
import { eEntrata } from '../src/domain/banca.js';
import { eSpesaVariabile } from '../src/domain/registro.js';

// I soldi che entrano. Fino a ieri il parser li leggeva solo per caso, quando
// l'OCR riusciva a vedere il "+" davanti alla cifra; senza quel segno un
// accredito diventava una spesa, e il tetto del giorno se lo mangiava tutto.
//
// L'errore e' del tipo peggiore: non si vede. Un totale piu' alto del vero resta
// un totale plausibile, e chi guarda l'app non ha modo di accorgersene.

const GIOVEDI = new Date('2026-08-27T18:00:00+02:00');
const righe = (...r) => r.join('\n');

test('il tipo d' + "'" + ' operazione dice il verso solo quando lo dice per esteso', () => {
  // E' la regola su cui poggia tutto il resto. La banca scrive lo stesso
  // "BONIFICO SEPA ISTANTANEO" per quello che arriva da Anna e per quello che
  // parte verso Anna: se il tipo bastasse, meta' delle uscite discrezionali del
  // mese diventerebbero entrate.
  assert.equal(eEntrata('ACCREDITO'), true);
  assert.equal(eEntrata('STIPENDIO'), true);
  assert.equal(eEntrata('RIMBORSO'), true);
  assert.equal(eEntrata('BONIFICO RICEVUTO'), true);
  assert.equal(eEntrata('BONIFICO SEPA ISTANTANEO'), false);
  assert.equal(eEntrata('POSTAGIRO'), false);
  assert.equal(eEntrata('PAGAMENTO POS'), false);
});

test('un accredito senza segno resta un accredito', () => {
  // Il "+" e' un segno sottile e l'OCR lo perde volentieri. Il tipo che gli sta
  // sopra dice la stessa cosa a parole, e a parole non si perde.
  const t = parseAppList(righe(
    'ACCREDITO STIPENDIO',
    '27 ago 2026',
    'AZIENDA SPA',
    '1.850,00 €',
  ), GIOVEDI);
  assert.equal(t.length, 1);
  assert.equal(t[0].entrata, true);
  assert.equal(t[0].amount, 1850);
  assert.equal(t[0].confidence, 'high');
});

test('un accredito non e' + "'" + ' mai una spesa del giorno', () => {
  const [accredito] = parseAppList(righe(
    'RIMBORSO', '27 ago 2026', 'TRENITALIA', '39,00 €',
  ), GIOVEDI);
  assert.equal(eSpesaVariabile(accredito), false);
  assert.equal(accredito.fissa, false);
});

test('un bonifico senza segno non si decide: si legge e si controlla', () => {
  // Qui il tipo non dice niente e il segno non c'e'. Dare per scontata l'uscita
  // e' la scelta giusta a valle - una spesa in piu' e' meno grave di una spesa
  // sparita - ma va detto, e si dice con la fiducia.
  const t = parseAppList(righe(
    'BONIFICO SEPA ISTANTANEO',
    '27 ago 2026',
    'ANNA BIANCHI',
    '7,50 €',
  ), GIOVEDI);
  assert.equal(t.length, 1);
  assert.equal(t[0].entrata, false);
  assert.equal(t[0].confidence, 'low');
});

test('quando segno e tipo litigano vince il segno, e la voce va in revisione', () => {
  // Il segno e' quello che la banca ha stampato accanto alla cifra. Se non torna
  // con il tipo, uno dei due l'ha letto male l'OCR: quale non si sa, e allora si
  // guarda a mano.
  const [t] = parseAppList(righe(
    'ACCREDITO', '27 ago 2026', 'AZIENDA SPA', '-1.850,00 €',
  ), GIOVEDI);
  assert.equal(t.entrata, false);
  assert.equal(t.confidence, 'low');
});

test('un rimborso su carta e' + "'" + ' un' + "'" + ' entrata anche sotto un PAGAMENTO POS', () => {
  const [t] = parseAppList(righe(
    'PAGAMENTO POS', '27 ago 2026', 'WWW.AMAZON.IT', '+14,27 €', '27/08/2026 16:36',
  ), GIOVEDI);
  assert.equal(t.entrata, true);
  assert.equal(t.amount, 14.27);
  assert.equal(t.confidence, 'low');
});

test('un accredito non e' + "'" + ' mai un' + "'" + ' uscita fissa', () => {
  // "Fissa" vuol dire che esce da sola tutti i mesi. Uno storno su una
  // domiciliazione porta il nome dell'addebito ma va nell'altro verso.
  const [t] = parseAppList(righe(
    'ADDEBITO DIRETTO SDD', '27 ago 2026', 'ENEL ENERGIA', '+70,00 €',
  ), GIOVEDI);
  assert.equal(t.entrata, true);
  assert.equal(t.fissa, false);
});

test('nelle notifiche il verso e' + "'" + ' una parola, e vale un controllo a mano', () => {
  // Di notifiche di accredito vere non ne abbiamo ancora vista una: la forma
  // qui sotto e' quella che ci aspettiamo, e finche' resta un' + "'" + ' aspettativa la
  // voce esce in revisione.
  const t = parseNotifications(righe(
    'Poste Italiane                    09:12',
    'Bonifico ricevuto da Anna Bianchi',
    '1.234,56 €',
  ), GIOVEDI);
  assert.equal(t.length, 1);
  assert.equal(t[0].entrata, true);
  assert.equal(t[0].amount, 1234.56);
  assert.equal(t[0].confidence, 'low');
});

test('col segno la notifica non ha bisogno di essere interpretata', () => {
  const [t] = parseNotifications(righe(
    'Poste Italiane                    09:12',
    'Anna Bianchi',
    '+1.234,56 €',
  ), GIOVEDI);
  assert.equal(t.entrata, true);
  assert.equal(t.confidence, 'high');
});

test('le notifiche di spesa non guadagnano un campo che non hanno', () => {
  // Assente vuol dire "la card non ne parla", che e' la verita' per tutte le
  // notifiche vere che abbiamo. A valle conta come uscita, com' + "'" + ' e' + "'" + ' giusto.
  const [t] = parseNotifications(righe(
    'Poste Italiane                    08:06',
    'Gocce Di Caffe. Bari, Puglia',
    '4,00 €',
  ), GIOVEDI);
  assert.equal(t.entrata, undefined);
  assert.equal(t.confidence, 'high');
  assert.equal(eSpesaVariabile(t), true);
});

test('l' + "'" + ' ANCS legge il verso dov' + "'" + ' e' + "'" + ' scritto: nel sottotitolo', () => {
  // Il messaggio non serve guardarlo: e' la riga dell'importo, e passa per
  // `parseImporto`, che accetta una cifra e nient'altro.
  const t = parseStructured({
    subtitle: 'Bonifico ricevuto da Anna Bianchi',
    message: '1.234,56 €',
    receivedAt: '2026-08-27T09:12:00+02:00',
  });
  assert.equal(t.entrata, true);
  assert.equal(t.amount, 1234.56);
  assert.equal(t.confidence, 'low');
});

test('l' + "'" + ' ANCS di una spesa resta una spesa', () => {
  const t = parseStructured({
    subtitle: 'Gocce Di Caffe. Bari, Puglia',
    message: '4,00 €',
    receivedAt: '2026-08-27T08:06:00+02:00',
  });
  assert.equal(t.entrata, undefined);
  assert.equal(t.confidence, 'high');
});
