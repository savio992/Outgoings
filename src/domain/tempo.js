// Risoluzione del tempo relativo delle notifiche iOS in un istante assoluto.
//
// E' il modulo piu' delicato della v1 ed e' anche l'unico che nasce gia' destinato
// a morire: l'ANCS espone un attributo Date assoluto, quindi quando arrivera'
// l'ESP32 tutto questo file diventera' inutile. Sta in un file suo apposta, per
// poterlo togliere senza toccare nient'altro.

export const ZONA = 'Europe/Rome';

// Indici di Date#getUTCDay: domenica e' 0.
const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

const GIORNO_MS = 86400000;

const FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** L'orologio da parete italiano in un dato istante. */
function partiLocali(ts) {
  const p = {};
  for (const { type, value } of FMT.formatToParts(ts)) {
    if (type !== 'literal') p[type] = Number(value);
  }
  return p;
}

/** Offset della zona, in millisecondi, valido nell'istante dato. */
function offset(ts) {
  const p = partiLocali(ts);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts;
}

/**
 * Istante UTC corrispondente a un orario da parete italiano.
 *
 * Serve una correzione in due passi perche' l'offset da applicare dipende
 * dall'istante che stiamo ancora cercando. Si parte trattando l'orario come se
 * fosse UTC, si legge l'offset da quelle parti e si ricontrolla:
 *
 *  - nell'ora ripetuta di fine ottobre i due passi concordano, e viene scelta la
 *    seconda delle due occorrenze, quella gia' in ora solare;
 *  - nell'ora saltata di fine marzo non concordano, vince il secondo e l'orario
 *    inesistente scivola in avanti.
 *
 * Nessuno dei due casi puo' capitare davvero in una notifica (il telefono non
 * mostra orari che non sono esistiti), ma la funzione deve restare totale.
 */
export function istanteLocale(anno, mese, giorno, ora, minuto) {
  const comeSeUtc = Date.UTC(anno, mese - 1, giorno, ora, minuto);
  const primo = offset(comeSeUtc);
  const ts = comeSeUtc - primo;
  const secondo = offset(ts);
  return secondo === primo ? ts : comeSeUtc - secondo;
}

const due = (n) => String(n).padStart(2, '0');

/**
 * ISO 8601 con l'offset italiano esplicito, secondi sempre azzerati.
 *
 * I secondi si buttano di proposito: la notifica non li espone e la chiave di
 * dedup arriva al minuto. Azzerarli qui e' cio' che permette alla stessa spesa,
 * vista prima da uno screenshot e poi dall'ANCS (che i secondi ce li ha), di
 * produrre lo stesso identificatore invece di sdoppiarsi.
 */
export function isoRoma(ts) {
  const p = partiLocali(ts);
  const off = offset(ts);
  const segno = off >= 0 ? '+' : '-';
  const minuti = Math.abs(off) / 60000;
  return `${p.year}-${due(p.month)}-${due(p.day)}T${due(p.hour)}:${due(p.minute)}:00`
    + `${segno}${due(Math.floor(minuti / 60))}:${due(minuti % 60)}`;
}

/** Il giorno italiano, "YYYY-MM-DD", di un istante. */
export function giornoLocale(ts) {
  const p = partiLocali(ts);
  return `${p.year}-${due(p.month)}-${due(p.day)}`;
}

/** Un'ora precisa di un giorno "YYYY-MM-DD", in ISO con l'offset italiano. */
export function isoDelGiorno(giorno, ora = 0, minuto = 0) {
  const [a, m, g] = String(giorno).split('-').map(Number);
  return isoRoma(istanteLocale(a, m, g, ora, minuto));
}

/** Mezzanotte italiana di un giorno: l'istante delle spese senza orario. */
export const inizioGiorno = (giorno) => isoDelGiorno(giorno);

const RE_ORA = /\b(\d{1,2})([:.])(\d{2})\b/;
const RE_IERI = /\bieri\b/i;

/** Vero se la riga contiene qualcosa che somiglia a un orario. */
export function contieneOra(riga) {
  return RE_ORA.test(String(riga ?? ''));
}

/**
 * Traduce il tempo relativo di una notifica in un istante assoluto.
 *
 * Accetta la riga di intestazione per intero ("Poste Italiane   08:06"): il nome
 * dell'app e gli spazi non danno fastidio, e cosi' il chiamante non deve sapere
 * se l'OCR ha tenuto le due cose sulla stessa riga o le ha separate.
 *
 * Ritorna `null` se non c'e' un orario: e' il segnale che la card e' tagliata.
 */
export function risolviTempo(riga, catturatoIl) {
  const testo = String(riga ?? '');
  const m = testo.match(RE_ORA);
  if (!m) return null;

  const ora = Number(m[1]);
  const minuto = Number(m[3]);
  if (ora > 23 || minuto > 59) return null;

  // I due punti letti come punto sono una svista d'OCR plausibile, non un
  // formato: accetto la riga ma non me ne fido.
  let sicuro = m[2] === ':';

  const riferimento = catturatoIl instanceof Date ? catturatoIl.getTime() : Number(catturatoIl);
  if (!Number.isFinite(riferimento)) return null;
  const oggi = partiLocali(riferimento);
  const dataOggi = Date.UTC(oggi.year, oggi.month - 1, oggi.day);

  let indietro;
  if (RE_IERI.test(testo)) {
    indietro = 1;
  } else {
    const g = testo.toLowerCase().match(/\b(dom|lun|mar|mer|gio|ven|sab)\b/);
    if (g) {
      // Il giorno della settimana significa "l'ultima volta che e' stato quel
      // giorno, prima di oggi": da un martedi' `lun` e' ieri, da una domenica e'
      // sei giorni fa. Lo stesso giorno di oggi vale una settimana intera, non
      // zero, perche' per oggi il telefono mostrerebbe solo l'ora.
      const cercato = GIORNI.indexOf(g[1]);
      const corrente = new Date(dataOggi).getUTCDay();
      indietro = (corrente - cercato + 7) % 7 || 7;
    } else {
      indietro = 0;
    }
  }

  const data = new Date(dataOggi - indietro * GIORNO_MS);
  const ts = istanteLocale(
    data.getUTCFullYear(),
    data.getUTCMonth() + 1,
    data.getUTCDate(),
    ora,
    minuto,
  );

  // Un'ora sola, senza giorno, vuol dire oggi. Se pero' cade nel futuro rispetto
  // allo scatto, lo screenshot e' piu' vecchio di quanto sembra e la data che ne
  // deduco e' sbagliata di almeno un giorno. Non la aggiusto a indovinare: la
  // marco e la faccio confermare a mano.
  if (indietro === 0 && ts > riferimento) sicuro = false;

  return { occurredAt: isoRoma(ts), ts, confidence: sicuro ? 'high' : 'low' };
}

// ---------------------------------------------------------------------------
// La lista dell'app Poste parla un'altra lingua: niente orario, giorni per
// esteso, e il piu' recente espresso come distanza ("14 ore fa"). Si risolve
// alla granularita' del giorno e basta - l'ora non c'e' e non la si inventa.

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

const GIORNI_INTERI = ['domenica', 'lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato'];

/** Via gli accenti, cosi' "Lunedi'" e "Lunedi" sono la stessa parola. */
function senzaAccenti(testo) {
  return String(testo ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Il giorno di una riga della lista dell'app, o `null` se la forma non e' fra
 * quelle note.
 *
 * Tornare `null` e' voluto: e' cio' che fa saltare la riga invece di attribuirle
 * una data inventata. Una forma nuova si vede subito, perche' quelle spese non
 * compaiono, e non perche' compaiono sbagliate.
 *
 * Le distanze ("14 ore fa") sono troncate per difetto dall'app, quindi indicano
 * una finestra larga quanto l'unita' usata, non un istante: catturando alle
 * 23:02 un acquisto delle 08:06 diventa "14 ore fa", che ricostruito darebbe le
 * 09:02. Per il giorno non e' un problema - tranne quando la finestra scavalca
 * la mezzanotte, e allora nemmeno il giorno e' certo e va marcato.
 */
export function risolviGiornoApp(testo, catturatoIl) {
  const t = senzaAccenti(testo);
  if (!t) return null;

  const riferimento = catturatoIl instanceof Date ? catturatoIl.getTime() : Number(catturatoIl);
  if (!Number.isFinite(riferimento)) return null;

  const certo = (giorno) => ({ giorno, confidence: 'high' });

  /** La finestra di incertezza di una distanza troncata, larga una unita'. */
  const finestra = (quante, unita) => {
    const recente = giornoLocale(riferimento - quante * unita);
    const remoto = giornoLocale(riferimento - (quante + 1) * unita);
    return { giorno: recente, confidence: recente === remoto ? 'high' : 'low' };
  };

  if (/^adesso$/.test(t) || /^oggi$/.test(t)) return certo(giornoLocale(riferimento));

  const minuti = t.match(/^(\d+)\s+minut[oi]\s+fa$/);
  if (minuti) return finestra(Number(minuti[1]), 60000);

  const ore = t.match(/^(\d+)\s+or[ae]\s+fa$/);
  if (ore) return finestra(Number(ore[1]), 3600000);

  const giorniFa = t.match(/^(\d+)\s+giorn[oi]\s+fa$/);
  if (giorniFa) return finestra(Number(giorniFa[1]), GIORNO_MS);

  const oggi = partiLocali(riferimento);
  const dataOggi = Date.UTC(oggi.year, oggi.month - 1, oggi.day);

  // "leri" al posto di "Ieri" non e' un refuso: nel font di sistema la I
  // maiuscola e' un'asta verticale identica alla l minuscola, e l'OCR le
  // scambia. Nella lista la riga della data sta da sola, quindi accettarle
  // entrambe non puo' rubare il posto a un esercente.
  if (/^[il1]eri$/.test(t)) return certo(giornoLocale(istanteLocale(oggi.year, oggi.month, oggi.day - 1, 12, 0)));

  const settimana = GIORNI_INTERI.indexOf(t);
  if (settimana >= 0) {
    // Stessa regola delle notifiche: l'ultima volta che e' stato quel giorno,
    // prima di oggi. Oggi si chiamerebbe "Adesso" o "N ore fa", non col nome.
    const indietro = (new Date(dataOggi).getUTCDay() - settimana + 7) % 7 || 7;
    const d = new Date(dataOggi - indietro * GIORNO_MS);
    return certo(giornoLocale(istanteLocale(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 12, 0)));
  }

  // Piu' indietro di una settimana l'app scrive la data per esteso. Senza anno
  // si prende l'ultima occorrenza passata, non quella futura.
  const data = t.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/);
  if (data) {
    const mese = MESI.indexOf(data[2]) + 1;
    if (!mese) return null;
    const g = Number(data[1]);
    if (g < 1 || g > 31) return null;
    let anno = data[3] ? Number(data[3]) : oggi.year;
    if (!data[3] && (mese > oggi.month || (mese === oggi.month && g > oggi.day))) anno -= 1;
    return certo(giornoLocale(istanteLocale(anno, mese, g, 12, 0)));
  }

  return null;
}

/** Vero se la riga e' una data della lista dell'app. Chiude la riga nel parser. */
export function eGiornoApp(testo, catturatoIl) {
  return risolviGiornoApp(testo, catturatoIl) !== null;
}
