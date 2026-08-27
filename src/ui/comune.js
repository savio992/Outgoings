// Mattoncini condivisi fra le viste. Niente framework: creare elementi a mano
// costa poche righe e non va aggiornato ogni sei mesi.

export function el(tag, attributi = {}, figli = []) {
  const nodo = document.createElement(tag);
  for (const [k, v] of Object.entries(attributi)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') nodo.className = v;
    else if (k === 'testo') nodo.textContent = v;
    else if (k.startsWith('on')) nodo.addEventListener(k.slice(2), v);
    else nodo.setAttribute(k, v === true ? '' : v);
  }
  for (const f of [].concat(figli)) {
    if (f) nodo.append(typeof f === 'string' ? document.createTextNode(f) : f);
  }
  return nodo;
}

const EURO = new Intl.NumberFormat('it-IT', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2,
});

export const euro = (n) => EURO.format(n ?? 0);

/** Senza centesimi, per i numeri grandi che devono restare leggibili. */
export const euroTondo = (n) => EURO.format(Math.round(n ?? 0)).replace(/,00/, '');

const GIORNI_LUNGHI = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome',
});

export function oggiIso(adesso = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(adesso);
  return p;
}

/** "Oggi", "Ieri", oppure "lunedi' 24 agosto". */
export function nomeGiorno(giorno, riferimento = oggiIso()) {
  if (giorno === riferimento) return 'Oggi';
  const ieri = new Date(Date.parse(riferimento + 'T12:00:00Z') - 86400000)
    .toISOString().slice(0, 10);
  if (giorno === ieri) return 'Ieri';
  return GIORNI_LUNGHI.format(new Date(giorno + 'T12:00:00Z'));
}

// Otto tinte scelte a mano invece di una hue calcolata: l'HSL a caso produce
// prima o poi il verde acido e il fucsia, e la lista smette di sembrare
// disegnata da qualcuno.
const TINTE = [
  '#c2620f', '#1d7a5f', '#8f4fa8', '#2563a8',
  '#a8323f', '#7a6410', '#3f6d8f', '#8a4a2a',
];

/** Sempre la stessa tinta per lo stesso esercente, senza tenerla da parte. */
export function tinta(nome) {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return TINTE[h % TINTE.length];
}

/** Le iniziali, al massimo due: "Gocce Di Caffe" -> "GC". */
export function iniziali(nome) {
  const parole = String(nome ?? '').trim().split(/\s+/).filter((p) => /[a-zA-Z0-9]/.test(p));
  if (!parole.length) return '?';
  if (parole.length === 1) return parole[0].slice(0, 2).toUpperCase();
  return (parole[0][0] + parole[parole.length - 1][0]).toUpperCase();
}

/**
 * Legge un numero scritto a mano, all'italiana o all'inglese.
 *
 * I campi non possono essere `type="number"`: la tastiera decimale italiana da'
 * la virgola, e un campo numerico che riceve una virgola restituisce stringa
 * vuota. Si scrive "12,50" e si ottiene zero, senza un errore da nessuna parte.
 * Quindi il campo e' di testo e la conversione la si fa qui.
 *
 * Con la virgola presente i punti sono separatori di migliaia ("1.234,56"); da
 * solo, il punto e' decimale ("12.50"), che e' il modo in cui lo scriverebbe
 * chi ha la tastiera in inglese.
 */
export function leggiNumero(testo) {
  const s = String(testo ?? '').trim().replace(/[\s€]/g, '');
  if (!s) return 0;
  const normale = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normale);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

const DATA_BREVE = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** "1 agosto". Senza l'anno: negli estratti conto e' sempre quello corrente. */
export function dataBreve(giorno) {
  return DATA_BREVE.format(new Date(giorno + 'T12:00:00Z'));
}

const MESE_LUNGO = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "agosto 2026", con l'iniziale maiuscola. */
export function nomeMese(mese) {
  const t = MESE_LUNGO.format(new Date(mese + '-01T12:00:00Z'));
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function icona(percorso) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', percorso);
  svg.append(p);
  return svg;
}

export const ICONE = {
  oggi: 'M12 3a9 9 0 1 0 9 9M12 7v5l3 2',
  registro: 'M4 6h16M4 12h16M4 18h10',
  analisi: 'M5 20V11M12 20V4M19 20v-6',
  budget: 'M3 7h18v12H3zM3 7l2-3h14l2 3M9 12h6',
};

/** Il giorno della settimana in una lettera sola: L M M G V S D. */
const SIGLA = new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' });
export function siglaGiorno(giorno) {
  return SIGLA.format(new Date(giorno + 'T12:00:00Z')).charAt(0).toUpperCase();
}

/** Numeri che salgono: fa sembrare vivo un numero che altrimenti compare e basta. */
export function anima(nodo, a, disegna, durata = 700) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    nodo.textContent = disegna(a);
    return;
  }
  const inizio = performance.now();
  const passo = (ora) => {
    const t = Math.min(1, (ora - inizio) / durata);
    // Frenata morbida: parte veloce e si posa, invece di arrivare di colpo.
    nodo.textContent = disegna(a * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}
