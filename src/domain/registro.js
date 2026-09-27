// Il registro: identita' delle transazioni, dedup, e il totale del giorno.
//
// Qui sta la decisione che rende la v2 un innesto invece che una riscrittura.
// Il registro canonico e' un file JSONL append-only, e ci si entra da una sola
// porta: `merge`. Lo screenshot di oggi e l'ESP32 di domani sono due chiamanti
// della stessa funzione, non due percorsi paralleli. Anche quello che scrivi tu
// a mano passa di li'.

import { inizioGiorno } from './tempo.js';

/**
 * FNV-1a a 32 bit, applicato due volte con semi diversi per avere 64 bit di
 * spazio. Serve un identificatore deterministico e identico fra Node e browser,
 * non una funzione crittografica: qui non c'e' niente da proteggere, solo da
 * riconoscere.
 */
function fnv(testo, seme) {
  let h = seme;
  for (let i = 0; i < testo.length; i++) {
    h ^= testo.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Il nome dell'esercente ridotto a cio' che due letture della stessa notifica
 * devono avere in comune: maiuscole, spazi doppi e punti finali non fanno parte
 * dell'identita'. Piu' in la' di cosi' non si normalizza, o due esercenti diversi
 * finiscono per collidere.
 */
export function normalizzaEsercente(nome) {
  return String(nome ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/, '')
    .trim();
}

/**
 * Le parole di un nome, minuscole, senza accenti e **ordinate**.
 *
 * L'ordine buttato via e' il punto: la banca scrive "BIANCHI ANNA" nei bonifici
 * ricevuti e "Anna Bianchi" in quelli inviati, e sono la stessa persona. Non
 * serve sapere quale parola sia il nome e quale il cognome - basta che le
 * parole siano le stesse.
 *
 * E' piu' larga di `normalizzaEsercente`, che decide l'identita' di una
 * transazione: li' due nomi che collidono per sbaglio fondono due spese in una,
 * qui fanno solo una riga di troppo in una classifica. Il prezzo dell'errore e'
 * diverso, e quindi lo e' anche la soglia.
 */
export function impronta(nome) {
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
 * parita' la prima in ordine alfabetico, perche' due letture degli stessi dati
 * devono dare lo stesso risultato.
 */
export function grafiaMigliore(forme) {
  const meglio = (a, b) => {
    const maiuscoloA = a === a.toUpperCase() ? 1 : 0;
    const maiuscoloB = b === b.toUpperCase() ? 1 : 0;
    return maiuscoloA - maiuscoloB || (a < b ? -1 : a > b ? 1 : 0);
  };
  return [...forme].sort(meglio)[0] ?? null;
}

/**
 * Chiave di dedup: esercente, importo e minuto.
 *
 * `source` non entra nell'hash, ed e' voluto. Se la stessa spesa arriva prima da
 * uno screenshot e poi dall'ESP32, deve collidere e restare una riga sola.
 * Metterci dentro la sorgente e' l'errore di cui ci si accorge sei mesi dopo, a
 * registro gia' sporco e senza modo di ripulirlo.
 */
export function idTransazione({ merchant, amount, occurredAt, posizione, operazione }) {
  // Quando la sorgente ha gia' un identificativo suo - il numero d'operazione
  // della banca - si usa quello. E' piu' forte di qualsiasi chiave ricostruita:
  // due acquisti gemelli, stesso esercente stesso importo nello stesso minuto,
  // per la banca restano due operazioni distinte mentre per una chiave dedotta
  // dai campi sarebbero la stessa.
  if (operazione) return fnv(`op|${operazione}`, 0x811c9dc5).toString(16).padStart(8, '0')
    + fnv(`op|${operazione}`, 0x9dc5811c).toString(16).padStart(8, '0');

  const chiave = [
    normalizzaEsercente(merchant),
    Number(amount).toFixed(2),
    String(occurredAt).slice(0, 16), // "2026-08-26T08:06", cioe' fino al minuto
    // Serve solo alla lista dell'app, che l'orario non ce l'ha: distingue due
    // spese identiche nello stesso giorno. Per le altre sorgenti e' sempre 0,
    // quindi non cambia nulla e la collisione fra screenshot e ANCS regge.
    String(posizione ?? 0),
  ].join('|');
  return fnv(chiave, 0x811c9dc5).toString(16).padStart(8, '0')
    + fnv(chiave, 0x9dc5811c).toString(16).padStart(8, '0');
}

/** Ordine di lettura: la spesa piu' recente in cima, a parita' l'id per stabilita'. */
function perData(a, b) {
  const d = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
  if (d !== 0) return d;
  // A parita' di giorno la posizione conserva l'ordine in cui l'app le mostra:
  // la piu' alta e' la piu' recente.
  const o = (b.posizione ?? 0) - (a.posizione ?? 0);
  return o !== 0 ? o : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * L'intervallo che l'estratto conto ha gia' riscritto, se ce n'e' uno.
 *
 * Si ricava dal registro invece di essere salvato a parte: cosi' resta vero
 * anche dopo una cancellazione o un ripristino da backup, e non c'e' un secondo
 * stato da tenere allineato al primo.
 */
export function periodoBanca(registro) {
  const giorni = (registro ?? []).filter((t) => t.source === 'banca').map(giornoDi).sort();
  return giorni.length ? { da: giorni[0], a: giorni[giorni.length - 1] } : null;
}

/**
 * Vero per cio' che, dentro il periodo dell'estratto conto, la banca conosce
 * meglio di noi.
 *
 * Le letture automatiche si', quello che scrivi tu a mano no. Non e' una
 * cortesia: una spesa in contanti nell'estratto conto non c'e' e non ci sara'
 * mai - li' dentro c'e' il prelievo, non il caffe' - quindi cancellarla perche'
 * "quel periodo lo copre la banca" vorrebbe dire buttare via l'unico posto in
 * cui quel dato esiste. Vale lo stesso per l'accredito che ti ha girato un
 * amico e per la spesa che l'app non ha mai visto passare.
 *
 * La regola generale si ripara da sola - se una lettura scartata era una spesa
 * vera, il prossimo estratto conto la riporta dentro - ma qui non si
 * riparerebbe: nessun import futuro rimettera' mai quella riga.
 */
const laRiscriveLaBanca = (t) => t.source !== 'banca' && t.source !== 'manuale';

/**
 * L'unica porta d'ingresso del registro.
 *
 * Idempotente per costruzione: rifare lo screenshot senza aver svuotato il
 * Centro Notifiche rivede le stesse transazioni, e devono finire in `duplicate`
 * senza toccare il registro. Non modifica gli argomenti.
 *
 * L'id da solo non basta a riconoscere la stessa spesa vista da due sorgenti
 * diverse, e non e' un difetto sistemabile con un hash migliore: l'estratto
 * conto porta il numero d'operazione, che vale come identita' ed e' piu' forte
 * di qualsiasi chiave dedotta dai campi, mentre una notifica quel numero non ce
 * l'ha e non potra' mai averlo. E nemmeno confrontare i campi funzionerebbe: la
 * banca chiama "FAMILA MEGAGEST" il posto che nella notifica e' "Famila
 * Bistro'", ed e' esattamente il motivo per cui dentro il suo periodo
 * l'estratto conto riscrive invece di abbinare.
 *
 * Quindi la stessa regola vale anche in senso inverso: una lettura che cade
 * dentro il periodo gia' coperto dall'estratto conto e' roba che la banca ha
 * gia', e non entra. Sbagliare da questa parte si ripara da solo - se davvero
 * era una spesa che la banca non aveva ancora contabilizzato, il prossimo
 * estratto conto la porta dentro, perche' quel periodo lo riscrive lui.
 *
 * L'unica cosa che quel periodo non tocca e' cio' che hai scritto tu: vedi
 * `laRiscriveLaBanca`.
 */
export function merge(registro, nuove) {
  const coperto = periodoBanca(registro);
  const visti = new Set();
  for (const t of registro ?? []) {
    // Un id mancante non deve entrare nell'insieme: `has(undefined)` sarebbe
    // vero per ogni altra riga senza id, e un intero import collasserebbe in
    // una transazione sola.
    if (t.id) visti.add(t.id);
    // Una spesa corretta a mano cambia identita', perche' l'id nasce dai campi.
    // Senza ricordare quella vecchia, il reimport della stessa schermata
    // rimetterebbe dentro l'originale sbagliato accanto alla correzione - e la
    // fatica di correggere sarebbe da rifare a ogni import.
    if (t.idOriginale) visti.add(t.idOriginale);
  }
  const aggiunte = [];
  const duplicate = [];
  const coperte = [];
  for (const t of nuove ?? []) {
    if (t.id && visti.has(t.id)) {
      duplicate.push(t);
      continue;
    }
    if (coperto && laRiscriveLaBanca(t)
      && giornoDi(t) >= coperto.da && giornoDi(t) <= coperto.a) {
      coperte.push(t);
      continue;
    }
    visti.add(t.id);
    aggiunte.push(t);
  }
  return {
    registro: [...(registro ?? []), ...aggiunte].sort(perData),
    aggiunte,
    duplicate,
    // Non e' un duplicato: e' una spesa che l'estratto conto conosce meglio.
    // Contarle insieme direbbe "erano gia' nel registro", che non e' vero e non
    // spiegherebbe perche' con lo stesso screenshot un'altra volta ne entrano
    // sei e stavolta tre.
    coperte,
  };
}

/** Il registro come JSONL, una transazione per riga, pronto per iCloud Drive. */
export function aJsonl(registro) {
  return (registro ?? []).map((t) => JSON.stringify(t)).join('\n') + '\n';
}

/**
 * Rilegge un JSONL. Le righe illeggibili si saltano invece di far fallire tutto:
 * un file troncato da una sincronizzazione a meta' deve restituire le spese che
 * ci sono, non zero.
 */
export function daJsonl(testo) {
  const fuori = [];
  for (const riga of String(testo ?? '').split(/\r?\n/)) {
    if (!riga.trim()) continue;
    try {
      const t = JSON.parse(riga);
      if (t && typeof t.id === 'string' && typeof t.amount === 'number') fuori.push(t);
    } catch {
      // riga corrotta: la si perde, non si indovina
    }
  }
  return fuori.sort(perData);
}

/** Il giorno italiano di una transazione, "YYYY-MM-DD". */
export function giornoDi(t) {
  return String(t.occurredAt).slice(0, 10);
}

/**
 * Vero solo per le spese che consumano il tetto giornaliero.
 *
 * Restano fuori gli accrediti, che spese non sono, e le uscite fisse - affitto,
 * bollette, commissioni - che sono spese vere ma non quotidiane: contarle nella
 * media renderebbe il tetto inutile proprio nel giorno in cui cadono, che e' il
 * giorno in cui non hai fatto niente di diverso dal solito.
 *
 * Le transazioni piu' vecchie non hanno questi due campi: senza, valgono spese
 * variabili, che e' quello che erano.
 */
export function eSpesaVariabile(t) {
  return !t.entrata && !t.fissa;
}

/**
 * Quanto si e' speso in un giorno.
 *
 * Funzione pura, e volutamente indipendente da come l'avviso verra' consegnato:
 * un banner nella pagina, un'automazione Shortcuts che legge il file di stato, o
 * un domani una push. La soglia si decide qui, la consegna altrove.
 */
export function totaleDelGiorno(registro, giorno) {
  return (registro ?? [])
    .filter((t) => giornoDi(t) === giorno && eSpesaVariabile(t))
    .reduce((s, t) => s + t.amount, 0);
}

/** Lo stato del giorno rispetto a una soglia, per chi deve avvisare. */
export function statoSoglia(registro, giorno, soglia) {
  const totale = Number(totaleDelGiorno(registro, giorno).toFixed(2));
  const limite = Number(soglia) || 0;
  return {
    giorno,
    totale,
    soglia: limite,
    superata: limite > 0 && totale > limite,
    residuo: Number(Math.max(0, limite - totale).toFixed(2)),
  };
}

/**
 * Sostituisce una spesa con la sua versione corretta a mano.
 *
 * L'id si ricalcola dai campi nuovi, ma quello vecchio resta scritto in
 * `idOriginale`: e' cosi' che `merge` riconoscera' l'originale se lo screenshot
 * viene reimportato. Una correzione vale piu' di una lettura, quindi la spesa
 * esce da qui con la fiducia piena.
 */
export function correggi(registro, id, campi) {
  const vecchia = (registro ?? []).find((t) => t.id === id);
  if (!vecchia) return registro ?? [];

  const aggiornata = {
    ...vecchia,
    ...campi,
    confidence: 'high',
    correttaAMano: true,
    idOriginale: vecchia.idOriginale ?? vecchia.id,
  };
  aggiornata.id = idTransazione(aggiornata);

  return (registro ?? []).map((t) => (t.id === id ? aggiornata : t)).sort(perData);
}

/** Toglie una spesa dal registro. */
export function elimina(registro, id) {
  return (registro ?? []).filter((t) => t.id !== id);
}

/**
 * Il numero d'ordine libero per una spesa scritta a mano in un certo giorno.
 *
 * Senza, due caffe' da 1,50 € pagati in contanti lo stesso giorno avrebbero lo
 * stesso id - stesso nome, stesso importo, stessa mezzanotte - e il secondo
 * sparirebbe dentro il primo come duplicato. E' lo stesso mestiere che
 * `numeraNelGiorno` fa per la lista dell'app, ma qui il numero si prende una
 * riga alla volta, perche' una riga alla volta e' come arrivano.
 */
function prossimaPosizione(registro, giorno) {
  let massima = -1;
  for (const t of registro ?? []) {
    if (giornoDi(t) === giorno) massima = Math.max(massima, t.posizione ?? 0);
  }
  return massima + 1;
}

/**
 * Gli esercenti che hai gia' scritto a mano, dal piu' recente.
 *
 * Sono l'unica lista che ha senso proporre quando si scrive una spesa nuova: le
 * altre sorgenti portano nomi che non riscriveresti mai a mano ("WWW.AMAZON.IT"),
 * mentre il bar dei contanti si ripete. E serve piu' a scrivere lo stesso nome
 * *identico* che a risparmiare i tocchi: "Bar Gocce" e "Bar gocce" nelle
 * classifiche diventano due posti, e a quel punto nessuno dei due totali e' il
 * totale di quel bar.
 */
export function esercentiAMano(registro, quanti = 6) {
  const visti = [];
  for (const t of registro ?? []) {
    if (t.source !== 'manuale' || !t.merchant) continue;
    if (!visti.includes(t.merchant)) visti.push(t.merchant);
    if (visti.length >= quanti) break;
  }
  return visti;
}

/**
 * Una spesa scritta a mano, pronta per `merge`. `null` se non lo e'.
 *
 * Non e' una sorgente di ripiego: e' l'unica che possa contenere i contanti, che
 * nell'estratto conto non compaiono mai - li' dentro c'e' il prelievo - e le
 * spese che l'app non ha mai visto passare. Per questo `source: 'manuale'` non
 * e' solo un'etichetta: e' cio' che tiene la riga al riparo dalla riscrittura
 * dell'estratto conto.
 *
 * Esce con la fiducia piena e senza orario. Non chiedere il minuto e' una
 * scelta: e' l'unico campo che non serve a niente qui - il tetto e' del giorno,
 * non dell'ora - e chiederlo vorrebbe dire un campo in piu' fra te e il caffe'
 * che vuoi segnare. A distinguere due spese gemelle ci pensa `posizione`.
 */
export function transazioneAMano({ merchant, amount, giorno, fissa = false }, registro = []) {
  const nome = String(merchant ?? '').trim().replace(/\s+/g, ' ');
  const cifra = Math.round(Number(amount) * 100) / 100;
  if (!nome || !Number.isFinite(cifra) || cifra <= 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(giorno ?? ''))) return null;

  const campi = {
    merchant: nome,
    amount: cifra,
    occurredAt: inizioGiorno(giorno),
    timeKnown: false,
    posizione: prossimaPosizione(registro, giorno),
    entrata: false,
    fissa: Boolean(fissa),
    source: 'manuale',
    confidence: 'high',
  };
  return { ...campi, id: idTransazione(campi) };
}

// --------------------------------------------------------------------------
// Il backup completo.
//
// Il JSONL resta quello che e': il registro canonico, una spesa per riga, a cui
// domani l'ESP32 potra' accodare. Mettergli dentro anche le impostazioni lo
// rovinerebbe proprio come formato appendibile.
//
// Il backup e' quindi un file a parte che contiene entrambi. Serve a spostarsi
// su un altro dispositivo - iPhone e iPad hanno depositi separati, e iCloud non
// sincronizza il localStorage dei siti - e serve anche da backup vero: senza le
// impostazioni, chi ricomincia da un file si ritrova il registro giusto e un
// tetto giornaliero a zero.

export const FORMATO_BACKUP = 'briciole/1';

export function aBackup(registro, config) {
  return JSON.stringify({
    formato: FORMATO_BACKUP,
    salvatoIl: new Date().toISOString(),
    config: config ?? {},
    registro: registro ?? [],
  }, null, 1);
}

/**
 * Rilegge un backup, o `null` se quel testo non e' un backup.
 *
 * Tornare `null` invece di lanciare permette a chi importa di riprovare con il
 * JSONL semplice, senza chiedere a nessuno che formato abbia il file.
 */
export function daBackup(testo) {
  let dati;
  try {
    dati = JSON.parse(testo);
  } catch {
    return null;
  }
  if (!dati || dati.formato !== FORMATO_BACKUP || !Array.isArray(dati.registro)) return null;

  return {
    // Le righe passano dallo stesso filtro del JSONL: un backup manomesso o
    // troncato non deve poter infilare spese senza importo.
    registro: daJsonl(dati.registro.map((t) => JSON.stringify(t)).join('\n')),
    config: dati.config && typeof dati.config === 'object' ? dati.config : null,
  };
}

/**
 * Riscrive un intervallo di giorni con quello che dice la banca.
 *
 * L'estratto conto e' piu' completo e piu' preciso degli screenshot, e chiama
 * gli esercenti in un altro modo ("FAMILA MEGAGEST" dove la notifica dice
 * "Famila Bistro'"), quindi le due letture della stessa spesa non si
 * riconoscono fra loro. Invece di provare ad abbinarle a naso - e sbagliare in
 * silenzio - dentro il periodo coperto vince la banca e basta.
 *
 * Fuori dall'intervallo non si tocca niente: le spese di oggi lette da uno
 * screenshot restano, ed e' giusto, perche' la banca le contabilizzera' fra
 * qualche giorno.
 */
export function sostituisciPeriodo(registro, nuove, da, a) {
  const dentro = (t) => {
    const g = giornoDi(t);
    return g >= da && g <= a;
  };

  // Da togliere e' cio' che sta nel periodo *ed e' riscrivibile*: quello che hai
  // scritto tu resta dov'e'. Toglierlo sarebbe una cancellazione silenziosa di
  // un dato che nessun import potra' rimettere. La distinzione vale solo qui:
  // le righe che *arrivano* si filtrano per il solo periodo, altrimenti
  // l'estratto conto - che per definizione non si riscrive da se' - non
  // entrerebbe mai.
  const daTogliere = (t) => dentro(t) && laRiscriveLaBanca(t);

  const rimosse = (registro ?? []).filter(daTogliere);
  const tenute = (registro ?? []).filter((t) => !daTogliere(t));

  // Anche dentro il periodo il dedup serve: reimportare due volte lo stesso
  // estratto conto non deve dipendere dall'aver cancellato prima.
  const esito = merge(tenute, nuove.filter(dentro));
  return { registro: esito.registro, aggiunte: esito.aggiunte, rimosse };
}

/** Il mese "YYYY-MM" di una transazione. */
export const meseDi = (t) => String(t.occurredAt).slice(0, 7);

/**
 * I mesi che le viste a mese possono mostrare, dal piu' recente.
 *
 * Sono quelli con dentro qualcosa, piu' - se glielo si dice - il mese di oggi
 * anche quando e' ancora vuoto. Il primo del mese il registro non ha ancora
 * niente del mese nuovo, e senza questo l'app resta ferma su quello prima con
 * la freccia avanti spenta: l'intestazione dice "1 settembre" e sotto non c'e'
 * modo di arrivarci. Un mese vuoto che dice di esserlo e' un'informazione; un
 * mese irraggiungibile sembra un guasto.
 *
 * `oggi` arriva come argomento e non dall'orologio, come tutto qui dentro.
 */
export function mesiDelRegistro(registro, oggi) {
  const mesi = new Set((registro ?? []).map(meseDi));
  if (oggi) mesi.add(String(oggi).slice(0, 7));
  return [...mesi].sort().reverse();
}

/** "2026-08" piu' o meno un numero di mesi. */
export function meseSpostato(mese, di) {
  const [anno, m] = String(mese).split('-').map(Number);
  const d = new Date(Date.UTC(anno, m - 1 + di, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Il conto di un mese: quanto e' uscito in spese di tutti i giorni, quanto in
 * uscite fisse, quanto e' entrato. Le tre cose restano separate perche'
 * sommarle darebbe un numero che non risponde a nessuna domanda.
 */
export function riepilogoMese(registro, mese) {
  const dentro = (registro ?? []).filter((t) => meseDi(t) === mese);
  const somma = (quali) => Number(quali.reduce((s, t) => s + t.amount, 0).toFixed(2));
  return {
    mese,
    spese: somma(dentro.filter(eSpesaVariabile)),
    fisse: somma(dentro.filter((t) => t.fissa)),
    entrate: somma(dentro.filter((t) => t.entrata)),
    quante: dentro.length,
  };
}
