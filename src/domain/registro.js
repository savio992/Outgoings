// Il registro: identita' delle transazioni, dedup, e il totale del giorno.
//
// Qui sta la decisione che rende la v2 un innesto invece che una riscrittura.
// Il registro canonico e' un file JSONL append-only, e ci si entra da una sola
// porta: `merge`. Lo screenshot di oggi e l'ESP32 di domani sono due chiamanti
// della stessa funzione, non due percorsi paralleli.

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
 * L'unica porta d'ingresso del registro.
 *
 * Idempotente per costruzione: rifare lo screenshot senza aver svuotato il
 * Centro Notifiche rivede le stesse transazioni, e devono finire in `duplicate`
 * senza toccare il registro. Non modifica gli argomenti.
 */
export function merge(registro, nuove) {
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
  for (const t of nuove ?? []) {
    if (t.id && visti.has(t.id)) {
      duplicate.push(t);
      continue;
    }
    visti.add(t.id);
    aggiunte.push(t);
  }
  return {
    registro: [...(registro ?? []), ...aggiunte].sort(perData),
    aggiunte,
    duplicate,
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

  const rimosse = (registro ?? []).filter(dentro);
  const tenute = (registro ?? []).filter((t) => !dentro(t));

  // Anche dentro il periodo il dedup serve: reimportare due volte lo stesso
  // estratto conto non deve dipendere dall'aver cancellato prima.
  const esito = merge(tenute, nuove.filter(dentro));
  return { registro: esito.registro, aggiunte: esito.aggiunte, rimosse };
}

/** Il mese "YYYY-MM" di una transazione. */
export const meseDi = (t) => String(t.occurredAt).slice(0, 7);

/** I mesi presenti nel registro, dal piu' recente. */
export function mesiDelRegistro(registro) {
  return [...new Set((registro ?? []).map(meseDi))].sort().reverse();
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
