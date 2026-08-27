// Lettura dell'importo in formato italiano, con la tolleranza che serve all'OCR
// e non un grammo di piu'.
//
// La regola che governa tutto il file: quando il testo non e' inequivocabile
// l'importo si legge lo stesso, ma si torna `confidence: 'low'` e la voce finira'
// in revisione. Mai correggere in silenzio un numero che rappresenta soldi.

// Il simbolo dell'euro che l'OCR restituisce quando ci prende, e i caratteri in
// cui lo trasforma quando sbaglia.
const SIMBOLI = /[€CcEe£]/;
const PRE = /^([€CcEe£])\s*/;
const POST = /\s*([€CcEe£])$/;

/**
 * "1.234,56 €" -> { amount: 1234.56, confidence: 'high' }
 *
 * Ritorna `null` se la riga non e' un importo: e' quello che permette al parser
 * di usare l'importo come ancora della card senza rischiare falsi positivi sui
 * nomi degli esercenti.
 */
export function parseImporto(testo) {
  let s = String(testo ?? '').trim();
  if (!s) return null;

  // Il segno davanti all'importo lo scrive solo la lista movimenti dell'app, ed
  // e' l'unico posto in cui uno screenshot dice da solo se i soldi sono usciti o
  // entrati. Si stacca subito: sotto dev'esserci un numero come tutti gli altri,
  // e l'importo resta comunque positivo - il verso e' un fatto della
  // transazione, non della cifra.
  let segno = null;
  const conSegno = s.match(/^([+\u2212-])\s*/);
  if (conSegno) {
    segno = conSegno[1] === '+' ? 1 : -1;
    s = s.slice(conSegno[0].length);
  }

  // Il simbolo puo' stare prima o dopo, attaccato o staccato. Me lo segno e lo
  // tolgo: quello che resta deve essere solo un numero, e se non lo e' la riga
  // non era un importo. E' anche cio' che impedisce a "Caffe" di passare per un
  // importo con la C scambiata per un euro.
  let simbolo = null;
  const pre = s.match(PRE);
  if (pre) {
    simbolo = pre[1];
    s = s.slice(pre[0].length);
  }
  const post = s.match(POST);
  if (post) {
    simbolo = post[1];
    s = s.slice(0, s.length - post[0].length);
  }
  s = s.trim();
  if (!s || !/^[\d.,\s]+$/.test(s)) return null;

  let intero;
  let decimali;
  let sicuro = true;

  const virgola = s.lastIndexOf(',');
  if (virgola >= 0) {
    intero = s.slice(0, virgola).trim();
    decimali = s.slice(virgola + 1).trim();
    if (!/^\d{1,2}$/.test(decimali)) return null;
  } else if (/^(\d+)[.](\d{1,2})$/.test(s)) {
    // "4.00": il punto qui non puo' separare le migliaia, perche' dopo non ci
    // sono tre cifre. E' quasi certamente una virgola letta male, e "quasi" basta
    // per leggerla ma non per fidarsene.
    const m = s.match(/^(\d+)[.](\d{1,2})$/);
    intero = m[1];
    decimali = m[2];
    sicuro = false;
  } else {
    // Nessuna virgola e nessun punto decimale: o l'OCR ha perso i centesimi, o
    // non era un importo. Nel dubbio lo leggo intero e lo mando in revisione:
    // il telefono i centesimi li mostra sempre.
    intero = s;
    decimali = '0';
    sicuro = false;
  }

  const pulito = intero.replace(/[.\s]/g, '');
  if (!/^\d+$/.test(pulito)) return null;
  // Le migliaia, se ci sono, devono essere raggruppate a tre a tre. Un "12.34"
  // scritto come parte intera non e' un raggruppamento e non lo invento.
  if (/[.\s]/.test(intero) && !/^\d{1,3}(?:[.\s]\d{3})+$/.test(intero)) return null;

  const amount = Number(pulito) + Number(decimali.padEnd(2, '0')) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return null;

  if (simbolo !== '€') sicuro = false;

  return { amount, confidence: sicuro ? 'high' : 'low', simbolo, segno };
}

/** Vero se la riga somiglia a un importo. Comodita' per il parser. */
export function eImporto(testo) {
  return parseImporto(testo) !== null;
}

/** 1234.56 -> "1.234,56". Serve solo per mostrare, mai per confrontare. */
export function formattaImporto(amount) {
  return amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Una cifra in formato italiano da una colonna che contiene solo numeri.
 *
 * Diversa da `parseImporto`, che deve difendersi dall'OCR e nel dubbio segnala:
 * qui il numero arriva da un estratto conto, non da una fotografia, quindi non
 * c'e' niente di cui dubitare - o e' un numero o la cella e' vuota.
 */
export function parseCifra(testo) {
  const s = String(testo ?? '').trim().replace(/[\s€]/g, '');
  if (!s) return null;
  const normale = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  if (!/^-?\d+(\.\d+)?$/.test(normale)) return null;
  const n = Number(normale);
  return Number.isFinite(n) ? n : null;
}
