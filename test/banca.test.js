import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEstrattoConto, leggiPos, stipendioDaMovimenti } from '../src/domain/banca.js';
import { sostituisciPeriodo, merge, totaleDelGiorno, eSpesaVariabile } from '../src/domain/registro.js';
import { parseAppList } from '../src/domain/parser.js';
import { statoGiorno } from '../src/domain/budget.js';

// L'estratto conto vero, con il preambolo che la banca ci mette davanti.
const ESTRATTO = [
  'Intestato a: ROSSI MARIO\t\t\t\t',
  'Saldo al: 27/08/2026\t\t\t\t',
  'Saldo contabile: +2.648,22 Euro\t\t\t\t',
  'Saldo disponibile: +2.629,23 Euro\t\t\t\t',
  'Data Contabile\tData Valuta\tAddebiti (euro)\tAccrediti (euro)\tDescrizione operazioni',
  '27/08/2026\t25/08/2026\t63,03\t \tPAGAMENTO POS FAMILA MEGAGEST        25/08/2026 18.51 BARI          Op.600000 carta ****0000',
  '27/08/2026\t25/08/2026\t39,32\t \tPAGAMENTO POS PAYPAL *PYPL PAYMTHLY  25/08/2026 00.42 0600000000    Op.600137 carta ****0000',
  '24/08/2026\t24/08/2026\t19,00\t \tPAGAMENTO POS CRUCOTTO SNC           24/08/2026 20.03 BARI          Op.600274 carta ****0000',
  '05/08/2026\t05/08/2026\t700,00\t \tADDEBITO SDD AFFITTO AGOSTO Op.600411',
  '05/08/2026\t05/08/2026\t2,00\t \tCOMMISSIONI E SPESE Op.600548',
  '01/08/2026\t01/08/2026\t \t1.850,00\tBONIFICO STIPENDIO AGOSTO Op.600685',
].join('\n');

test('salta il preambolo e legge i movimenti', () => {
  const { movimenti, saltate, periodo } = parseEstrattoConto(ESTRATTO);
  assert.equal(movimenti.length, 6);
  assert.equal(saltate, 0);
  assert.deepEqual(periodo, { da: '2026-08-01', a: '2026-08-25' });
});

test('la descrizione regala l' + "'" + ' ora esatta, che nessun' + "'" + ' altra sorgente ha', () => {
  const famila = parseEstrattoConto(ESTRATTO).movimenti.find((m) => m.amount === 63.03);
  assert.equal(famila.occurredAt, '2026-08-25T18:51:00+02:00');
  assert.equal(famila.timeKnown, true);
  assert.equal(famila.merchant, 'FAMILA MEGAGEST');
  assert.equal(famila.city, 'BARI');
  assert.equal(famila.operazione, '600000');
});

test('vale la data dell' + "'" + ' acquisto, non quella contabile', () => {
  // Contabilizzata il 27, comprata il 25: in un registro di spese conta il 25,
  // altrimenti la cena di venerdi' finisce nel lunedi' successivo.
  const famila = parseEstrattoConto(ESTRATTO).movimenti.find((m) => m.amount === 63.03);
  assert.equal(famila.occurredAt.slice(0, 10), '2026-08-25');
});

test('POS variabile, tutto il resto fisso, accrediti a parte', () => {
  const per = Object.fromEntries(parseEstrattoConto(ESTRATTO).movimenti
    .map((m) => [m.amount, { fissa: m.fissa, entrata: m.entrata }]));
  assert.deepEqual(per[63.03], { fissa: false, entrata: false }); // POS
  assert.deepEqual(per[39.32], { fissa: false, entrata: false }); // POS PayPal
  assert.deepEqual(per[700], { fissa: true, entrata: false });    // SDD affitto
  assert.deepEqual(per[2], { fissa: true, entrata: false });      // commissioni
  assert.deepEqual(per[1850], { fissa: false, entrata: true });   // stipendio
});

test('senza citta' + "'" + ' vera non se ne inventa una', () => {
  // Per PayPal al posto della citta' c'e' un numero di telefono.
  const paypal = parseEstrattoConto(ESTRATTO).movimenti.find((m) => m.amount === 39.32);
  assert.equal(paypal.city, null);
  // Il gateway viene tolto anche qui, dove sotto resta un codice di PayPal e
  // non un esercente vero: e' il prezzo della regola, e si paga volentieri
  // perche' dall'altra parte c'e' "SumUp *Gocce di caffe" che torna a essere
  // il bar. La descrizione intera resta comunque in rawText.
  assert.equal(paypal.merchant, 'PYPL PAYMTHLY');
});

test('cio' + "'" + ' che non e' + "'" + ' un pagamento con carta non finge di esserlo', () => {
  assert.equal(leggiPos('ADDEBITO SDD AFFITTO AGOSTO Op.600411'), null);
  assert.equal(leggiPos('BONIFICO STIPENDIO AGOSTO Op.600685'), null);
  assert.equal(leggiPos(''), null);
});

test('le uscite fisse non consumano il tetto giornaliero', () => {
  // Senza questo, il giorno dell' + "'" + ' affitto sarebbe una giornata da 700 euro e
  // la media del mese diventerebbe inutile.
  const { movimenti } = parseEstrattoConto(ESTRATTO);
  const { registro } = merge([], movimenti);
  assert.equal(totaleDelGiorno(registro, '2026-08-05'), 0);
  assert.equal(totaleDelGiorno(registro, '2026-08-25'), 102.35);
  assert.equal(registro.filter(eSpesaVariabile).length, 3);
});

test('gli accrediti non abbassano il tetto', () => {
  const { movimenti } = parseEstrattoConto(ESTRATTO);
  const { registro } = merge([], movimenti);
  const s = statoGiorno({ stipendio: 1850, usciteFisse: [{ nome: 'Affitto', importo: 700 }] }, registro, '2026-08-26');
  assert.equal(s.spesoMese, 121.35); // 63,03 + 39,32 + 19,00
});

test('lo stipendio si ricava dall' + "'" + ' accredito piu' + "'" + ' grosso', () => {
  const { movimenti } = parseEstrattoConto(ESTRATTO);
  const s = stipendioDaMovimenti(movimenti);
  assert.equal(s.importo, 1850);
  assert.equal(s.mesi, 1);
});

test('fra accrediti di taglia simile vince chi si ripete', () => {
  // Uno stipendio e un rimborso straordinario possono differire di un fattore
  // due o tre: li' la ricorrenza e' il segnale buono.
  const movimenti = [
    { entrata: true, amount: 1850, merchant: 'BONIFICO STIPENDIO', occurredAt: '2026-07-01T00:00:00+02:00' },
    { entrata: true, amount: 1850, merchant: 'BONIFICO STIPENDIO', occurredAt: '2026-08-01T00:00:00+02:00' },
    { entrata: true, amount: 5000, merchant: 'BONIFICO RIMBORSO AUTO', occurredAt: '2026-08-10T00:00:00+02:00' },
  ];
  assert.equal(stipendioDaMovimenti(movimenti).importo, 1850);
  assert.equal(stipendioDaMovimenti(movimenti).mesi, 2);
});

test('un rimborso da quaranta euro non e' + "'" + ' uno stipendio, per quanto si ripeta', () => {
  // Il caso vero: la restituzione di una cena arrivata due mesi di fila
  // batteva uno stipendio da tremilaseicento comparso una volta sola nel
  // periodo coperto, e il tetto giornaliero finiva a zero.
  const movimenti = [
    { entrata: true, amount: 40, merchant: 'Anna Bianchi', occurredAt: '2026-07-14T00:00:00+02:00' },
    { entrata: true, amount: 30, merchant: 'Anna Bianchi', occurredAt: '2026-08-25T00:00:00+02:00' },
    { entrata: true, amount: 3646.37, merchant: 'STIPENDIO/PENSIONE', occurredAt: '2026-07-31T00:00:00+02:00' },
  ];
  const s = stipendioDaMovimenti(movimenti);
  assert.equal(s.importo, 3646.37);
  assert.equal(s.nome, 'STIPENDIO/PENSIONE');
});

test('due accrediti dello stesso ordine restano entrambi in gara', () => {
  // La soglia separa gli ordini di grandezza, non i candidati veri: a un quarto
  // del massimo, 1850 su 5000 e' dentro e 40 su 3646 e' fuori.
  const uno = stipendioDaMovimenti([
    { entrata: true, amount: 1300, merchant: 'PARTE FISSA', occurredAt: '2026-07-01T00:00:00+02:00' },
    { entrata: true, amount: 1300, merchant: 'PARTE FISSA', occurredAt: '2026-08-01T00:00:00+02:00' },
    { entrata: true, amount: 4000, merchant: 'UNA TANTUM', occurredAt: '2026-08-10T00:00:00+02:00' },
  ]);
  assert.equal(uno.nome, 'PARTE FISSA');
});

test('la banca riscrive il periodo che copre, e solo quello', () => {
  // Nel registro ci sono le letture da screenshot, che la banca chiama in un
  // altro modo e che quindi non si riconoscerebbero mai da sole.
  const SERA = new Date('2026-08-27T07:42:00+02:00');
  const daScreenshot = parseAppList([
    "Famila Bistro'", 'Bari, Puglia', 'Martedi', '63,03 €',
    'Crucotto Snc', 'Bari, Puglia', 'Lunedì', '19,00 €',
    'Gocce Di Caffe', 'Bari, Puglia', 'Adesso', '4,00 €',
  ].join('\n'), SERA);
  const prima = merge([], daScreenshot).registro;
  assert.equal(prima.length, 3);

  const { movimenti, periodo } = parseEstrattoConto(ESTRATTO);
  const dopo = sostituisciPeriodo(prima, movimenti, periodo.da, periodo.a);

  // Le due letture del 25 e del 24 sono sostituite, quella di oggi resta:
  // la banca non l'ha ancora contabilizzata, ed e' giusto che sopravviva.
  assert.equal(dopo.rimosse.length, 2);
  assert.equal(dopo.registro.length, 7);
  assert.ok(dopo.registro.some((t) => t.merchant === 'Gocce Di Caffe'));
  assert.ok(!dopo.registro.some((t) => t.merchant === "Famila Bistro'"));
  assert.ok(dopo.registro.some((t) => t.merchant === 'FAMILA MEGAGEST'));
});

test('reimportare lo stesso estratto conto non duplica niente', () => {
  const { movimenti, periodo } = parseEstrattoConto(ESTRATTO);
  const uno = sostituisciPeriodo([], movimenti, periodo.da, periodo.a);
  const due = sostituisciPeriodo(uno.registro, movimenti, periodo.da, periodo.a);
  assert.equal(due.registro.length, uno.registro.length);
});

test('il CSV col punto e virgola si legge come il tab', () => {
  const csv = ESTRATTO.split('\n').map((r) => r.split('\t').join(';')).join('\n');
  assert.equal(parseEstrattoConto(csv).movimenti.length, 6);
});

test('un testo che non e' + "'" + ' un estratto conto non produce movimenti', () => {
  for (const t of ['', 'Gocce Di Caffe\nBari, Puglia\n4,00 €', 'ciao']) {
    assert.deepEqual(parseEstrattoConto(t).movimenti, []);
  }
});

test('i prefissi tecnici della banca non rubano spazio al nome', () => {
  const testo = [
    'Data Contabile\tData Valuta\tAddebiti (euro)\tAccrediti (euro)\tDescrizione operazioni',
    '06/08/2026\t05/08/2026\t700,00\t \tADDEBITO SDD AFFITTO AGOSTO Op.600411',
    '03/08/2026\t01/08/2026\t \t1.850,00\tBONIFICO STIPENDIO AGOSTO Op.600685',
    '06/08/2026\t05/08/2026\t2,00\t \tCOMMISSIONI E SPESE Op.600548',
    '06/08/2026\t05/08/2026\t9,00\t \tBONIFICO Op.600822',
  ].join('\n');
  const nomi = parseEstrattoConto(testo).movimenti.map((m) => m.merchant);
  assert.ok(nomi.includes('AFFITTO AGOSTO'));
  assert.ok(nomi.includes('STIPENDIO AGOSTO'));
  // Senza prefisso da togliere il nome resta intero...
  assert.ok(nomi.includes('COMMISSIONI E SPESE'));
  // ...e togliendolo non deve restare una riga vuota.
  assert.ok(nomi.includes('BONIFICO'));
});

// Righe vere dell'estratto conto, con le forme che il campione inventato non
// aveva: gateway di pagamento, bonifici a persone, domiciliazioni.
const VERE = [
  'Data Contabile\tData Valuta\tAddebiti (euro)\tAccrediti (euro)\tDescrizione operazioni',
  '27/08/2026\t25/08/2026\t63,03\t \tPAGAMENTO POS FAMILA MEGAGEST        25/08/2026 18.51 BARI          Op.600000 carta ****0000',
  '27/08/2026\t25/08/2026\t3,50\t \tPAGAMENTO POS SumUp  *Gocce di caffe 25/08/2026 08.32 Bari palese   Op.600959 carta ****0000',
  '26/08/2026\t24/08/2026\t8,00\t \tPAGAMENTO POS SumUp  *Gocce di caffe 24/08/2026 08.20 Bari palese   Op.601096 carta ****0000',
  '26/08/2026\t23/08/2026\t0,99\t \tPAGAMENTO POS PAYPAL *ITUNESAPPST AP 23/08/2026 14.33 30000000000   Op.601233 carta ****0000',
  '26/08/2026\t22/08/2026\t18,50\t \tPAGAMENTO POS PAYPAL *ALIPAY EUR     22/08/2026 16.03 10000000000   Op.601370 carta ****0000',
  '26/08/2026\t26/08/2026\t20,00\t \tBONIFICO SEPA ISTANTANEO TRN CCTX00000000000000 BENEF. Anna Bianchi PER pannolini',
  '25/08/2026\t25/08/2026\t \t30,00\tBONIFICO SEPA ISTANTANEO TRN BANKITXXXXX 0300000000000000000000000000IT DA BIANCHI ANNA PER Spesa',
  '25/08/2026\t25/08/2026\t170,61\t \tDOMICILIAZIONE (ADDEBITO DIRETTO SEPA) ENEL ENERGIA   CID IT7100200000066550710 07   MAN 2G107111854275',
].join('\n');

test('il gateway di pagamento non ruba il nome all' + "'" + ' esercente', () => {
  // "SumUp  *Gocce di caffe" e' il bar delle notifiche. Senza togliere il
  // gateway lo stesso posto compare con due nomi a seconda del terminale.
  const nomi = parseEstrattoConto(VERE).movimenti.map((m) => m.merchant);
  assert.ok(nomi.includes('Gocce di caffe'), nomi.join(' | '));
  assert.equal(nomi.filter((n) => n === 'Gocce di caffe').length, 2);
  assert.ok(nomi.includes('ITUNESAPPST AP'));
  assert.ok(nomi.includes('ALIPAY EUR'));
});

test('due letture dello stesso bar restano lo stesso esercente', () => {
  const gocce = parseEstrattoConto(VERE).movimenti.filter((m) => m.merchant === 'Gocce di caffe');
  assert.deepEqual(gocce.map((m) => m.amount).sort(), [3.5, 8]);
  assert.deepEqual(gocce.map((m) => m.city), ['Bari palese', 'Bari palese']);
});

test('un bonifico e' + "'" + ' spesa variabile, una domiciliazione no', () => {
  // Il bonifico per i pannolini e' una spesa discrezionale e deve pesare sul
  // tetto del giorno; la bolletta dell'Enel e' un mandato che si ripete da
  // solo, e contarla nella media renderebbe il tetto inutile.
  const per = Object.fromEntries(parseEstrattoConto(VERE).movimenti.map((m) => [m.amount, m]));
  assert.equal(per[20].fissa, false, 'il bonifico per i pannolini e’ una spesa');
  assert.equal(per[20].entrata, false);
  assert.equal(per[170.61].fissa, true, 'la domiciliazione Enel e’ un’uscita fissa');
  assert.equal(per[30].entrata, true, 'il bonifico ricevuto e’ un accredito');
});

test('le righe senza numero d' + "'" + ' operazione restano distinte', () => {
  // I bonifici non hanno "Op.": l'identita' torna a nascere dai campi.
  const { movimenti } = parseEstrattoConto(VERE);
  assert.equal(new Set(movimenti.map((m) => m.id)).size, movimenti.length);
});

test('l' + "'" + ' orario esatto arriva anche dalle righe vere', () => {
  const { movimenti } = parseEstrattoConto(VERE);
  const famila = movimenti.find((m) => m.amount === 63.03);
  assert.equal(famila.occurredAt, '2026-08-25T18:51:00+02:00');
  const caffe = movimenti.find((m) => m.amount === 3.5);
  assert.equal(caffe.occurredAt, '2026-08-25T08:32:00+02:00');
});

// Le forme dei movimenti che non sono pagamenti con carta. Sono ricalcate su
// un estratto conto vero ma con nomi e codici inventati: il repository e'
// pubblico, e i beneficiari veri di qualcuno non ci vanno.
const FUORI_POS = [
  'Data Contabile\tData Valuta\tAddebiti (euro)\tAccrediti (euro)\tDescrizione operazioni',
  '20/08/2026\t20/08/2026\t18,00\t \tBONIFICO SEPA ISTANTANEO TRN BANKITXXXXX 0300000000000000000000000000IT DA ROSSI MARIA PER Maglie',
  '18/08/2026\t18/08/2026\t145,00\t \tBONIFICO SEPA ISTANTANEO TRN CCTX00000000000000 BENEF. Condominio Via Roma 4 PER Rata 3 acqua 2026 interno 16',
  '10/08/2026\t10/08/2026\t520,00\t \tBONIFICO SEPA ISTANTANEO TRN CCTX00000000000000 BENEF. Mario Bianchi PER mutuo',
  '05/08/2026\t05/08/2026\t170,61\t \tDOMICILIAZIONE (ADDEBITO DIRETTO SEPA) ENEL ENERGIA         CID.IT710020000006655971007             MAN.2C107111854275',
  '05/08/2026\t05/08/2026\t39,90\t \tDOMICILIAZIONE (ADDEBITO DIRETTO SEPA) TELECOMITALIA SPA    CID.IT390030000000488410010             MAN.00800841959620',
  '02/08/2026\t02/08/2026\t \t30,00\tBONIFICO SEPA ISTANTANEO TRN BANKITXXXXX 0300000000000000000000000000IT DA ROSSI MARIA PER Spesa',
].join('\n');

test('il nome vero esce da sotto i codici della banca', () => {
  // Senza, nell' + "'" + ' elenco si legge "SEPA ISTANTANEO TRN BANKITXXXXX 03069..." —
  // che non e' un'informazione, e' rumore con dentro un'informazione.
  const per = Object.fromEntries(parseEstrattoConto(FUORI_POS).movimenti.map((m) => [m.amount, m]));
  assert.equal(per[18].merchant, 'ROSSI MARIA');
  assert.equal(per[145].merchant, 'Condominio Via Roma 4');
  assert.equal(per[520].merchant, 'Mario Bianchi');
  assert.equal(per[170.61].merchant, 'ENEL ENERGIA');
  assert.equal(per[39.9].merchant, 'TELECOMITALIA SPA');
  assert.equal(per[30].merchant, 'ROSSI MARIA');
});

test('la causale del bonifico sopravvive', () => {
  const per = Object.fromEntries(parseEstrattoConto(FUORI_POS).movimenti.map((m) => [m.amount, m]));
  assert.equal(per[18].causale, 'Maglie');
  assert.equal(per[145].causale, 'Rata 3 acqua 2026 interno 16');
  assert.equal(per[520].causale, 'mutuo');
  assert.equal(per[30].causale, 'Spesa');
  // Una domiciliazione non ha una causale scritta da nessuno: meglio niente
  // che il codice del mandato.
  assert.equal(per[170.61].causale, null);
});

test('il mutuo resta una spesa finche' + "'" + ' non gli dici che e' + "'" + ' fisso', () => {
  // Si paga con un bonifico esattamente come i pannolini: nessuna regola puo'
  // distinguerli guardando la causale, e indovinare sarebbe peggio.
  const senza = Object.fromEntries(parseEstrattoConto(FUORI_POS).movimenti.map((m) => [m.amount, m]));
  assert.equal(senza[520].fissa, false);
  assert.equal(senza[170.61].fissa, true, 'la domiciliazione lo e’ per forma');

  const con = Object.fromEntries(
    parseEstrattoConto(FUORI_POS, { fisse: ['Mario Bianchi', 'Condominio Via Roma 4'] })
      .movimenti.map((m) => [m.amount, m]),
  );
  assert.equal(con[520].fissa, true);
  assert.equal(con[145].fissa, true);
  assert.equal(con[18].fissa, false, 'le maglie restano una spesa');
});

test('la causale distingue il mutuo dai pannolini dello stesso beneficiario', () => {
  // Allo stesso nome vanno sia il mutuo sia venti euro di regali: ricordare il
  // solo beneficiario toglierebbe dal tetto anche i regali, cioe' esattamente
  // la spesa discrezionale che sul tetto deve pesare.
  const stessoNome = [
    'Data Contabile\tData Valuta\tAddebiti (euro)\tAccrediti (euro)\tDescrizione operazioni',
    '10/08/2026\t10/08/2026\t520,00\t \tBONIFICO SEPA ISTANTANEO TRN CCTX00000000000000 BENEF. Mario Bianchi PER mutuo',
    '12/08/2026\t12/08/2026\t20,00\t \tBONIFICO SEPA ISTANTANEO TRN CCTX00000000000000 BENEF. Mario Bianchi PER pannolini',
  ].join('\n');

  const con = Object.fromEntries(
    parseEstrattoConto(stessoNome, { fisse: [{ nome: 'Mario Bianchi', causale: 'mutuo' }] })
      .movimenti.map((m) => [m.amount, m]),
  );
  assert.equal(con[520].fissa, true);
  assert.equal(con[20].fissa, false, 'i pannolini restano una spesa del giorno');
});

test('una voce senza causale vale per tutto quello che va a quel nome', () => {
  // E' la forma vecchia, e resta valida: per ENEL il beneficiario basta.
  const con = Object.fromEntries(
    parseEstrattoConto(FUORI_POS, { fisse: [{ nome: 'Mario Bianchi', causale: null }] })
      .movimenti.map((m) => [m.amount, m]),
  );
  assert.equal(con[520].fissa, true);
});

test('il nome imparato si riconosce a meno di maiuscole e spazi', () => {
  const con = parseEstrattoConto(FUORI_POS, { fisse: ['  mario   BIANCHI '] }).movimenti;
  assert.equal(con.find((m) => m.amount === 520).fissa, true);
});

test('un accredito non diventa mai un' + "'" + ' uscita fissa', () => {
  const con = parseEstrattoConto(FUORI_POS, { fisse: ['ROSSI MARIA'] }).movimenti;
  const entrata = con.find((m) => m.amount === 30);
  assert.equal(entrata.entrata, true);
  assert.equal(entrata.fissa, false);
});

test('lo stesso nome scritto in due modi diventa un esercente solo', () => {
  // La banca scrive "BIANCHI ANNA" nei bonifici ricevuti e "Anna Bianchi" in
  // quelli inviati. Non serve sapere quale sia il cognome: bastano le parole.
  const testo = [
    'Data Contabile\tData Valuta\tAddebiti (euro)\tAccrediti (euro)\tDescrizione operazioni',
    '20/08/2026\t20/08/2026\t18,00\t \tBONIFICO SEPA ISTANTANEO TRN X BENEF. Anna Bianchi PER Maglie',
    '02/08/2026\t02/08/2026\t \t30,00\tBONIFICO SEPA ISTANTANEO TRN X DA BIANCHI ANNA PER Spesa',
  ].join('\n');
  const nomi = new Set(parseEstrattoConto(testo).movimenti.map((m) => m.merchant));
  assert.equal(nomi.size, 1, [...nomi].join(' | '));
  // Fra le due forme vince quella che non e' tutta maiuscola: si legge meglio,
  // ed e' comunque una grafia vista davvero, non inventata.
  assert.deepEqual([...nomi], ['Anna Bianchi']);
});

test('la scelta del nome non dipende dall' + "'" + ' ordine delle righe', () => {
  const righe = [
    '20/08/2026\t20/08/2026\t18,00\t \tBONIFICO SEPA ISTANTANEO TRN X BENEF. Anna Bianchi PER Maglie',
    '02/08/2026\t02/08/2026\t9,00\t \tBONIFICO SEPA ISTANTANEO TRN X BENEF. BIANCHI ANNA PER Cena',
  ];
  const intestazione = 'Data Contabile\tData Valuta\tAddebiti (euro)\tAccrediti (euro)\tDescrizione operazioni';
  const uno = parseEstrattoConto([intestazione, ...righe].join('\n')).movimenti.map((m) => m.merchant);
  const due = parseEstrattoConto([intestazione, ...righe.reverse()].join('\n')).movimenti.map((m) => m.merchant);
  assert.deepEqual(new Set(uno), new Set(due));
  assert.deepEqual([...new Set(uno)], ['Anna Bianchi']);
});

test('un import si allinea ai nomi che il registro usa gia' + "'" + '', () => {
  // Il bar delle notifiche si chiama "Gocce Di Caffe"; la banca, via SumUp,
  // lo chiama "Gocce di caffe". Deve restare un esercente solo.
  const testo = [
    'Data Contabile\tData Valuta\tAddebiti (euro)\tAccrediti (euro)\tDescrizione operazioni',
    '26/08/2026\t25/08/2026\t3,50\t \tPAGAMENTO POS SumUp  *Gocce di caffe 25/08/2026 08.32 Bari palese   Op.600000 carta ****0000',
  ].join('\n');
  const { movimenti } = parseEstrattoConto(testo, { nomiNoti: ['Gocce Di Caffe'] });
  assert.equal(movimenti[0].merchant, 'Gocce Di Caffe');
});

test('nomi con le stesse parole ma diversi non si fondono per caso', () => {
  const testo = [
    'Data Contabile\tData Valuta\tAddebiti (euro)\tAccrediti (euro)\tDescrizione operazioni',
    '20/08/2026\t20/08/2026\t18,00\t \tBONIFICO SEPA ISTANTANEO TRN X BENEF. Casa del Pane PER Spesa',
    '19/08/2026\t19/08/2026\t12,00\t \tBONIFICO SEPA ISTANTANEO TRN X BENEF. Pane della Casa PER Spesa',
  ].join('\n');
  const nomi = new Set(parseEstrattoConto(testo).movimenti.map((m) => m.merchant));
  assert.equal(nomi.size, 2, 'del e della sono parole diverse');
});

test('lo stipendio ha un nome, non un TRN', () => {
  // Col TRN dentro il nome ogni mese e' un esercente diverso: la ricorrenza non
  // sarebbe mai osservabile, e a regime lo stipendio resterebbe indistinguibile
  // da un accredito qualunque.
  const righe = [
    'Data Contabile\tData Valuta\tAddebiti (euro)\tAccrediti (euro)\tDescrizione operazioni',
    '31/07/2026\t31/07/2026\t \t1.900,00\tSTIPENDIO/PENSIONE Da ACME SPA TRN 0300000000000000000000000000IT BANKITXXXXX per Emolumenti 07-2026',
    '31/08/2026\t31/08/2026\t \t1.900,00\tSTIPENDIO/PENSIONE Da ACME SPA TRN 0300000000000000000000000001IT BANKITXXXXX per Emolumenti 08-2026',
  ].join('\n');
  const { movimenti } = parseEstrattoConto(righe);
  assert.equal(movimenti[0].merchant, 'ACME SPA');
  assert.equal(movimenti[0].causale, 'Emolumenti 07-2026');
  const trovato = stipendioDaMovimenti(movimenti);
  assert.equal(trovato.nome, 'ACME SPA');
  assert.equal(trovato.mesi, 2, 'due mesi con lo stesso nome, non due nomi diversi');
});
