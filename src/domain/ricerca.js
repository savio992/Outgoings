// Trovare una spesa senza sapere in che mese cercarla.
//
// Il Registro e' organizzato per mese perche' le domande di tutti i giorni ne
// hanno uno dentro. Questa no: "quanto ho dato ad Anna", "quand'e' passato
// l'abbonamento", "quella spesa da 4,00 che non riconosco". Per quelle il mese
// e' proprio la cosa che non si sa.

import { categoriaDi } from './statistiche.js';

/** Minuscolo e senza accenti: "caffè" e "CAFFE" si devono trovare a vicenda. */
function piano(testo) {
  return String(testo ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Un importo scritto nella ricerca, se lo e'. "4", "4,00", "4.5", "1.234" e
 * "1.234,56" sono importi; "4 fontane" no, ed e' un nome.
 *
 * Il segno e il simbolo dell'euro si tolgono: nel registro gli importi sono
 * tutti positivi, e "-14,27" e' come la banca scrive una spesa da 14,27. Il
 * separatore in fondo e' un importo scritto a meta' - "12," prima di "12,50" -
 * e vale per quello che c'e' gia'.
 *
 * `centesimi` dice se i centesimi sono stati scritti: "4" trova tutte le spese
 * di quattro euro e qualcosa, "4,00" solo quelle da quattro esatti.
 */
function importoCercato(testo) {
  const s = String(testo ?? '').replace(/€/g, '').trim().replace(/^[-+]\s*/, '').replace(/[.,]$/, '');
  let normale;
  let centesimi = false;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) {
    normale = s.replace(/\./g, '').replace(',', '.');
    centesimi = s.includes(',');
  } else if (/^\d+([.,]\d{1,2})?$/.test(s)) {
    normale = s.replace(',', '.');
    centesimi = /[.,]/.test(s);
  } else {
    return null;
  }
  const n = Number(normale);
  return Number.isFinite(n) ? { n, centesimi } : null;
}

/** I filtri, con le stesse definizioni che il resto dell'app usa per contare. */
export const FILTRI = {
  tutti: () => true,
  spese: (t) => !t.entrata && !t.fissa,
  entrate: (t) => Boolean(t.entrata),
  fisse: (t) => Boolean(t.fissa) && !t.entrata,
  verificare: (t) => t.confidence === 'low',
  mano: (t) => t.source === 'manuale',
};

/**
 * Le righe che corrispondono a un testo e a un filtro, nell'ordine del registro.
 *
 * Il testo si cerca dappertutto dove una persona potrebbe averlo visto:
 * esercente, causale, citta', categoria. Un numero invece si cerca
 * sull'importo e solo li' - "4" che trova "Via 4 Novembre" sarebbe rumore.
 * Un importo intero trova tutte le spese di quegli euro (4 trova 4,00 e 4,50),
 * uno con i centesimi trova solo se stesso.
 */
export function cercaMovimenti(registro, { testo = '', filtro = 'tutti' } = {}, config = {}) {
  const passa = FILTRI[filtro] ?? FILTRI.tutti;
  const cifra = importoCercato(testo);
  const parole = piano(testo).split(' ').filter(Boolean);

  return (registro ?? []).filter((t) => {
    if (!passa(t)) return false;
    if (!parole.length) return true;
    if (cifra !== null) {
      return cifra.centesimi
        ? Math.abs(t.amount - cifra.n) < 0.005
        : Math.floor(t.amount) === Math.floor(cifra.n);
    }
    const dove = piano([t.merchant, t.causale, t.city, t.region, categoriaDi(t, config)]
      .filter(Boolean).join(' '));
    return parole.every((p) => dove.includes(p));
  });
}

/** Quante sono e quanto fanno, con il segno messo dove sta: entrate a parte. */
export function sommaMovimenti(righe) {
  const tonda = (n) => Number((Math.round(n * 100) / 100).toFixed(2));
  return {
    quante: righe.length,
    uscite: tonda(righe.filter((t) => !t.entrata).reduce((s, t) => s + t.amount, 0)),
    entrate: tonda(righe.filter((t) => t.entrata).reduce((s, t) => s + t.amount, 0)),
  };
}
