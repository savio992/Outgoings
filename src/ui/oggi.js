// La schermata di apertura risponde a una domanda sola: quanto posso ancora
// spendere oggi.
//
// Il numero sta su un blocco colorato che cambia tinta con lo stato del budget,
// invece che su una carta bianca come tutto il resto: e' l'unica cosa che si
// guarda entrando, e deve essere la prima che si vede. Sotto, sette barre
// dicono se oggi e' un'eccezione o l'ennesimo giorno uguale - un numero solo non
// lo puo' dire.
//
// Le barre si toccano, e sopra ognuna c'e' il tetto che quel giorno aveva. Sono
// la stessa risposta della testata guardata all'indietro: quanto si poteva
// spendere, quanto si e' speso, e cosa e' successo al giorno dopo. Il tetto non
// e' un numero deciso da qualcuno e non ha senso impararlo a memoria - si
// capisce solo vedendolo muovere.

import { el, euro, euroTondo, oggiIso, nomeGiorno, siglaGiorno, dataBreve, anima } from './comune.js';
import { statoGiorno, mediaGiornaliera, strisciaSettimana, saldoStimato } from '../domain/budget.js';
import { giornoDi } from '../domain/registro.js';
import { spesa, elencoVuoto } from './registro.js';

/**
 * Il giorno che la striscia sta mostrando, di solito oggi.
 *
 * Vive dentro la vista come le classifiche in Analisi: toccare una barra
 * cambia questo e rifa' il giro dall'alto, senza passare niente in giro.
 */
let scelto = null;

/**
 * Se il numero grande deve salire contando.
 *
 * Un tocco su una barra ridisegna tutta la schermata, e senza questo la cifra
 * ripartirebbe da zero ogni volta: sembrerebbe che stia rispondendo lei al
 * tocco, mentre la testata resta ferma su oggi apposta.
 */
let contaSu = true;

/** Lo stato del giorno in una parola, che decide anche la tinta del blocco. */
function umore(s) {
  if (!s.attiva) return 'neutro';
  // Il mese gia' in rosso batte tutto: un tetto di oggi ancora intatto non fa
  // di una giornata una giornata serena, e il verde direbbe il contrario di
  // quello che sta succedendo.
  if (s.residuo < 0 || s.restoMese < 0) return 'oltre';
  return s.soglia > 0 && s.spesoOggi / s.soglia >= .6 ? 'attento' : 'sereno';
}

/**
 * Il numero grande e le due righe che lo spiegano.
 *
 * Quando il mese e' gia' sfondato il tetto di oggi vale zero, e mostrarlo -
 * "0,00 € spesi su 0,00 €" - non e' un'informazione: dice solo che oggi non
 * hai ancora comprato niente, quando la cosa da sapere e' di quanto sei sotto.
 * Li' il numero grande diventa lo sfondamento del mese, che e' la risposta vera
 * a "quanto posso ancora spendere".
 */
function testata(s) {
  const sfondato = s.attiva && s.restoMese < 0;
  const cifra = el('div', { class: 'grande soldi' });
  const quanto = !s.attiva ? s.spesoOggi
    : sfondato ? Math.abs(s.restoMese) : Math.abs(s.residuo);
  if (contaSu) anima(cifra, quanto, (n) => euro(n));
  else cifra.textContent = euro(quanto);

  // La barra e' la stessa informazione dell'anello di prima, ma leggibile anche
  // quando la quota e' minuscola: una tacca che parte da sinistra si vede, un
  // arco del tre per cento no.
  const quota = !s.attiva ? 0
    : sfondato ? 1
      : s.soglia > 0 ? Math.min(1, Math.max(0, s.spesoOggi / s.soglia)) : 0;

  const sotto = !s.attiva
    ? (s.troppoRisparmio
      ? `Fra uscite fisse e ${euro(s.risparmio)} da mettere da parte non resta niente per i giorni`
      : 'Imposta stipendio e uscite fisse per avere un tetto giornaliero')
    : sfondato
      ? `${euro(s.spesoMese)} spesi su ${euro(s.disponibile)} del mese`
      : `${euro(s.spesoOggi)} spesi su ${euro(s.soglia)}`;

  return el('div', { class: `testata ${umore(s)}` }, [
    el('div', { class: 'occhiello', testo: !s.attiva ? 'spesi oggi'
      : sfondato ? 'il mese e’ gia’ oltre'
        : s.residuo < 0 ? 'oltre il tetto di oggi' : 'puoi ancora spendere' }),
    cifra,
    s.attiva ? el('div', { class: 'barra' }, [
      el('span', { style: `width:${(quota * 100).toFixed(1)}%` }),
    ]) : null,
    el('div', { class: 'sottotitolo' }, [sotto]),
    // Il tetto si capisce quando lo si vede muovere, e muoverlo e' quello che
    // sta succedendo adesso: la spesa di oggi non toglie soldi a un mese
    // lontano, toglie a domani. Detto prima puo' ancora cambiare la decisione;
    // detto domani e' solo una brutta sorpresa.
    //
    // A mese gia' sfondato non si dice: il tetto e' zero e resta zero, e
    // "domani scende a 0,00 €" non insegna niente che la riga sopra non abbia
    // gia' detto.
    s.attiva && !sfondato && s.sogliaDomani !== null
      ? el('div', { class: 'spiega', testo: `Se chiudi qui, domani il tetto `
        + `${s.sogliaDomani > s.soglia ? 'sale' : s.sogliaDomani < s.soglia ? 'scende' : 'resta'} `
        + `a ${euro(s.sogliaDomani)}` })
      : null,
  ]);
}

/**
 * Quanti soldi ci sono, e quanti ne restano da parte.
 *
 * Sta sotto il grafico e non nel blocco colorato per un motivo: la testata
 * risponde a "quanto posso spendere oggi", questa a "come sta andando il mese".
 * Sono due domande diverse e due ritmi diversi - una si guarda entrando in un
 * bar, l'altra il venerdi' sera.
 */
function soldi(s, saldo) {
  if (!saldo && !s.risparmio) return null;

  const fatto = Math.max(0, Math.min(s.risparmio, s.messoDaParte));
  const quota = Math.max(0, Math.min(1, s.messoDaParte / (s.risparmio || 1)));
  const stato = s.messoDaParte < 0 ? 'oltre' : s.messoDaParte >= s.risparmio ? 'sereno' : 'attento';

  // Il saldo dichiarato dalla banca e quello stimato da noi non sono la stessa
  // cosa. Finche' coincidono si scrive il giorno del saldo e basta; appena il
  // registro conosce spese che la banca non ha ancora visto, il numero grande
  // diventa la stima e si dice da dove viene - altrimenti sembrerebbe che la
  // banca abbia scritto una cifra che non ha mai scritto.
  const scostato = saldo && saldo.movimentiDopo > 0;

  return el('div', { class: `carta sezione risparmio ${s.risparmio ? stato : ''}` }, [
    saldo ? el('div', { class: 'giorno' }, [
      el('span', { testo: scostato ? 'Sul conto · stimato' : 'Sul conto' }),
      el('span', {
        // Il rosso qui vuol dire una cosa sola: il conto e' sotto zero. Se lo
        // prendesse dallo stato del risparmio direbbe che duemila euro sul
        // conto sono un problema.
        class: 'totale soldi saldo' + (saldo.stimato < 0 ? ' rosso' : ''),
        testo: euro(saldo.stimato),
      }),
    ]) : null,
    saldo ? el('div', { class: 'nota', testo: scostato
      ? `${euro(saldo.dichiarato)} al ${dataBreve(saldo.al)} secondo la banca, meno `
        + `${saldo.movimentiDopo} ${saldo.movimentiDopo === 1 ? 'movimento' : 'movimenti'} che ha visto solo l’app.`
      : `Come lo scrive la banca, al ${dataBreve(saldo.al)}.` }) : null,
    // Un saldo vecchio non e' sbagliato, e' scaduto: dirlo costa una riga e
    // evita di far passare per il conto di oggi quello di tre settimane fa.
    saldo && saldo.giorni >= 10
      ? el('div', { class: 'nota fioco', testo: `Il saldo ha ${saldo.giorni} giorni: `
        + 'scarica un estratto conto nuovo per rimetterlo a posto.' })
      : null,

    s.risparmio && saldo ? el('div', { class: 'divisorio' }) : null,

    s.risparmio ? el('div', { class: 'giorno' }, [
      el('span', { testo: 'Da parte questo mese' }),
      el('span', {
        class: 'totale soldi obiettivo',
        // Sotto zero non c'e' niente da parte: c'e' un buco, e il numero da
        // scrivere e' quello, col segno. Mostrare "0,00 €" sarebbe piu' gentile
        // e direbbe una cosa falsa.
        testo: s.messoDaParte < 0 ? euro(s.messoDaParte) : `${euro(fatto)} di ${euro(s.risparmio)}`,
      }),
    ]) : null,
    s.risparmio ? el('div', { class: 'barra' }, [el('span', { style: `width:${(quota * 100).toFixed(1)}%` })]) : null,
    s.risparmio ? el('div', { class: 'nota', testo: s.messoDaParte < 0
      ? 'Il mese ha gia’ mangiato l’obiettivo: quello che spendi da qui in avanti esce dai risparmi.'
      : s.messoDaParte >= s.risparmio
        ? `Obiettivo coperto. Ogni giorno chiuso sotto ${euro(s.soglia)} lo allarga.`
        : `Restano ${s.giorniRestanti} giorni: chiudendoli a ${euro(s.soglia)} l’obiettivo si copre.` }) : null,
  ]);
}

/**
 * La riga sotto le barre: cos'e' successo il giorno che stai guardando.
 *
 * Non sta dentro un fumetto che compare al tocco. Su un telefono un fumetto e'
 * l'unico posto dove quel numero esiste, e finche' non tocchi la barra giusta
 * non lo vedi: qui la riga c'e' sempre, all'apertura parla di oggi, e il tocco
 * la cambia. Cosi' il grafico si legge anche senza toccarlo.
 */
function scelta(g) {
  const quanto = g.totale > 0 ? euro(g.totale) : null;
  return el('div', { class: 'scelta' }, [
    el('div', { class: 'giorno' }, [
      el('span', { testo: nomeGiorno(g.giorno) }),
      quanto ? el('span', { class: 'totale soldi', testo: quanto }) : null,
    ]),
    // Senza budget non c'e' nessun tetto da confrontare, e inventare una riga
    // pur di averla direbbe meno di niente.
    g.soglia > 0
      ? el('div', { class: 'nota' + (g.oltre ? ' oltre' : ''), testo:
        `Tetto ${euro(g.soglia)} · ` + (g.totale === 0 ? 'niente speso'
          : g.oltre ? `${euro(-g.residuo)} oltre` : `${euro(g.residuo)} sotto`) })
      : null,
  ]);
}

/**
 * Sette giorni, ognuno col suo tetto, e uno da toccare.
 *
 * Il tetto non e' una riga sola che attraversa il disegno: e' una tacca per
 * giorno, perche' un tetto solo lo sarebbe davvero solo se il mese non
 * reagisse. Sette tacche a scalini fanno vedere in un colpo la cosa che a
 * parole non arriva - che sforare martedi' e' il motivo per cui mercoledi' il
 * tetto era piu' basso - e la fanno vedere sui propri numeri, che e' l'unico
 * modo in cui una regola di budget diventa un'abitudine.
 *
 * A toccare e' la colonna intera, sigla compresa: il dito ha bisogno di un
 * bersaglio largo, e una barra di un giorno senza spese e' alta zero.
 */
function settimana(registro, config, s, giorni, giorno, ridisegna) {
  // La scala segue le spese, non il tetto. Misurarla sul tetto sembra piu'
  // corretto ma non lo e': un tetto molto piu' alto della spesa - il primo mese
  // capita sempre - schiaccerebbe tutte le barre sul fondo, e il disegno che
  // dovrebbe far vedere le differenze fra i giorni smetterebbe di mostrarle.
  const massimo = Math.max(...giorni.map((g) => g.totale), 1);
  const tetto = Math.max(...giorni.map((g) => g.soglia), 0);
  const cima = Math.max(massimo * 1.2, tetto > 0 && tetto <= massimo * 1.5 ? tetto * 1.15 : 0);

  return el('div', { class: 'carta sezione settimana' }, [
    el('div', { class: 'grafico' }, giorni.map((g, i) => el('button', {
      class: 'gambo' + (g.giorno === giorno ? ' oggi' : '') + (g.giorno === scelto ? ' scelto' : ''),
      type: 'button',
      'aria-pressed': g.giorno === scelto ? 'true' : 'false',
      // Il `title` di prima non lo leggeva nessuno: su un telefono non c'e' il
      // passaggio del mouse. Qui il numero e' scritto sotto al grafico, e
      // questa etichetta e' per chi il grafico non lo vede affatto.
      'aria-label': `${nomeGiorno(g.giorno)}: ${euro(g.totale)}`
        + (g.soglia > 0 ? `, tetto ${euro(g.soglia)}` : ''),
      onclick: () => {
        scelto = g.giorno;
        contaSu = false;
        ridisegna();
      },
    }, [
      el('span', { class: 'asta' }, [
        // Un giorno senza spese non e' un giorno con poche spese: la barra
        // dev'essere assente, non minima, o si legge come un caffe'.
        el('span', {
          class: 'riempimento' + (g.oltre ? ' alto' : ''),
          style: `height:${(g.totale > 0 ? Math.max(4, (g.totale / cima) * 100) : 0).toFixed(1)}%;`
            + `transition-delay:${i * 45}ms`,
        }),
        // La tacca si disegna solo quando cade dentro il grafico, cioe' quando
        // le spese la sfiorano: e' li' che serve. Quando e' lontanissima non
        // aggiunge niente, e il numero e' comunque scritto qui sotto.
        //
        // Va dopo la barra perche' i giorni che contano sono quelli in cui la
        // barra la supera: dietro, proprio li' sparirebbe.
        g.soglia > 0 && g.soglia <= cima
          ? el('span', { class: 'tacca', style: `bottom:${((g.soglia / cima) * 100).toFixed(1)}%` })
          : null,
      ]),
      el('span', { class: 'sigla' }, [el('span', { testo: siglaGiorno(g.giorno) })]),
    ]))),

    scelta(giorni.find((g) => g.giorno === scelto)),

    el('div', { class: 'righe' }, [
      el('div', {}, [
        el('div', { class: 'valore soldi', testo: euroTondo(s.restoMese) }),
        el('div', { class: 'chiave', testo: `restano · ${s.giorniRestanti} gg` }),
      ]),
      el('div', {}, [
        el('div', { class: 'valore soldi', testo: euroTondo(s.spesoMese) }),
        el('div', { class: 'chiave', testo: 'spesi nel mese' }),
      ]),
      el('div', {}, [
        el('div', { class: 'valore soldi', testo: euro(mediaGiornaliera(registro, giorno)) }),
        el('div', { class: 'chiave', testo: 'media al giorno' }),
      ]),
    ]),
  ]);
}

export function vistaOggi(registro, config, alTocco, ridisegna) {
  const giorno = oggiIso();
  const s = statoGiorno(config, registro, giorno);
  const giorni = strisciaSettimana(config, registro, giorno, 7);

  // Se il giorno scelto non e' piu' fra i sette si torna a oggi: a mezzanotte
  // la finestra scorre, e restare puntati su una barra che non c'e' piu'
  // vorrebbe dire mostrare un elenco che a schermo non ha piu' una colonna.
  if (!giorni.some((g) => g.giorno === scelto)) scelto = giorno;
  const mostrato = giorni.find((g) => g.giorno === scelto);
  const spese = registro.filter((t) => giornoDi(t) === scelto);

  const vista = el('div', {}, [
    el('div', { class: 'sezione' }, [
      el('div', { class: 'carta' }, [
        testata(s),
        s.parziale
          ? el('div', { class: 'avviso' }, [
            'Il registro parte dal ',
            el('b', { testo: nomeGiorno(s.daQuando).toLowerCase() }),
            ': quello che hai speso prima nel mese non lo so, quindi questo tetto e’ piu’ alto del vero.',
          ])
          : null,
      ]),
    ]),

    settimana(registro, config, s, giorni, giorno, ridisegna),

    soldi(s, saldoStimato(config, registro, giorno)),

    // L'elenco segue la barra toccata. La testata no: risponde a "quanto posso
    // spendere oggi", e oggi resta oggi qualunque giorno si stia guardando.
    el('div', { class: 'sezione' }, [
      el('div', { class: 'carta' }, [
        el('div', { class: 'giorno' }, [
          el('span', { testo: nomeGiorno(scelto) }),
          spese.length ? el('span', { class: 'totale soldi', testo: euro(mostrato.totale) }) : null,
        ]),
        ...(spese.length ? spese.map((t) => spesa(t, alTocco))
          : [elencoVuoto(scelto === giorno ? 'Nessuna spesa oggi. Per ora.' : 'Nessuna spesa in questo giorno.')]),
      ]),
    ]),
  ]);

  // Il prossimo giro conta di nuovo, a meno che non sia un altro tocco a
  // chiederlo: quello che va spento e' la ripartenza da zero al tocco, non
  // l'animazione di quando la schermata si apre.
  contaSu = true;
  return vista;
}
