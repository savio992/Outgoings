// Il parser: da testo grezzo a transazioni. E' il cuore del progetto e l'unica
// parte che sopravvive certamente all'arrivo dell'ANCS.
//
// Non sa nulla di come il testo sia stato ottenuto (Live Text, uno Shortcut, un
// domani niente del tutto) e non tocca il DOM: gira in Node, quindi si testa
// davvero.

import { risolviTempo, contieneOra, isoRoma, risolviGiornoApp, inizioGiorno } from './tempo.js';
import { parseImporto } from './importo.js';
import { idTransazione } from './registro.js';

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
// La lista dell'app Poste. E' la sorgente principale, per tre ragioni:
// e' lo storico completo e scorrevole invece di una vista effimera che si perde
// svuotando le notifiche; consegna esercente e citta' gia' separati, quindi la
// regola piu' fragile del parser qui non serve; e ne entrano piu' per schermata.
//
// In cambio non ha l'orario. La data resta corretta, ma la chiave di dedup
// scende alla granularita' del giorno, e per distinguere due spese identiche
// nello stesso giorno serve un ordinale - vedi `numeraOccorrenze`.

const RE_CITTA = /^[^\d,]+,\s*[^\d,]+$/;

// Il chevron che l'app mette in fondo a ogni riga. L'OCR a volte lo isola su una
// riga sua e a volte lo attacca all'importo, e li' fa danno: "17,00€ >" non si
// legge come un importo, e quella spesa sparirebbe in silenzio.
const RE_CHEVRON = /[\s>\u203a\u276f\u00bb]+$/;
const RE_IMPORTO_IN_CODA = /\s+((?:\d{1,3}(?:\.\d{3})*|\d+),\d{1,2}\s*[€CcEe£]?)$/;

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

/** Da una riga della lista estrae esercente, citta' e importo. */
function leggiRiga(coda) {
  let importo = null;
  const resto = [];
  for (const r of coda) {
    if (importo === null) {
      const i = parseImporto(r);
      if (i) { importo = i; continue; }
    }
    resto.push(r);
  }

  // La citta' e' l'ultima riga della forma "Qualcosa, Qualcosa" senza cifre.
  let iCitta = -1;
  for (let k = resto.length - 1; k >= 0; k--) {
    if (RE_CITTA.test(resto[k])) { iCitta = k; break; }
  }

  let rigaEsercente = iCitta > 0 ? resto[iCitta - 1] : (iCitta < 0 ? resto[resto.length - 1] : null);
  if (!rigaEsercente) return null;

  // Se l'OCR ha tenuto le due colonne sulla stessa riga, l'importo e' in coda al
  // nome dell'esercente e va staccato prima di leggerlo.
  if (importo === null) {
    const coda2 = rigaEsercente.match(RE_IMPORTO_IN_CODA);
    if (coda2) {
      importo = parseImporto(coda2[1]);
      rigaEsercente = rigaEsercente.slice(0, coda2.index).trim();
    }
  }
  if (!importo || !rigaEsercente) return null;

  const luogo = iCitta >= 0 ? resto[iCitta] : null;
  const virgola = luogo ? luogo.indexOf(',') : -1;
  return {
    merchant: rigaEsercente.trim(),
    city: virgola >= 0 ? luogo.slice(0, virgola).trim() : null,
    region: virgola >= 0 ? luogo.slice(virgola + 1).trim() : null,
    importo,
    // Senza la riga del luogo la forma non e' quella attesa: si legge, ma si
    // controlla.
    confidence: iCitta >= 0 ? 'high' : 'low',
  };
}

/**
 * A cosa somiglia una riga, guardandola da sola.
 *
 * L'ordine dei controlli conta: una data non e' mai un importo, e "Bari, Puglia"
 * non e' mai un nome. Quello che non e' nessuna delle quattro cose - l'orologio
 * della barra di stato, un'icona letta come segno - non e' spazzatura da
 * indovinare, e' spazzatura da ignorare.
 */
function classifica(riga, capturedAt) {
  const data = risolviGiornoApp(riga, capturedAt);
  if (data) return { tipo: 'data', data };

  const importo = parseImporto(riga);
  if (importo) return { tipo: 'importo', importo };

  if (RE_CITTA.test(riga)) return { tipo: 'citta' };
  if (/[a-zA-Z]/.test(riga)) return { tipo: 'nome' };
  return { tipo: 'scarto' };
}

/**
 * parseAppList(rawText, capturedAt) -> Transaction[]
 *
 * A tenere insieme una voce e' il **nome dell'esercente**, non la data.
 *
 * La prima versione usava la data come chiusura, dando per scontato che
 * l'importo arrivasse prima. Non e' cosi': nella lista l'importo sta nella
 * colonna di destra, e l'OCR puo' emetterlo dopo il blocco di sinistra, cioe'
 * dopo la data. Con quell'assunto ogni importo scivolava sulla voce seguente e
 * ogni data slittava di una riga - e il guaio non si vedeva, perche' il
 * risultato restava un elenco perfettamente plausibile di spese sbagliate.
 *
 * Ancorandosi al nome l'ordine degli altri tre pezzi smette di contare. Una voce
 * viene emessa solo se ha nome, importo e data: quelle tagliate dai bordi dello
 * schermo ne perdono almeno uno e restano fuori.
 */
export function parseAppList(rawText, capturedAt) {
  const righe = String(rawText ?? '')
    .split(/\r?\n/)
    .map((r) => r.replace(RE_CHEVRON, '').trim())
    .filter(Boolean);

  const voci = [];
  let voce = null;

  for (const riga of righe) {
    const c = classifica(riga, capturedAt);
    if (c.tipo === 'scarto') continue;

    if (c.tipo === 'nome') {
      // Un nome nuovo apre una voce nuova e chiude quella prima.
      if (voce) voci.push(voce);
      voce = { merchant: riga, righe: [riga] };

      // Se l'OCR ha tenuto unite le due colonne, l'importo e' in coda al nome.
      const coda = riga.match(RE_IMPORTO_IN_CODA);
      if (coda) {
        voce.importo = parseImporto(coda[1]);
        voce.merchant = riga.slice(0, coda.index).trim();
      }
      continue;
    }

    // Pezzi che arrivano prima di qualsiasi nome: sono la coda di una voce
    // tagliata dal bordo superiore. Non hanno a chi appartenere.
    if (!voce) continue;

    voce.righe.push(riga);
    if (c.tipo === 'importo' && !voce.importo) voce.importo = c.importo;
    else if (c.tipo === 'data' && !voce.data) voce.data = c.data;
    else if (c.tipo === 'citta' && !voce.city) {
      const virgola = riga.indexOf(',');
      voce.city = riga.slice(0, virgola).trim() || null;
      voce.region = riga.slice(virgola + 1).trim() || null;
    }
  }
  if (voce) voci.push(voce);

  const complete = voci.filter((v) => v.merchant && v.importo && v.data);
  for (const v of complete) v.giorno = v.data.giorno;

  return numeraNelGiorno(complete).map((v) => componi({
    merchant: v.merchant,
    city: v.city ?? null,
    region: v.region ?? null,
    amount: v.importo.amount,
    occurredAt: inizioGiorno(v.giorno),
    timeKnown: false,
    posizione: v.posizione,
    source: 'app',
    // Senza la riga del luogo la forma non e' quella attesa: si legge, ma si
    // controlla.
    confidence: peggiore(v.importo.confidence, v.data.confidence, v.city ? 'high' : 'low'),
    rawText: v.righe.join('\n'),
  }));
}
