// L'estratto conto della banca.
//
// E' la sorgente migliore delle tre, e di parecchio: ha l'importo esatto, la
// data **e l'ora** dentro la descrizione, un numero d'operazione univoco, il
// mese intero senza buchi, e anche gli accrediti. Gli screenshot restano utili
// per vedere le spese di oggi prima che la banca le contabilizzi - fra
// l'acquisto e la riga in estratto conto passano giorni.
//
// Quello che manca e' la comodita': un estratto conto lo scarichi una volta al
// mese, una notifica ce l'hai in tasca subito.

import { parseCifra } from './importo.js';
import { isoDelGiorno } from './tempo.js';
import { idTransazione, impronta, grafiaMigliore } from './registro.js';

// La riga di un pagamento con carta. Dentro la descrizione c'e' tutto:
//   PAGAMENTO POS FAMILA MEGAGEST   25/08/2026 18.51 BARI   Op.600000 carta ****0000
// L'ora e' la cosa piu' preziosa: e' l'unico posto in cui il minuto esatto
// dell'acquisto arriva senza passare da uno screenshot.
const POS = /^PAGAMENTO\s+POS\s+(.+?)\s{2,}(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2})[.:](\d{2})\s+(.*?)\s*Op\.\s*(\d+)/i;

// Lo stesso, quando gli spazi multipli si sono persi (copia-incolla, CSV
// rigenerato): si perde solo la separazione netta fra nome e data.
const POS_STRETTO = /^PAGAMENTO\s+POS\s+(.+?)\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2})[.:](\d{2})\s+(.*?)\s*Op\.\s*(\d+)/i;

const RE_DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;

// Il preambolo dell'estratto conto, quello sopra l'intestazione delle colonne.
// Dentro c'e' l'unica cosa che il registro da solo non puo' sapere: quanti soldi
// ci sono davvero sul conto, e a che data.
const SALDO_AL = /saldo\s+al\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i;
const SALDO_CONTABILE = /saldo\s+contabile\s*:?\s*([+-]?[\d.,]+)/i;
const SALDO_DISPONIBILE = /saldo\s+disponibile\s*:?\s*([+-]?[\d.,]+)/i;

/** "+2.648,22" -> 2648.22, segno compreso: un conto puo' andare in rosso. */
function cifraConSegno(testo) {
  return parseCifra(String(testo ?? '').replace(/^\+/, ''));
}

// I gateway di pagamento mettono il proprio nome davanti a quello
// dell'esercente: "SumUp  *Gocce di caffe" e' il bar sotto casa, non SumUp.
// Senza toglierlo lo stesso posto compare con due nomi a seconda del terminale,
// e nel registro sembrano due esercenti diversi.
const GATEWAY = /^(sumup|paypal|paypall|stripe|satispay|nexi|axerve|sq|square|shopify|iz\s*\*)\s*\*\s*/i;

// Uscita fissa: solo cio' che per costruzione e' ricorrente e non
// discrezionale. Una domiciliazione e' un mandato che si ripete da solo; un
// bonifico no - puo' essere l'affitto ma anche i pannolini per un'amica, e
// trattarlo come fisso lo toglierebbe dal tetto giornaliero, che e' esattamente
// dove una spesa del genere deve pesare.
const FISSA = /^\s*(domiciliazione|addebito\s+(diretto|sdd|preautorizzato)|\bsdd\b|commissioni|spese\s+(bancarie|di\s+tenuta|conto)|imposta|bollo|canone|rata\s+(mutuo|finanziamento))/i;

/** Divide una riga di CSV o TSV rispettando le virgolette. */
function dividi(riga, separatore) {
  const fuori = [];
  let campo = '';
  let virgolette = false;
  for (let i = 0; i < riga.length; i++) {
    const c = riga[i];
    if (c === '"') {
      if (virgolette && riga[i + 1] === '"') { campo += '"'; i++; } else virgolette = !virgolette;
    } else if (c === separatore && !virgolette) {
      fuori.push(campo);
      campo = '';
    } else campo += c;
  }
  fuori.push(campo);
  return fuori;
}

/**
 * Il separatore piu' probabile.
 *
 * Il tab per primo: e' quello che si ottiene incollando da Excel, ed e' anche
 * l'unico che non compare mai dentro una descrizione. Il punto e virgola prima
 * della virgola, perche' in italiano la virgola sta dentro gli importi.
 */
function separatore(righe) {
  for (const s of ['\t', ';', ',']) {
    if (righe.some((r) => dividi(r, s).length >= 4)) return s;
  }
  return '\t';
}

/** Vero se questa riga e' l'intestazione della tabella. */
function eIntestazione(celle) {
  const t = celle.join(' ').toLowerCase();
  return t.includes('data') && (t.includes('addebit') || t.includes('accredit'));
}

function indiceColonne(celle) {
  const trova = (...parole) => celle.findIndex((c) => {
    const t = String(c ?? '').toLowerCase();
    return parole.some((p) => t.includes(p));
  });
  return {
    contabile: trova('data contabile', 'contabile'),
    valuta: trova('data valuta', 'valuta'),
    addebiti: trova('addebit', 'dare', 'uscite'),
    accrediti: trova('accredit', 'avere', 'entrate'),
    descrizione: trova('descrizione', 'operazion', 'causale'),
  };
}

/**
 * Un'intestazione basta a se stessa se dice dove sono la descrizione, almeno
 * una colonna di importi e almeno una data. Le altre possono mancare: certi
 * export hanno la sola data contabile, o una colonna sola con il segno.
 */
function intestazioneUtile(col) {
  return col.descrizione >= 0
    && (col.addebiti >= 0 || col.accrediti >= 0)
    && (col.valuta >= 0 || col.contabile >= 0);
}

function giornoDaData(testo) {
  const m = String(testo ?? '').trim().match(RE_DATA);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Legge la descrizione di un pagamento con carta.
 * Ritorna `null` per tutto il resto - bonifici, addebiti diretti, commissioni.
 */
export function leggiPos(descrizione) {
  const testo = String(descrizione ?? '').trim();
  const m = testo.match(POS) ?? testo.match(POS_STRETTO);
  if (!m) return null;

  const [, nome, gg, mm, aaaa, ora, minuto, luogo, operazione] = m;
  const pulito = nome.trim().replace(/\s{2,}/g, ' ');
  const senzaGateway = pulito.replace(GATEWAY, '').trim();

  return {
    // Il gateway si toglie solo se sotto resta un nome: "PAYPAL *" da solo
    // deve restare PayPal, non diventare una riga senza esercente.
    merchant: senzaGateway.length >= 3 ? senzaGateway : pulito,
    giorno: `${aaaa}-${mm}-${gg}`,
    ora: Number(ora),
    minuto: Number(minuto),
    // Per PayPal e simili qui non c'e' una citta' ma un numero di telefono:
    // meglio nessun luogo che un luogo falso.
    city: /[a-z]/i.test(luogo) ? luogo.trim() : null,
    operazione,
  };
}

// Nei movimenti che non sono pagamenti con carta il nome vero e' sepolto fra i
// codici: "BONIFICO SEPA ISTANTANEO TRN CCTX0000000000 BENEF. Condominio Via
// Roma 4 PER Rata 3" dice tutto, ma le uniche due cose che servono a chi legge
// sono le ultime. Senza tirarle fuori nell'elenco si legge "SEPA ISTANTANEO
// TRN CCTX...", che non e' un'informazione.
const BENEFICIARIO = /\bBENEF\.?\s*(.+)$/i;
// "DA" e "PER" la banca li scrive maiuscoli nei bonifici e minuscoli negli
// accrediti dello stipendio; il nome invece comincia sempre per maiuscola, ed e'
// quella - non il caso delle due parole chiave - a garantire che dopo il "da" ci
// sia un nome e non una parola qualunque.
const MITTENTE = /\b[Dd][Aa]\s+(\p{Lu}[\p{L}\s'.]*(?:\s+[Pp][Ee][Rr]\s+.+)?)$/u;
const DOMICILIATO = /^\s*DOMICILIAZIONE\s*(?:\([^)]*\))?\s*(.+?)(?:\s+CID[.\s:]|\s+MAN[.\s:]|$)/i;

// Il codice di tracciamento e il BIC che lo accompagna stanno in mezzo, fra il
// nome e la causale: "STIPENDIO/PENSIONE Da RCS INNOVATION TRN 0306927... 
// BCITITMMXXX per Emolumenti 07-2026". Finche' restano li' il nome non arriva
// in fondo alla riga e nessuna delle due parti si legge - lo stipendio finiva
// nell'elenco col suo TRN per intero. TRN e' sempre maiuscolo, quindi la
// regola non ha bisogno di essere insensibile alle maiuscole, e cosi' non si
// mangia una parola qualunque che venga dopo.
const TRACCIA = /\s*\bTRN\b(?:\s+[A-Z0-9]{6,})+/;

/** Divide "Tizio PER una causale" nelle sue due parti. */
function conCausale(testo) {
  const [nome, ...resto] = String(testo).split(/\s+PER\s+/i);
  return {
    merchant: nome.trim().replace(/\s{2,}/g, ' '),
    causale: resto.join(' PER ').trim().replace(/\s{2,}/g, ' ') || null,
  };
}

// I prefissi con cui la banca classifica l'operazione. Sono utili a lei, non a
// chi legge: "ADDEBITO SDD AFFITTO AGOSTO" in un elenco stretto diventa
// "ADDEBITO SDD AFFIT...", cioe' proprio la meta' che non serve.
const PREFISSI = /^(addebito\s+(sdd|diretto)|disposizione\s+di|pagamento|bonifico(\s+(in\s+)?(uscita|entrata|a\s+favore\s+di))?)\s+/i;

/**
 * Nome e causale di un movimento che non e' un pagamento con carta.
 *
 * Si prova nell'ordine: la domiciliazione, che porta il nome subito dopo la
 * parentesi; il beneficiario di un bonifico in uscita; il mittente di uno in
 * entrata. Se non e' nessuno dei tre resta la descrizione ripulita, che e'
 * meglio di un nome inventato.
 */
export function leggiNonPos(descrizione) {
  const testo = String(descrizione ?? '').replace(/\s{2,}/g, ' ').replace(TRACCIA, '').trim();

  const domiciliato = testo.match(DOMICILIATO);
  if (domiciliato) return { merchant: domiciliato[1].trim(), causale: null };

  const beneficiario = testo.match(BENEFICIARIO);
  if (beneficiario) return conCausale(beneficiario[1]);

  const mittente = testo.match(MITTENTE);
  if (mittente) return conCausale(mittente[1]);

  return { merchant: etichetta(descrizione), causale: null };
}

/** Il titolo leggibile di un movimento che non e' un pagamento con carta. */
function etichetta(descrizione) {
  const pulita = String(descrizione ?? '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*carta\s+\*+\d+\s*$/i, '')
    .replace(/\s*Op\.\s*\d+\s*/i, ' ')
    .trim();

  // Il prefisso si toglie solo se sotto resta qualcosa: "COMMISSIONI E SPESE"
  // non ne ha, e una riga che fosse solo "BONIFICO" deve restare "BONIFICO".
  const senza = pulita.replace(PREFISSI, '').trim();
  return senza.length >= 3 ? senza : pulita;
}

/**
 * parseEstrattoConto(testo) -> { movimenti, periodo, saltate }
 *
 * Comodita' per il testo: incollato da Excel o esportato in CSV. Il lavoro vero
 * lo fa `parseEstrattoContoDaGriglia`, cosi' un .xlsx letto da `xlsx.js` entra
 * dalla stessa porta senza passare da una serializzazione intermedia - che con
 * descrizioni piene di spazi e virgole sarebbe un modo di perdere dati.
 */
export function parseEstrattoConto(testo, opzioni) {
  const righe = String(testo ?? '').split(/\r?\n/).filter((r) => r.trim());
  const sep = separatore(righe);
  return parseEstrattoContoDaGriglia(righe.map((r) => dividi(r, sep)), opzioni);
}

/**
 * parseEstrattoContoDaGriglia(griglia) -> { movimenti, periodo, saltate }
 *
 * Ogni movimento porta con se' come va contato:
 *
 *  - `entrata`  stipendi, rimborsi: non sono spese e non consumano il tetto;
 *  - `fissa`    tutto cio' che non e' un pagamento con carta. Affitto, bollette,
 *               commissioni e bonifici non sono spesa quotidiana per natura, e
 *               contarli nella media giornaliera renderebbe il tetto inutile nel
 *               giorno in cui cadono. La regola guarda il tipo di operazione e
 *               non la ricorrenza: con un mese solo di estratto conto una
 *               ricorrenza non e' osservabile, e indovinarla sarebbe peggio che
 *               non provarci.
 */
/** Confronto fra nomi di beneficiario, indulgente su maiuscole e spazi. */
const normalizza = (nome) => String(nome ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * La chiave con cui si ricorda che un movimento e' un'uscita fissa.
 *
 * Il beneficiario da solo non basta: allo stesso nome vanno sia il mutuo sia
 * venti euro di pannolini, e ricordare "Adriana Bacchi" toglierebbe dal tetto
 * anche i pannolini - cioe' proprio la spesa discrezionale che sul tetto deve
 * pesare. La causale e' l'unica cosa che li distingue.
 *
 * Il prezzo e' che una causale che cambia ogni mese - "Rata 3", "Rata 4" - va
 * rimarcata. Si sbaglia da quella parte apposta: dimenticare una fissa si vede
 * subito e si sistema con un tocco, mentre una spesa vera nascosta fra le fisse
 * non si vede mai piu'.
 */
export function chiaveFissa(nome, causale) {
  return [nome, causale].filter(Boolean).map(normalizza).join(' | ');
}

/** Le voci vecchie erano stringhe: valgono per il beneficiario intero. */
const voceFissa = (v) => (typeof v === 'string'
  ? chiaveFissa(v, null)
  : chiaveFissa(v?.nome, v?.causale));

/**
 * Allinea le grafie dello stesso nome, dentro un import.
 *
 * `gia` sono i nomi che il registro contiene gia': un import nuovo si allinea a
 * come le spese si chiamano adesso, invece di rinominarle tutte. Quale grafia
 * vinca lo decide `grafiaMigliore`, che e' la stessa regola usata dalle
 * statistiche - due posti che scelgono in modo diverso darebbero due nomi
 * diversi per la stessa spesa.
 */
function unificaNomi(movimenti, gia = []) {
  const varianti = new Map();
  const aggiungi = (nome) => {
    const k = impronta(nome);
    if (!k) return;
    if (!varianti.has(k)) varianti.set(k, new Set());
    varianti.get(k).add(nome);
  };
  for (const nome of gia) aggiungi(nome);
  for (const m of movimenti) aggiungi(m.merchant);

  const scelto = new Map([...varianti].map(([k, forme]) => [k, grafiaMigliore(forme)]));

  for (const m of movimenti) {
    const k = impronta(m.merchant);
    if (k && scelto.has(k)) m.merchant = scelto.get(k);
  }
  return movimenti;
}

export function parseEstrattoContoDaGriglia(griglia, opzioni = {}) {
  // I beneficiari che l'utente ha gia' marcato come uscite fisse. Impararli da
  // lui e' l'unico modo onesto: la ricorrenza non si vede in un mese, e la
  // causale di un bonifico puo' dire "mutuo" come "pannolini".
  const fisseImparate = new Set((opzioni.fisse ?? []).map(voceFissa));
  let col = null;
  const movimenti = [];
  let saltate = 0;
  const saldo = { contabile: null, disponibile: null, al: null };

  // Cosa ha visto il lettore, per quando non riconosce niente. Un "non
  // funziona" senza sapere cosa c'era dentro il file costa un giro di
  // domande; queste tre righe lo risparmiano.
  const diagnostica = {
    righe: 0, intestazione: null, colonne: null, primeRighe: [],
    // Le righe scartate valgono piu' di quelle lette bene: sono le uniche che
    // possono spiegare perche' di cento movimenti ne siano entrati otto.
    esempiSaltate: [],
  };

  for (const grezza of griglia ?? []) {
    const celle = (grezza ?? []).map((c) => String(c ?? '').trim());
    if (!celle.some(Boolean)) continue;

    diagnostica.righe++;
    if (diagnostica.primeRighe.length < 8) diagnostica.primeRighe.push(celle);
    if (col && celle.length !== diagnostica.celleIntestazione) diagnostica.righeCorte = (diagnostica.righeCorte ?? 0) + 1;

    if (!col) {
      // Prima dell'intestazione c'e' il preambolo: intestatario, saldi, date.
      // Non e' spazzatura da ignorare in blocco, e' semplicemente un'altra cosa
      // - e i saldi che ci stanno dentro sono l'unico dato che il registro,
      // fatto di soli movimenti, non potrebbe mai ricavare da solo.
      for (const cella of celle) {
        const al = cella.match(SALDO_AL);
        if (al) saldo.al = giornoDaData(al[1]);
        const contabile = cella.match(SALDO_CONTABILE);
        if (contabile) saldo.contabile = cifraConSegno(contabile[1]);
        const disponibile = cella.match(SALDO_DISPONIBILE);
        if (disponibile) saldo.disponibile = cifraConSegno(disponibile[1]);
      }

      if (eIntestazione(celle)) {
        const forse = indiceColonne(celle);
        if (intestazioneUtile(forse)) {
          col = forse;
          diagnostica.intestazione = celle;
          diagnostica.colonne = forse;
          diagnostica.celleIntestazione = celle.length;
        }
      }
      continue;
    }

    const descrizione = celle[col.descrizione] ?? '';
    const addebito = col.addebiti >= 0 ? parseCifra(celle[col.addebiti]) : null;
    const accredito = col.accrediti >= 0 ? parseCifra(celle[col.accrediti]) : null;
    const amount = addebito ?? accredito;
    if (!amount || amount <= 0 || !descrizione) {
      if (descrizione || celle.some(Boolean)) {
        saltate++;
        if (diagnostica.esempiSaltate.length < 5) diagnostica.esempiSaltate.push(celle);
      }
      continue;
      // Una riga con meno celle dell'intestazione vuol dire che gli indici non
      // valgono piu': e' la spiegazione piu' probabile di un import che perde
      // le righe in silenzio, e si vede solo contandole.
    }

    const entrata = addebito === null;
    const pos = entrata ? null : leggiPos(descrizione);

    // La data della descrizione e' il momento dell'acquisto; la data contabile
    // e' quando la banca l'ha registrato, e puo' arrivare giorni dopo. Per un
    // registro di spese conta la prima, altrimenti la cena di venerdi' finisce
    // nel lunedi' successivo.
    const giorno = pos?.giorno
      ?? giornoDaData(celle[col.valuta])
      ?? giornoDaData(celle[col.contabile]);
    if (!giorno) {
      saltate++;
      if (diagnostica.esempiSaltate.length < 5) diagnostica.esempiSaltate.push(celle);
      continue;
    }

    const fuoriPos = pos ? null : leggiNonPos(descrizione);
    const movimento = {
      merchant: pos ? pos.merchant : fuoriPos.merchant,
      city: pos?.city ?? null,
      region: null,
      // La causale di un bonifico e' cio' che nell'elenco prende il posto del
      // luogo: "Pannolini" dice quello che "BANKITXXXXX 03000000000000" non
      // dira' mai.
      causale: fuoriPos?.causale ?? null,
      amount,
      occurredAt: isoDelGiorno(giorno, pos?.ora ?? 0, pos?.minuto ?? 0),
      timeKnown: Boolean(pos),
      entrata,
      // Fissa per forma dell'operazione, oppure perche' l'hai marcata tu una
      // volta: mutuo e rate condominiali si pagano con un bonifico come i
      // pannolini, e nessuna regola puo' distinguerli guardando la causale.
      fissa: !entrata && !pos
        && (FISSA.test(descrizione)
          || fisseImparate.has(chiaveFissa(fuoriPos.merchant, fuoriPos.causale))
          || fisseImparate.has(chiaveFissa(fuoriPos.merchant, null))),
      operazione: pos?.operazione ?? null,
      source: 'banca',
      confidence: 'high',
      rawText: descrizione.replace(/\s{2,}/g, ' ').trim(),
    };
    movimenti.push(movimento);
  }

  // Prima degli id: l'identita' di una spesa nasce anche dal nome, e unificarlo
  // dopo lascerebbe due spese identiche con due id diversi.
  unificaNomi(movimenti, opzioni.nomiNoti ?? []);
  for (let i = 0; i < movimenti.length; i++) {
    movimenti[i] = { id: idTransazione(movimenti[i]), ...movimenti[i] };
  }

  const giorni = movimenti.map((m) => m.occurredAt.slice(0, 10)).sort();
  return {
    movimenti,
    diagnostica,
    // Il periodo coperto serve a chi importa: e' l'intervallo che l'estratto
    // conto ha il diritto di riscrivere.
    periodo: giorni.length ? { da: giorni[0], a: giorni[giorni.length - 1] } : null,
    // Senza data il saldo non vale niente: un numero di soldi senza il giorno a
    // cui si riferisce non si puo' ne' aggiornare ne' smentire.
    saldo: saldo.al && saldo.disponibile !== null ? saldo : null,
    saltate,
  };
}

/**
 * Lo stipendio, cioe' l'accredito grosso che si ripete.
 *
 * L'ordine delle due condizioni conta, e la prima versione lo aveva sbagliato:
 * pesando la ricorrenza sopra ogni cosa, un rimborso da quaranta euro arrivato
 * due mesi di fila batteva uno stipendio da tremilaseicento comparso una volta
 * sola nel periodo coperto. Un accredito da quaranta euro non e' uno stipendio,
 * per quante volte si ripeta.
 *
 * Quindi prima si guarda la taglia, poi la ricorrenza. La soglia e' un quarto
 * del piu' grande, e serve a separare due cose diverse: uno stipendio e un
 * rimborso straordinario possono differire di un fattore due o tre, e li' la
 * ricorrenza e' il segnale buono; uno stipendio e la restituzione della cena
 * differiscono di un fattore cento, e li' la ricorrenza non conta niente.
 */
export function stipendioDaMovimenti(movimenti) {
  const entrate = (movimenti ?? []).filter((m) => m.entrata);
  if (!entrate.length) return null;

  const perNome = new Map();
  for (const m of entrate) {
    const chiave = m.merchant.toLowerCase();
    if (!perNome.has(chiave)) perNome.set(chiave, []);
    perNome.get(chiave).push(m);
  }

  const candidati = [...perNome.values()].map((gruppo) => ({
    nome: gruppo[0].merchant,
    importo: Math.max(...gruppo.map((m) => m.amount)),
    mesi: new Set(gruppo.map((m) => m.occurredAt.slice(0, 7))).size,
  }));

  const massimo = Math.max(...candidati.map((c) => c.importo));
  const inGara = candidati.filter((c) => c.importo >= massimo / 4);

  inGara.sort((a, b) => b.mesi - a.mesi || b.importo - a.importo);
  return inGara[0] ?? null;
}
