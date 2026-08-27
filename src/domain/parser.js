// Il parser: da testo grezzo a transazioni. E' il cuore del progetto e l'unica
// parte che sopravvive certamente all'arrivo dell'ANCS.
//
// Non sa nulla di come il testo sia stato ottenuto (Live Text, uno Shortcut, un
// domani niente del tutto) e non tocca il DOM: gira in Node, quindi si testa
// davvero.

import {
  risolviTempo, contieneOra, isoRoma, risolviGiornoApp, risolviIstanteApp, inizioGiorno,
} from './tempo.js';
import { parseImporto } from './importo.js';
import { idTransazione } from './registro.js';
import { eOperazioneFissa } from './banca.js';

const APP = /poste\s*italiane/i;

/**
 * "Crucotto Snc. Bari, Puglia" -> { merchant: "Crucotto Snc", city: "Bari", region: "Puglia" }
 *
 * Si taglia sul *primo* ". ", ed e' proprio questo che fa funzionare sia la
 * "Snc." in fondo al nome sia una "S.r.l." in mezzo: dentro quelle sigle il
 * punto e' seguito da una lettera, non da uno spazio, quindi non e' un
 * candidato. Un apostrofo come in "Bistro'" non e' un caso speciale.
 */
export function spezzaEsercente(riga) {
  const testo = String(riga ?? '').trim();
  const taglio = testo.indexOf('. ');
  if (taglio < 0) return { merchant: testo, city: null, region: null };

  const merchant = testo.slice(0, taglio).trim();
  const luogo = testo.slice(taglio + 2).trim();
  const virgola = luogo.indexOf(',');
  if (virgola < 0) return { merchant, city: luogo || null, region: null };
  return {
    merchant,
    city: luogo.slice(0, virgola).trim() || null,
    region: luogo.slice(virgola + 1).trim() || null,
  };
}

/** Fra piu' livelli di fiducia vince sempre il peggiore. */
function peggiore(...livelli) {
  return livelli.includes('low') ? 'low' : 'high';
}

function componi(campi) {
  return { id: idTransazione(campi), ...campi };
}

/** Una riga puo' essere l'esercente solo se non e' nient'altro. */
function puoEssereEsercente(riga) {
  if (!riga) return false;
  if (APP.test(riga)) return false;
  if (contieneOra(riga)) return false;
  if (parseImporto(riga)) return false;
  return /[a-zA-Z]/.test(riga);
}

/**
 * parseNotifications(rawText, capturedAt) -> Transaction[]
 *
 * L'importo fa da ancora: e' l'ultima delle tre righe della card ed e' l'unica
 * riconoscibile da sola, senza contesto. Da li' si risale all'esercente e
 * all'intestazione.
 *
 * Se sopra non c'e' tutto quello che serve, la card e' tagliata dal bordo dello
 * screenshot e si scarta. Non si indovina: e' il caso piu' comune e il piu' facile
 * da sbagliare in silenzio.
 */
export function parseNotifications(rawText, capturedAt) {
  const righe = String(rawText ?? '')
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean);

  const fuori = [];
  for (let i = 0; i < righe.length; i++) {
    const importo = parseImporto(righe[i]);
    if (!importo) continue;

    const rigaEsercente = righe[i - 1];
    if (!puoEssereEsercente(rigaEsercente)) continue;

    // L'intestazione puo' essere una riga sola ("Poste Italiane   08:06") oppure
    // due, in ordine imprevedibile, a seconda di come l'OCR ha sciolto la card.
    // Si risale finche' non si trova un orario, fermandosi appena si entra nella
    // card precedente.
    let intestazione = null;
    for (let j = i - 2; j >= 0 && j >= i - 4; j--) {
      if (contieneOra(righe[j])) {
        intestazione = righe[j];
        break;
      }
      if (parseImporto(righe[j])) break;
    }
    if (!intestazione) continue;

    const tempo = risolviTempo(intestazione, capturedAt);
    if (!tempo) continue;

    const { merchant, city, region } = spezzaEsercente(rigaEsercente);
    if (!merchant) continue;

    fuori.push(componi({
      merchant,
      city,
      region,
      amount: importo.amount,
      occurredAt: tempo.occurredAt,
      timeKnown: true,
      source: 'screenshot',
      confidence: peggiore(importo.confidence, tempo.confidence),
      rawText: [intestazione, rigaEsercente, righe[i]].join('\n'),
    }));
  }
  return fuori;
}

/**
 * parseStructured({ subtitle, message, receivedAt }) -> Transaction | null
 *
 * L'ingresso della v2, gia' pronto. L'ANCS consegna i campi separati e una data
 * assoluta, quindi qui non serve niente di `tempo.js` tranne la formattazione:
 * tutta la parte fragile della v1 sparisce da sola.
 */
export function parseStructured({ subtitle, message, receivedAt }) {
  const importo = parseImporto(message);
  if (!importo) return null;

  const { merchant, city, region } = spezzaEsercente(subtitle);
  if (!merchant) return null;

  const quando = receivedAt instanceof Date ? receivedAt : new Date(receivedAt);
  if (Number.isNaN(quando.getTime())) return null;

  return componi({
    merchant,
    city,
    region,
    amount: importo.amount,
    occurredAt: isoRoma(quando.getTime()),
    timeKnown: true,
    source: 'ancs',
    confidence: importo.confidence,
    rawText: [subtitle, message].join('\n'),
  });
}

// ---------------------------------------------------------------------------
// L'app Poste ha due schermate, e non mostrano la stessa cosa.
//
// "Ultime spese" e' l'elenco dei pagamenti con carta: esercente, citta', importo
// senza segno e un giorno relativo ("Ieri", "14 ore fa"). E' compatta - ne
// entrano nove per schermata - ma l'ora non ce l'ha.
//
// "Movimenti" e' il conto per intero, bonifici e accrediti compresi. Ogni riga
// porta il tipo d'operazione in cima, la data per esteso e l'importo **col
// segno** a destra e, sotto il nome, la data e l'ora dell'acquisto. Costa il
// doppio delle righe e la citta' non la scrive, ma in cambio da' l'unica cosa
// che a uno screenshot manca sempre: il minuto.
//
// Si leggono qui dentro tutte e due, perche' il lavoro e' lo stesso: spezzare in
// voci, classificare riga per riga, emettere solo cio' che e' completo.

const RE_CITTA = /^[^\d,]+,\s*[^\d,]+$/;

// Il chevron che l'app mette in fondo a ogni riga. L'OCR a volte lo isola su una
// riga sua e a volte lo attacca all'importo, e li' fa danno: "17,00€ >" non si
// legge come un importo, e quella spesa sparirebbe in silenzio.
const RE_CHEVRON = /[\s>›❯»]+$/;

// Il tipo d'operazione, la riga grigia in cima a ogni movimento. Deve essere
// tutta la riga e tutta maiuscola: cosi' "PAGAMENTO POS" e' un'intestazione e
// "WWW.AMAZON.IT" resta un esercente, e la descrizione di un estratto conto -
// che comincia con le stesse parole ma prosegue con nome, data e numero
// d'operazione - non entra di qui per sbaglio.
//
// Un tipo che non conosciamo non fa danno: resta un nome, apre una voce che
// nessun importo completera' e sparisce, mentre l'esercente vero sotto di lui
// continua a leggersi. Si perde l'ora, non la spesa.
const TIPO_OPERAZIONE = /^(PAGAMENTO|BONIFICO|POSTAGIRO|GIROCONTO|ADDEBITO|DOMICILIAZIONE|COMMISSIONI|PRELIEVO|VERSAMENTO|RICARICA|ACCREDITO|STIPENDIO|PENSIONE|IMPOSTA|BOLLO|CANONE|RATA|RIMBORSO|STORNO)(\s+[A-Z0-9][A-Z0-9.'*/-]*)*$/;

// Lo stato del movimento, col pallino colorato che l'OCR legge come un
// carattere qualunque. Dice una cosa vera - la banca non l'ha ancora
// contabilizzato, cioe' il caso per cui questa app esiste - ma qui basta che non
// passi per il nome di un esercente.
const STATO = /^[\s•●○·*o-]*(non\s+contabilizzat[oa]|contabilizzat[oa]|in\s+(corso|elaborazione|lavorazione)|autorizzat[oa]|annullat[oa]|rifiutat[oa]|sospes[oa]|stornat[oa])\s*$/i;

// Il codice di tracciamento di un bonifico: e' l'identita' dell'operazione, non
// il nome di chi sta dall'altra parte. Senza toglierlo il registro si riempie di
// righe che si chiamano "TRN BCITITMMXXX".
const TRACCIA = /^TRN\b[\sA-Z0-9]*$/;

// Il BIC che segue il TRN, quando l'OCR lo stacca su una riga sua. Si accetta
// solo dentro un bonifico: fuori di li' otto lettere maiuscole di fila sono
// molto piu' spesso il nome di un negozio che il codice di una banca.
const CODICE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const BONIFICO = /^(BONIFICO|POSTAGIRO|GIROCONTO|ACCREDITO|STIPENDIO|PENSIONE)/;

// Il numero d'operazione che l'app scrive sotto il TRN: venti cifre di fila, che
// l'app tronca con dei puntini. Va riconosciuto prima dell'importo, perche'
// senza virgola e senza segno passerebbe per una spesa da miliardi di euro - e
// arrivando prima dell'importo vero se ne prenderebbe il posto.
const NUMERO_LUNGO = /^\d{10,}\s*(\.\.\.|\u2026)?$/;

/**
 * Numera le spese dentro ogni giorno, contando **dalla piu' vecchia**.
 *
 * Fa due lavori con un numero solo: distingue due spese identiche dello stesso
 * giorno, che senza orario sarebbero indistinguibili, e conserva l'ordine in cui
 * l'app le mostra, che altrimenti si perderebbe.
 *
 * Il verso e' la parte che conta. La lista cresce dall'alto, quindi numerando
 * dal basso una spesa gia' importata tiene il suo numero anche quando sopra ne
 * compaiono di nuove; numerando dall'alto lo vedrebbe slittare a ogni acquisto,
 * e tornerebbe a sembrare nuova a ogni import.
 *
 * Resta un limite onesto: se un giorno finisce spezzato fra due schermate i
 * numeri di quel giorno cambiano e qualche spesa puo' duplicarsi. Si vede
 * nell'esito dell'import, non in silenzio.
 */
function numeraNelGiorno(righe) {
  const conta = new Map();
  for (let i = righe.length - 1; i >= 0; i--) {
    const r = righe[i];
    const n = conta.get(r.giorno) ?? 0;
    conta.set(r.giorno, n + 1);
    r.posizione = n;
  }
  return righe;
}

/**
 * Stacca la colonna di destra da quella di sinistra.
 *
 * Sullo schermo sono due colonne; nel testo dell'OCR a volte diventano due righe
 * e a volte una sola, e quale dei due casi capiti non lo decide nessuno.
 * Separarle qui, prima di guardare cosa sono, evita che ogni regola piu' avanti
 * debba conoscerli tutti e due.
 *
 * Il taglio si prova dal piu' lungo al piu' corto e vale solo se cio' che resta a
 * destra e' davvero una data, un'ora o un importo: "Hotel 4 Stagioni" contiene
 * qualcosa che somiglia a una data, e non lo e'.
 *
 * Una riga che si legge gia' tutta intera non si tocca: "27 ago 2026" e'
 * una data sola, ma spezzata dopo "ago" diventa una data senza anno e un "2026"
 * che passa per un importo di duemila euro.
 */
function staccaColonne(riga, capturedAt) {
  if (risolviIstanteApp(riga) || risolviGiornoApp(riga, capturedAt) || parseImporto(riga)) return [riga];

  const parole = riga.split(/\s+/);
  for (let i = 1; i < parole.length; i++) {
    const destra = parole.slice(i).join(' ');
    if (!/^[\d+−-]/.test(destra)) continue;
    if (NUMERO_LUNGO.test(destra)) continue;
    if (!risolviIstanteApp(destra) && !risolviGiornoApp(destra, capturedAt) && !parseImporto(destra)) continue;
    const testa = parole.slice(0, i).join(' ');
    if (testa && /[a-zA-Z]/.test(testa)) return [testa, destra];
  }
  return [riga];
}

/**
 * A cosa somiglia una riga, guardandola da sola.
 *
 * L'ordine dei controlli conta: una data non e' mai un importo, e "Bari, Puglia"
 * non e' mai un nome. Quello che non e' nessuna delle cose note - l'orologio
 * della barra di stato, un'icona letta come segno - non e' spazzatura da
 * indovinare, e' spazzatura da ignorare.
 *
 * `voce` serve solo al codice del bonifico: la stessa riga di lettere maiuscole
 * e' un BIC sotto un "BONIFICO SEPA" e il nome di un negozio dappertutto
 * altrove, e senza guardare da che parte sta non si puo' decidere.
 */
function classifica(riga, capturedAt, voce) {
  if (TIPO_OPERAZIONE.test(riga)) return { tipo: 'tipo' };
  if (STATO.test(riga)) return { tipo: 'stato' };

  const istante = risolviIstanteApp(riga);
  if (istante) return { tipo: 'istante', istante };

  const data = risolviGiornoApp(riga, capturedAt);
  if (data) return { tipo: 'data', data };

  if (NUMERO_LUNGO.test(riga)) return { tipo: 'riferimento' };

  const importo = parseImporto(riga);
  if (importo) return { tipo: 'importo', importo };

  if (RE_CITTA.test(riga)) return { tipo: 'citta' };
  if (TRACCIA.test(riga)) return { tipo: 'riferimento' };
  if (CODICE.test(riga) && BONIFICO.test(voce?.tipo ?? '')) return { tipo: 'riferimento' };
  if (/[a-zA-Z]/.test(riga)) return { tipo: 'nome' };
  return { tipo: 'scarto' };
}

/**
 * parseAppList(rawText, capturedAt) -> Transaction[]
 *
 * A tenere insieme una voce e' il **nome dell'esercente**, non la data - e nella
 * schermata dei movimenti il tipo d'operazione che gli sta sopra.
 *
 * La prima versione usava la data come chiusura, dando per scontato che
 * l'importo arrivasse prima. Non e' cosi': nella lista l'importo sta nella
 * colonna di destra, e l'OCR puo' emetterlo dopo il blocco di sinistra, cioe'
 * dopo la data. Con quell'assunto ogni importo scivolava sulla voce seguente e
 * ogni data slittava di una riga - e il guaio non si vedeva, perche' il
 * risultato restava un elenco perfettamente plausibile di spese sbagliate.
 *
 * Ancorandosi al nome l'ordine degli altri pezzi smette di contare. Una voce
 * viene emessa solo se ha un nome, un importo e un giorno: quelle tagliate dai
 * bordi dello schermo ne perdono almeno uno e restano fuori.
 */
export function parseAppList(rawText, capturedAt) {
  const righe = [];
  for (const grezza of String(rawText ?? '').split(/\r?\n/)) {
    const r = grezza.replace(RE_CHEVRON, '').trim();
    if (r) righe.push(...staccaColonne(r, capturedAt));
  }

  // Quale delle due schermate e'. Il tipo d'operazione e il segno davanti
  // all'importo appartengono solo ai movimenti: nelle ultime spese non
  // compaiono mai. Serve saperlo perche' le due mostrano cose diverse, e
  // chiedere ai movimenti la citta' che non scrivono vorrebbe dire mandare in
  // revisione tutto quanto.
  const movimenti = righe.some((r) => TIPO_OPERAZIONE.test(r) || parseImporto(r)?.segno);

  const voci = [];
  let voce = null;
  const apri = (tipo) => {
    if (voce) voci.push(voce);
    voce = { tipo, righe: [] };
  };

  for (const riga of righe) {
    const c = classifica(riga, capturedAt, voce);
    if (c.tipo === 'scarto') continue;

    if (c.tipo === 'tipo') {
      apri(riga);
      voce.righe.push(riga);
      continue;
    }

    if (c.tipo === 'nome') {
      // Sotto un tipo d'operazione il nome appartiene alla voce appena aperta:
      // e' la riga sotto l'intestazione, non un movimento nuovo. Dappertutto
      // altrove un nome chiude la voce di prima e ne apre una.
      if (!voce || !voce.tipo || voce.merchant) apri(null);
      voce.merchant = riga;
      voce.righe.push(riga);
      continue;
    }

    // Pezzi che arrivano prima di qualsiasi voce: sono la coda di un movimento
    // tagliato dal bordo superiore. Non hanno a chi appartenere.
    if (!voce) continue;

    voce.righe.push(riga);
    if (c.tipo === 'importo' && !voce.importo) voce.importo = c.importo;
    else if (c.tipo === 'istante' && !voce.istante) voce.istante = c.istante;
    else if (c.tipo === 'data' && !voce.data) voce.data = c.data;
    else if (c.tipo === 'citta' && !voce.city) {
      const virgola = riga.indexOf(',');
      voce.city = riga.slice(0, virgola).trim() || null;
      voce.region = riga.slice(virgola + 1).trim() || null;
    }
  }
  if (voce) voci.push(voce);

  for (const v of voci) v.giorno = v.istante?.giorno ?? v.data?.giorno ?? null;
  // Il tipo d'operazione basta come nome quando il nome non c'e': un bonifico
  // ricevuto porta il TRN al posto del mittente, e "BONIFICO SEPA ISTANTANEO" e'
  // almeno cio' che la banca ha scritto davvero. Esce comunque in revisione.
  const complete = voci.filter((v) => (v.merchant || v.tipo) && v.importo && v.giorno);

  // Solo le voci senza orario hanno bisogno di un ordinale: dove il minuto c'e'
  // distingue gia' lui, e numerarle vorrebbe dire cambiargli l'id ogni volta che
  // sopra compare una spesa nuova.
  numeraNelGiorno(complete.filter((v) => !v.istante));

  return complete.map((v) => {
    const ePos = /^PAGAMENTO\s+POS\b/i.test(v.tipo ?? '');
    const segno = v.importo.segno ?? null;
    const entrata = segno === 1;
    // Le due date della stessa voce devono dire la stessa cosa. Quando non lo
    // fanno una delle due l'ha letta male l'OCR, e quale non si sa.
    const discordi = Boolean(v.istante && v.data && v.istante.giorno !== v.data.giorno);

    const versi = movimenti
      ? {
        entrata,
        // Fissa per forma dell'operazione, come nell'estratto conto: un
        // addebito diretto e' un mandato che si ripete da solo, un bonifico e'
        // una decisione e sul tetto del giorno deve pesare.
        fissa: !entrata && !ePos && eOperazioneFissa(v.tipo ?? ''),
      }
      : {};

    return componi({
      merchant: v.merchant ?? v.tipo,
      city: v.city ?? null,
      region: v.region ?? null,
      amount: v.importo.amount,
      ...versi,
      // L'ora, quando c'e', e' la stessa cosa che l'estratto conto tiene dentro
      // la descrizione: un istante vero, non mezzanotte per convenzione.
      occurredAt: v.istante ? v.istante.occurredAt : inizioGiorno(v.giorno),
      timeKnown: Boolean(v.istante),
      posizione: v.posizione,
      source: 'app',
      confidence: peggiore(
        v.importo.confidence,
        v.istante ? v.istante.confidence : v.data.confidence,
        discordi ? 'low' : 'high',
        movimenti
          // Nei movimenti la citta' non c'e' per nessuno, quindi non dice
          // niente. Dicono invece il nome, che un bonifico ricevuto non ha, e
          // il segno, senza il quale non si sa da che parte vanno i soldi.
          ? peggiore(v.merchant ? 'high' : 'low', segno ? 'high' : 'low')
          // Senza la riga del luogo la forma non e' quella attesa: si legge, ma
          // si controlla.
          : (v.city ? 'high' : 'low'),
      ),
      rawText: v.righe.join('\n'),
    });
  });
}
