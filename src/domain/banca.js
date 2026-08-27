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
import { idTransazione } from './registro.js';

// La riga di un pagamento con carta. Dentro la descrizione c'e' tutto:
//   PAGAMENTO POS FAMILA MEGAGEST   25/08/2026 18.51 BARI   Op.600000 carta ****0000
// L'ora e' la cosa piu' preziosa: e' l'unico posto in cui il minuto esatto
// dell'acquisto arriva senza passare da uno screenshot.
const POS = /^PAGAMENTO\s+POS\s+(.+?)\s{2,}(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2})[.:](\d{2})\s+(.*?)\s*Op\.\s*(\d+)/i;

// Lo stesso, quando gli spazi multipli si sono persi (copia-incolla, CSV
// rigenerato): si perde solo la separazione netta fra nome e data.
const POS_STRETTO = /^PAGAMENTO\s+POS\s+(.+?)\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2})[.:](\d{2})\s+(.*?)\s*Op\.\s*(\d+)/i;

const RE_DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;

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
const MITTENTE = /\bDA\s+(\p{Lu}[\p{L}\s'.]*(?:\s+PER\s+.+)?)$/u;
const DOMICILIATO = /^\s*DOMICILIAZIONE\s*(?:\([^)]*\))?\s*(.+?)(?:\s+CID[.\s:]|\s+MAN[.\s:]|$)/i;

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
  const testo = String(descrizione ?? '').replace(/\s{2,}/g, ' ').trim();

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
 * Le parole di un nome, minuscole, senza accenti e **ordinate**.
 *
 * L'ordine buttato via e' il punto: la banca scrive "BIANCHI ANNA" nei bonifici
 * ricevuti e "Anna Bianchi" in quelli inviati, e sono la stessa persona. Non
 * serve sapere quale parola sia il nome e quale il cognome - basta che le
 * parole siano le stesse.
 */
function impronta(nome) {
  return String(nome ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean).sort()
    .join(' ');
}

/**
 * Fra i modi diversi di scrivere lo stesso nome ne sceglie uno solo.
 *
 * Non inventa una forma nuova: sceglie fra quelle viste davvero, e sempre allo
 * stesso modo - vince chi non e' tutto maiuscolo, perche' si legge meglio, e a
 * parita' la prima in ordine alfabetico, perche' due import dello stesso file
 * devono dare lo stesso risultato.
 *
 * `gia` sono i nomi che il registro contiene gia': un import nuovo si allinea a
 * come le spese si chiamano adesso, invece di rinominarle tutte.
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

  const meglio = (a, b) => {
    const tuttoMaiuscoloA = a === a.toUpperCase() ? 1 : 0;
    const tuttoMaiuscoloB = b === b.toUpperCase() ? 1 : 0;
    return tuttoMaiuscoloA - tuttoMaiuscoloB || (a < b ? -1 : a > b ? 1 : 0);
  };
  const scelto = new Map([...varianti].map(([k, forme]) => [k, [...forme].sort(meglio)[0]]));

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
  const fisseImparate = new Set((opzioni.fisse ?? []).map(normalizza));
  let col = null;
  const movimenti = [];
  let saltate = 0;

  // Cosa ha visto il lettore, per quando non riconosce niente. Un "non
  // funziona" senza sapere cosa c'era dentro il file costa un giro di
  // domande; queste tre righe lo risparmiano.
  const diagnostica = { righe: 0, intestazione: null, colonne: null, primeRighe: [] };

  for (const grezza of griglia ?? []) {
    const celle = (grezza ?? []).map((c) => String(c ?? '').trim());
    if (!celle.some(Boolean)) continue;

    diagnostica.righe++;
    if (diagnostica.primeRighe.length < 8) diagnostica.primeRighe.push(celle);

    if (!col) {
      // Prima dell'intestazione c'e' il preambolo: intestatario, saldi, date.
      // Non e' spazzatura da ignorare in blocco, e' semplicemente un'altra cosa.
      if (eIntestazione(celle)) {
        const forse = indiceColonne(celle);
        if (intestazioneUtile(forse)) {
          col = forse;
          diagnostica.intestazione = celle;
          diagnostica.colonne = forse;
        }
      }
      continue;
    }

    const descrizione = celle[col.descrizione] ?? '';
    const addebito = col.addebiti >= 0 ? parseCifra(celle[col.addebiti]) : null;
    const accredito = col.accrediti >= 0 ? parseCifra(celle[col.accrediti]) : null;
    const amount = addebito ?? accredito;
    if (!amount || amount <= 0 || !descrizione) {
      if (descrizione || celle.some(Boolean)) saltate++;
      continue;
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
    if (!giorno) { saltate++; continue; }

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
        && (FISSA.test(descrizione) || fisseImparate.has(normalizza(fuoriPos.merchant))),
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
    saltate,
  };
}

/**
 * Lo stipendio, cioe' l'accredito ricorrente piu' grosso.
 *
 * Con un mese solo la ricorrenza non si vede, e allora vince semplicemente
 * l'accredito piu' grande: e' quasi sempre lo stipendio, e comunque resta un
 * numero modificabile a mano. Con piu' mesi si preferisce chi si ripete, che e'
 * il segnale vero.
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

  let migliore = null;
  for (const gruppo of perNome.values()) {
    const mesi = new Set(gruppo.map((m) => m.occurredAt.slice(0, 7))).size;
    const importo = Math.max(...gruppo.map((m) => m.amount));
    const punteggio = mesi * 1e9 + importo;
    if (!migliore || punteggio > migliore.punteggio) {
      migliore = { punteggio, importo, nome: gruppo[0].merchant, mesi };
    }
  }
  return migliore ? { importo: migliore.importo, nome: migliore.nome, mesi: migliore.mesi } : null;
}
