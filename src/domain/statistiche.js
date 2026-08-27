// Le spese raggruppate: dove vanno, cosa si ripete, quando escono.
//
// Il registro risponde a "cosa e' successo quel giorno". Qui si risponde alle
// altre due domande, quelle che un elenco in ordine di data non puo' mostrare:
// quali esercenti pesano davvero, e quali pesano perche' tornano.
//
// Tre scelte reggono tutto il modulo.
//
// La prima: si guardano le sole spese variabili. Le uscite fisse sono decise
// altrove e non si riducono guardandole, e mescolarle metterebbe la bolletta
// della luce in cima a una classifica che serve a decidere dove tagliare. Il
// loro totale si riporta a parte, perche' sparire non deve.
//
// La seconda: **le categorie non esistono nei dati**. Nessun dizionario
// "FAMILA -> Spesa": il primo esercente fuori lista finirebbe nella categoria
// sbagliata in silenzio, che e' esattamente cio' che le regole di questo
// progetto vietano. La categoria e' un'etichetta che l'utente attacca a un
// esercente, e vale da li' in avanti perche' se l'e' scelta lui.
//
// La terza: raggruppare non riscrive il registro. Alias e categorie vivono
// nella configurazione e si applicano al momento del conto. Cosi' "FAMILA
// MEGAGEST" resta scritto com'e' nell'estratto conto - la banca ha detto
// quello - e la classifica lo somma lo stesso a "SUPERMERCATO FAMILA".

import { giornoDi, meseDi, eSpesaVariabile, impronta, grafiaMigliore } from './registro.js';

const centesimi = (n) => Number((Math.round(n * 100) / 100).toFixed(2));

/** L'ultimo giorno di un mese, "YYYY-MM-DD". */
function fineMese(mese) {
  const [anno, m] = String(mese).split('-').map(Number);
  return `${mese}-${String(new Date(Date.UTC(anno, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Da lunedi' a domenica: 0 e' lunedi'. `getUTCDay` parte da domenica. */
export function indiceGiorno(giorno) {
  return (new Date(`${giorno}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * Il nome sotto cui una spesa va contata.
 *
 * `alias` mappa l'impronta di una grafia sul nome scelto dall'utente quando ha
 * unito due gruppi a mano. Un salto solo, mai una catena: due alias che si
 * rimandano a vicenda girerebbero per sempre, e il caso non vale il codice per
 * gestirlo.
 */
export function nomeDiGruppo(nome, alias = {}) {
  return alias[impronta(nome)] ?? nome;
}

/**
 * Quanto del mese il registro ha davvero visto.
 *
 * Serve a due cose: a non spacciare per "poco speso" un mese entrato nel
 * registro a meta', e a dividere per il numero giusto di lunedi'. Un estratto
 * conto che parte dal 27 luglio copre cinque giorni di luglio, non trentuno.
 */
export function coperturaMese(registro, mese) {
  const giorni = (registro ?? []).map(giornoDi).sort();
  const inizio = `${mese}-01`;
  const fine = fineMese(mese);
  if (!giorni.length) return { da: null, a: null, completo: false, giorni: 0 };

  const primo = giorni[0];
  const ultimo = giorni[giorni.length - 1];
  if (ultimo < inizio || primo > fine) return { da: null, a: null, completo: false, giorni: 0 };

  const da = primo > inizio ? primo : inizio;
  const a = ultimo < fine ? ultimo : fine;
  return {
    da,
    a,
    completo: primo <= inizio && ultimo >= fine,
    giorni: Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${da}T12:00:00Z`)) / 86400000) + 1,
  };
}

/**
 * Le spese di un mese raccolte per esercente.
 *
 * Il nome mostrato non e' inventato: fra le grafie viste vince sempre la stessa,
 * con la regola di `grafiaMigliore`. `grafie` le conserva tutte, perche' quando
 * due nomi sono stati uniti bisogna poter far vedere cosa e' stato unito - e
 * poterlo disfare.
 */
export function raggruppa(registro, mese, config = {}) {
  const alias = config.alias ?? {};
  const categorie = config.categorie ?? {};
  const gruppi = new Map();

  for (const t of registro ?? []) {
    if (mese && meseDi(t) !== mese) continue;
    if (!eSpesaVariabile(t)) continue;

    const grezza = impronta(t.merchant);
    const nome = alias[grezza] ?? t.merchant;
    const chiave = impronta(nome) || grezza;
    if (!gruppi.has(chiave)) {
      gruppi.set(chiave, {
        chiave, quante: 0, totale: 0, grafie: new Set(), ultimo: null, unito: false, scelto: null,
      });
    }
    const g = gruppi.get(chiave);
    // Un nome scelto a mano batte la grafia che vincerebbe da sola: se l'utente
    // ha unito "FAMILA MEGAGEST" sotto "Famila", il gruppo si chiama Famila
    // anche quando l'ordine alfabetico direbbe altro.
    if (alias[grezza]) g.scelto = alias[grezza];
    g.quante += 1;
    g.totale += t.amount;
    g.grafie.add(t.merchant);
    // Le grafie unite a mano contano anche quando in questo mese ne compare una
    // sola: il gruppo resta "unito", e l'utente puo' disfarlo.
    if (grezza !== chiave) g.unito = true;
    const giorno = giornoDi(t);
    if (!g.ultimo || giorno > g.ultimo) g.ultimo = giorno;
  }

  return [...gruppi.values()]
    .map((g) => {
      const grafie = [...g.grafie].sort();
      const nome = g.scelto ?? alias[g.chiave] ?? grafiaMigliore(grafie);
      return {
        chiave: g.chiave,
        nome,
        grafie,
        quante: g.quante,
        totale: centesimi(g.totale),
        media: centesimi(g.totale / g.quante),
        ultimo: g.ultimo,
        unito: g.unito || grafie.length > 1,
        // Unendo due gruppi la chiave cambia, e la categoria che stava su una
        // delle due grafie sparirebbe: si va a cercarla anche li'. Le grafie
        // sono ordinate, quindi a parita' vince sempre la stessa e due letture
        // degli stessi dati danno la stessa risposta.
        categoria: categorie[g.chiave]
          ?? grafie.map((f) => categorie[impronta(f)]).find(Boolean)
          ?? null,
      };
    })
    // A parita' di totale il nome, cosi' due disegni della stessa schermata
    // non scambiano due righe di posto.
    .sort((a, b) => b.totale - a.totale || (a.nome < b.nome ? -1 : 1));
}

/**
 * Gli stessi gruppi, ordinati per quante volte tornano.
 *
 * E' l'unica classifica che dice qualcosa di azionabile. Quella per importo la
 * guidano gli acquisti grossi e irripetibili - un'auto, un divano - e sapere che
 * l'auto e' costata piu' del caffe' non serve a nessuno. Quindici caffe' da
 * quattro euro invece sono una decisione che si puo' prendere di nuovo domani.
 */
export function perRicorrenza(gruppi, minimo = 2) {
  return (gruppi ?? [])
    .filter((g) => g.quante >= minimo)
    .sort((a, b) => b.quante - a.quante || b.totale - a.totale || (a.nome < b.nome ? -1 : 1));
}

/** Quanto pesano insieme gli esercenti visti una volta sola. */
export function unaTantum(gruppi) {
  const soli = (gruppi ?? []).filter((g) => g.quante === 1);
  return { quanti: soli.length, totale: centesimi(soli.reduce((s, g) => s + g.totale, 0)) };
}

/**
 * Le categorie, con quello che non ne ha ancora una tenuto da parte.
 *
 * "Senza categoria" non e' una categoria e non deve sembrarlo: e' il lavoro che
 * manca. Se finisse in mezzo alle altre, un utente che ne ha etichettate tre su
 * sessanta vedrebbe una torta in cui la fetta piu' grande e' l'ignoranza
 * dell'app, senza capire il perche'.
 */
export function perCategoria(gruppi) {
  const conti = new Map();
  let senza = { quante: 0, totale: 0, esercenti: 0 };

  for (const g of gruppi ?? []) {
    if (!g.categoria) {
      senza = {
        quante: senza.quante + g.quante,
        totale: senza.totale + g.totale,
        esercenti: senza.esercenti + 1,
      };
      continue;
    }
    const c = conti.get(g.categoria) ?? { categoria: g.categoria, quante: 0, totale: 0, esercenti: 0 };
    c.quante += g.quante;
    c.totale += g.totale;
    c.esercenti += 1;
    conti.set(g.categoria, c);
  }

  return {
    categorie: [...conti.values()]
      .map((c) => ({ ...c, totale: centesimi(c.totale) }))
      .sort((a, b) => b.totale - a.totale || (a.categoria < b.categoria ? -1 : 1)),
    senza: { ...senza, totale: centesimi(senza.totale) },
  };
}

const SIGLE = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
const NOMI_GIORNI = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];

/**
 * Il ritmo della settimana.
 *
 * La media conta piu' del totale, e non e' un dettaglio: in un mese i mercoledi'
 * possono essere cinque e i lunedi' quattro, e con i soli totali il mercoledi'
 * sembrerebbe piu' caro del venticinque per cento anche spendendoci uguale. Per
 * lo stesso motivo si divide per i giorni che il registro ha visto davvero, non
 * per quelli del calendario.
 */
export function perGiornoSettimana(registro, mese) {
  const conti = SIGLE.map((sigla, indice) => ({
    indice, sigla, nome: NOMI_GIORNI[indice], totale: 0, quante: 0, giorni: 0, maggiore: null,
  }));

  const coperto = coperturaMese(registro, mese);
  if (coperto.da) {
    for (let d = Date.parse(`${coperto.da}T12:00:00Z`); d <= Date.parse(`${coperto.a}T12:00:00Z`); d += 86400000) {
      conti[(new Date(d).getUTCDay() + 6) % 7].giorni += 1;
    }
  }

  for (const t of registro ?? []) {
    if (mese && meseDi(t) !== mese) continue;
    if (!eSpesaVariabile(t)) continue;
    const c = conti[indiceGiorno(giornoDi(t))];
    c.totale += t.amount;
    c.quante += 1;
    // La spesa piu' grande del giorno si porta dietro: un mercoledi' in cima
    // perche' quel mercoledi' hai comprato l'auto non e' un'abitudine, ed e'
    // l'unico modo di dirlo senza togliere la spesa dal conto.
    if (!c.maggiore || t.amount > c.maggiore.amount) {
      c.maggiore = { merchant: t.merchant, amount: t.amount, giorno: giornoDi(t) };
    }
  }

  return conti.map((c) => ({
    ...c,
    totale: centesimi(c.totale),
    media: c.giorni ? centesimi(c.totale / c.giorni) : 0,
  }));
}

/**
 * Il conto del mese, con dentro quello che serve a capire se e' confrontabile.
 *
 * `completo` non e' un dettaglio da nota a pie' di pagina: un mese entrato nel
 * registro il 27 mostra cinque giorni di spese, e messo accanto a un mese intero
 * racconta un crollo che non e' mai avvenuto.
 */
export function riepilogoAnalitico(registro, mese, config = {}) {
  const gruppi = raggruppa(registro, mese, config);
  const delMese = (registro ?? []).filter((t) => meseDi(t) === mese);
  const fisse = delMese.filter((t) => t.fissa && !t.entrata);

  return {
    mese,
    copertura: coperturaMese(registro, mese),
    gruppi,
    speso: centesimi(gruppi.reduce((s, g) => s + g.totale, 0)),
    quante: gruppi.reduce((s, g) => s + g.quante, 0),
    esercenti: gruppi.length,
    fisse: { quante: fisse.length, totale: centesimi(fisse.reduce((s, t) => s + t.amount, 0)) },
  };
}

/**
 * I mesi messi in fila, per vedere se si sta migliorando.
 *
 * Solo i mesi che il registro copre per intero possono stare accanto agli altri;
 * gli altri escono con `completo: false` e chi disegna li tiene spenti. Con un
 * mese solo di dati non c'e' niente da confrontare, e la risposta onesta e'
 * dirlo invece di disegnare una linea fra due punti di cui uno e' finto.
 */
export function andamentoMesi(registro, oggi) {
  const meseOggi = String(oggi).slice(0, 7);
  const perMese = new Map();
  for (const t of registro ?? []) {
    if (!eSpesaVariabile(t)) continue;
    const m = meseDi(t);
    if (m > meseOggi) continue;
    perMese.set(m, (perMese.get(m) ?? 0) + t.amount);
  }

  const mesi = [...perMese.keys()].sort().map((mese) => {
    const copertura = coperturaMese(registro, mese);
    return {
      mese,
      speso: centesimi(perMese.get(mese)),
      inCorso: mese === meseOggi,
      // Il mese in corso e' incompleto per forza, ma non e' un buco nei dati:
      // e' solo un mese non ancora finito, e va detto in un altro modo.
      completo: copertura.completo || (mese === meseOggi && copertura.da === `${mese}-01`),
      giorni: copertura.giorni,
    };
  });

  return { mesi, confrontabili: mesi.filter((m) => m.completo && !m.inCorso).length };
}
