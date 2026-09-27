// La schermata di apertura, fatta come la dashboard di Monarch: una pila di
// carte, ognuna una domanda. La prima e' quella per cui l'app esiste - quanto
// posso ancora spendere oggi - e le altre la spiegano allargando lo sguardo:
// la settimana, il mese contro il mese scorso, le uscite fisse che devono
// ancora passare, i soldi sul conto.
//
// Il numero grande sta su carta bianca come tutto il resto, e lo stato lo
// dicono la barra e la pastiglia accanto. Il blocco dipinto di prima si vedeva
// di piu', ma diceva una cosa sola a tutta la schermata; qui il colore sta
// dove sta l'informazione, e una carta rossa in mezzo alle altre si nota.
// Sotto, sette barre dicono se oggi e' un'eccezione o l'ennesimo giorno uguale
// - un numero solo non lo puo' dire.
//
// Le barre si toccano, e sopra ognuna c'e' il tetto che quel giorno aveva. Sono
// la stessa risposta della testata guardata all'indietro: quanto si poteva
// spendere, quanto si e' speso, e cosa e' successo al giorno dopo. Il tetto non
// e' un numero deciso da qualcuno e non ha senso impararlo a memoria - si
// capisce solo vedendolo muovere.

import { el, euro, euroTondo, oggiIso, nomeGiorno, siglaGiorno, siglaMese, dataBreve, nomeMese, anima } from './comune.js';
import { statoGiorno, mediaGiornaliera, strisciaSettimana, saldoStimato, andamentoDelMese } from '../domain/budget.js';
import { giornoDi } from '../domain/registro.js';
import { categoriaDi } from '../domain/statistiche.js';
import { ricorrenti } from '../domain/ricorrenti.js';
import { spesa, elencoVuoto } from './registro.js';
import { codaRevisione } from './revisione.js';

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

/** La parola della pastiglia: lo stesso stato di `umore`, detto a chi non vede il colore. */
const PAROLE = { sereno: 'In linea', attento: 'Attenzione', oltre: 'Oltre', neutro: 'Senza budget' };

/**
 * Il numero grande e le righe che lo spiegano.
 *
 * Quando il mese e' gia' sfondato il tetto di oggi vale zero, e mostrarlo -
 * "0,00 € spesi su 0,00 €" - non e' un'informazione: dice solo che oggi non
 * hai ancora comprato niente, quando la cosa da sapere e' di quanto sei sotto.
 * Li' il numero grande diventa lo sfondamento del mese, che e' la risposta vera
 * a "quanto posso ancora spendere".
 */
function testata(s) {
  const stato = umore(s);
  const sfondato = s.attiva && s.restoMese < 0;
  const cifra = el('div', { class: 'grande soldi' + (s.attiva && (sfondato || s.residuo < 0) ? ' oltre' : '') });
  const quanto = !s.attiva ? s.spesoOggi
    : sfondato ? Math.abs(s.restoMese) : Math.abs(s.residuo);
  if (contaSu) anima(cifra, quanto, (n) => euro(n));
  else cifra.textContent = euro(quanto);

  // Una tacca che parte da sinistra si vede anche quando la quota e'
  // minuscola, dove un arco del tre per cento no.
  const quota = !s.attiva ? 0
    : sfondato ? 1
      : s.soglia > 0 ? Math.min(1, Math.max(0, s.spesoOggi / s.soglia)) : 0;

  const sotto = !s.attiva
    ? [el('span', { testo: s.troppoRisparmio
      ? (s.fondi
        ? `Fra uscite fisse, ${euro(s.risparmio)} da mettere da parte e ${euro(s.fondi)} di spese non mensili`
        : `Fra uscite fisse e ${euro(s.risparmio)} da mettere da parte`) + ' non resta niente per i giorni'
      : 'Imposta stipendio e uscite fisse in Budget per avere un tetto giornaliero' })]
    : sfondato
      ? [el('span', {}, [el('b', { class: 'soldi', testo: euro(s.spesoMese) }), ' spesi nel mese']),
        el('span', { class: 'soldi', testo: `su ${euro(s.disponibile)}` })]
      : [el('span', {}, [el('b', { class: 'soldi', testo: euro(s.spesoOggi) }), ' spesi oggi']),
        el('span', { class: 'soldi', testo: `tetto ${euro(s.soglia)}` })];

  // Il tetto si capisce quando lo si vede muovere, e muoverlo e' quello che
  // sta succedendo adesso: la spesa di oggi non toglie soldi a un mese
  // lontano, toglie a domani. Detto prima puo' ancora cambiare la decisione;
  // detto domani e' solo una brutta sorpresa.
  //
  // A mese gia' sfondato non si dice: il tetto e' zero e resta zero, e
  // "domani scende a 0,00 €" non insegna niente che la riga sopra non abbia
  // gia' detto.
  const verso = s.sogliaDomani > s.soglia ? 'su' : s.sogliaDomani < s.soglia ? 'giu' : 'pari';
  const domani = s.attiva && !sfondato && s.sogliaDomani !== null
    ? el('div', { class: 'spiega' }, [
      el('span', { class: `freccia ${verso}`, 'aria-hidden': 'true', testo: verso === 'su' ? '↗' : verso === 'giu' ? '↘' : '→' }),
      el('span', {}, [
        'Se chiudi qui, domani il tetto ',
        verso === 'su' ? 'sale' : verso === 'giu' ? 'scende' : 'resta',
        ' a ',
        el('b', { class: 'soldi', testo: euro(s.sogliaDomani) }),
      ]),
    ])
    : null;

  return el('div', { class: 'eroe' }, [
    el('div', { class: 'sopra' }, [
      el('div', { class: 'occhiello', testo: !s.attiva ? 'Spesi oggi'
        : sfondato ? 'Il mese e’ gia’ oltre di'
          : s.residuo < 0 ? 'Oltre il tetto di oggi' : 'Puoi ancora spendere oggi' }),
      el('span', { class: `pastiglia ${stato}`, testo: PAROLE[stato] }),
    ]),
    cifra,
    s.attiva ? el('div', { class: `metro spesso ${stato}` }, [
      el('span', { style: `width:${(quota * 100).toFixed(1)}%` }),
    ]) : null,
    el('div', { class: 'sotto' }, sotto),
    domani,
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
function soldi(s, saldo, daPagare, nuove) {
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
    saldo ? el('div', { class: 'testa-carta' }, [
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
    // Le fisse che devono ancora passare non sono nel saldo, e il saldo sembra
    // piu' alto di quello che e'. E' una stima sopra una stima, quindi sta su
    // una riga sua e si chiama col suo nome - il saldo resta quello di sopra.
    //
    // Se questo mese e' passata una fissa mai vista prima, puo' essere una di
    // quelle attese scritta con un altro nome - la notifica e la banca chiamano
    // lo stesso posto in due modi - e allora qui sarebbe tolta due volte.
    // Abbinarle a naso non si puo'; dirlo si'.
    saldo && daPagare > 0 ? el('div', { class: 'nota', testo:
      `Tolte le uscite fisse ancora da passare questo mese (${euro(daPagare)}), `
      + `restano circa ${euro(saldo.stimato - daPagare)}.`
      + (nuove ? ` Questo mese e’ passata anche una fissa mai vista prima: se e’ una di quelle `
        + 'attese scritta in un altro modo, qui e’ contata due volte.' : '') }) : null,
    // Un saldo vecchio non e' sbagliato, e' scaduto: dirlo costa una riga e
    // evita di far passare per il conto di oggi quello di tre settimane fa.
    saldo && saldo.giorni >= 10
      ? el('div', { class: 'nota fioco', testo: `Il saldo ha ${saldo.giorni} giorni: `
        + 'scarica un estratto conto nuovo per rimetterlo a posto.' })
      : null,

    s.risparmio && saldo ? el('div', { class: 'divisorio' }) : null,

    s.risparmio ? el('div', { class: 'testa-carta' }, [
      el('span', { testo: 'Da parte questo mese' }),
      el('span', {
        class: 'totale soldi obiettivo',
        // Sotto zero non c'e' niente da parte: c'e' un buco, e il numero da
        // scrivere e' quello, col segno. Mostrare "0,00 €" sarebbe piu' gentile
        // e direbbe una cosa falsa.
        testo: s.messoDaParte < 0 ? euro(s.messoDaParte) : `${euro(fatto)} di ${euro(s.risparmio)}`,
      }),
    ]) : null,
    s.risparmio ? el('div', { class: `metro ${stato}` + (s.messoDaParte < 0 ? ' sotto-zero' : '') }, [
      el('span', { style: `width:${(quota * 100).toFixed(1)}%` }),
    ]) : null,
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
  return el('div', { class: 'didascalia' }, [
    el('span', {}, [
      el('b', { testo: nomeGiorno(g.giorno) }),
      ' · ',
      el('span', { class: 'soldi', testo: g.totale > 0 ? euro(g.totale) : 'niente speso' }),
    ]),
    // Senza budget non c'e' nessun tetto da confrontare, e inventare una riga
    // pur di averla direbbe meno di niente.
    g.soglia > 0
      ? el('span', { class: 'soldi' }, [
        `tetto ${euro(g.soglia)}`,
        g.totale > 0 ? ' · ' : null,
        g.totale > 0 ? el('span', {
          class: g.oltre ? 'oltre' : 'sotto',
          testo: g.oltre ? `${euro(-g.residuo)} oltre` : `${euro(g.residuo)} sotto`,
        }) : null,
      ])
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
    el('div', { class: 'testa-carta' }, [
      el('span', { testo: 'Ultimi 7 giorni' }),
      tetto > 0 ? el('span', { class: 'legenda' }, [el('span', {}, [el('i', { class: 'tetto' }), 'tetto del giorno'])]) : null,
    ]),
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

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attributi = {}) {
  const nodo = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attributi)) if (v !== null && v !== undefined) nodo.setAttribute(k, v);
  return nodo;
}

/**
 * Il mese a somme crescenti, contro il mese scorso: la carta "Spending" di
 * Monarch.
 *
 * La barra dei sette giorni dice com'e' andato ogni giorno; questa dice dove
 * porta la somma. La retta tratteggiata e' il disponibile spalmato uguale su
 * tutti i giorni: stare sotto vuol dire che il tetto dei giorni dopo sale,
 * stare sopra che scende. E' la stessa regola del numero grande, vista da
 * lontano.
 *
 * Toccare il grafico sposta la riga sotto su quel giorno, senza ridisegnare
 * niente: la cifra grande e le altre carte restano ferme, e il dito puo'
 * scorrere lungo il mese.
 */
function andamento(a) {
  if (!a.questo.some((v) => v > 0) && !a.precedente.some((v) => v > 0)) return null;

  const L = 320;
  const A = 150;
  const n = a.giorni;
  // Il mese scorso sulla scala di questo: un agosto di 31 giorni accanto a un
  // settembre di 30 si ferma al 30, che e' fin dove il confronto ha senso.
  const precedente = a.precedente.slice(0, n);
  const x = (d) => ((d - 1) / Math.max(1, n - 1)) * L;
  const alRitmo = (d) => (a.disponibile * d) / n;
  const cima = Math.max(
    ...a.questo, ...precedente,
    a.ritmo !== null ? alRitmo(Math.min(n, a.oggi + 3)) : 0,
    1,
  ) * 1.12;
  const y = (v) => A - (v / cima) * (A - 6);
  const linea = (valori) => valori.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  const speso = a.questo[a.oggi - 1] ?? 0;
  const disegno = svg('svg', { viewBox: `0 0 ${L} ${A}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  for (const f of [0.5, 1]) disegno.append(svg('line', { class: 'griglia', x1: 0, x2: L, y1: y(cima * f / 1.12), y2: y(cima * f / 1.12) }));
  disegno.append(svg('line', { class: 'griglia', x1: 0, x2: L, y1: A - 0.5, y2: A - 0.5 }));
  if (precedente.length) disegno.append(svg('path', { class: 'scorso', d: linea(precedente), 'vector-effect': 'non-scaling-stroke' }));
  if (a.ritmo !== null) {
    disegno.append(svg('path', {
      class: 'ritmo', 'vector-effect': 'non-scaling-stroke',
      d: `M${x(1)} ${y(alRitmo(1)).toFixed(1)} L${x(n)} ${y(alRitmo(n)).toFixed(1)}`,
    }));
  }
  disegno.append(svg('path', {
    class: 'area',
    d: `${linea(a.questo)} L${x(a.oggi).toFixed(1)} ${A} L${x(1)} ${A} Z`,
  }));
  disegno.append(svg('path', { class: 'questo', d: linea(a.questo), 'vector-effect': 'non-scaling-stroke' }));

  // La guida e i punti del giorno scelto, dentro lo stesso disegno. I punti
  // sono cerchi in un SVG deformato: con `preserveAspectRatio: none` un cerchio
  // diventa un'ellisse, quindi stanno fuori, sopra, in coordinate vere.
  const guida = svg('line', { class: 'guida', y1: 0, y2: A, 'vector-effect': 'non-scaling-stroke' });
  disegno.append(guida);
  const puntoQuesto = el('span', { class: 'punto-html questo-p' });
  const puntoScorso = el('span', { class: 'punto-html scorso-p' });
  const didascalia = el('div', { class: 'didascalia' });

  const mostra = (d) => {
    const qui = d <= a.oggi ? a.questo[d - 1] : null;
    const prima = d <= precedente.length ? precedente[d - 1] : null;
    guida.setAttribute('x1', x(d));
    guida.setAttribute('x2', x(d));
    const metti = (punto, v) => {
      punto.hidden = v === null;
      if (v !== null) {
        punto.style.left = `${(x(d) / L) * 100}%`;
        punto.style.top = `${(y(v) / A) * 100}%`;
      }
    };
    metti(puntoQuesto, qui);
    metti(puntoScorso, prima);
    didascalia.replaceChildren(
      el('span', {}, [
        el('b', { testo: `${d} ${siglaMese(a.mese)}` }),
        ' · ',
        el('span', { class: 'soldi', testo: qui === null ? 'deve ancora venire' : euro(qui) }),
      ]),
      el('span', { class: 'soldi' }, [
        prima !== null ? `${siglaMese(a.scorso)} ${euro(prima)}` : null,
        prima !== null && a.ritmo !== null ? ' · ' : null,
        a.ritmo !== null ? `ritmo ${euroTondo(alRitmo(d))}` : null,
      ]),
    );
  };

  const area = el('div', { class: 'linee', role: 'img',
    'aria-label': `Speso nel mese: ${euro(speso)}` + (a.confronto ? `, ${siglaMese(a.scorso)} allo stesso giorno ${euro(a.confronto.scorso)}` : '') }, [
    disegno, puntoScorso, puntoQuesto,
  ]);
  const tocca = (e) => {
    const r = area.getBoundingClientRect();
    const quota = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    mostra(Math.round(quota * (n - 1)) + 1);
  };
  area.addEventListener('pointerdown', tocca);
  area.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType !== 'mouse') tocca(e); });
  mostra(a.oggi);

  // Il confronto a parole, solo quando e' onesto farlo.
  const confronto = a.confronto
    ? a.confronto.differenza === 0
      ? [`Come ${nomeMese(a.scorso).split(' ')[0].toLowerCase()} allo stesso giorno.`]
      : [el('b', {
        class: a.confronto.differenza < 0 ? 'meno' : 'piu',
        testo: `${euro(Math.abs(a.confronto.differenza))} ${a.confronto.differenza < 0 ? 'in meno' : 'in piu’'}`,
      }), ` di ${nomeMese(a.scorso).split(' ')[0].toLowerCase()} allo stesso giorno.`]
    : a.precedente.some((v) => v > 0)
      ? [`${nomeMese(a.scorso).split(' ')[0]} il registro lo vede solo in parte: niente confronto.`]
      : null;
  const ritmo = a.ritmo !== null
    ? [speso <= a.ritmo ? 'Sotto' : 'Sopra', ' il ritmo del budget, che oggi e’ ', el('b', { class: 'soldi', testo: euro(a.ritmo) }), '.']
    : null;

  return el('div', { class: 'carta sezione andamento' }, [
    el('div', { class: 'testa-carta' }, [
      el('span', { testo: 'Spese del mese' }),
      el('span', { class: 'totale', testo: nomeMese(a.mese) }),
    ]),
    el('div', { class: 'cifra soldi', testo: euro(speso) }),
    confronto ? el('div', { class: 'confronto' }, confronto) : null,
    ritmo ? el('div', { class: 'confronto' }, ritmo) : null,
    el('div', { class: 'legenda' }, [
      el('span', {}, [el('i'), siglaMese(a.mese)]),
      a.precedente.length ? el('span', {}, [el('i', { class: 'scorso' }), siglaMese(a.scorso)]) : null,
      a.ritmo !== null ? el('span', {}, [el('i', { class: 'ritmo' }), 'ritmo del budget']) : null,
    ]),
    area,
    el('div', { class: 'assi' }, [el('span', { testo: '1' }), el('span', { testo: String(Math.ceil(n / 2)) }), el('span', { testo: String(n) })]),
    didascalia,
  ]);
}

/**
 * Le uscite fisse del mese: quali sono passate e quali devono ancora.
 *
 * E' la carta "Recurring" di Monarch, ma senza indovinare: le ricorrenze sono
 * quelle che il registro ha visto ripetersi, e una vista una volta sola si
 * mostra dicendolo. Il tetto giornaliero non le conta; il conto si'.
 */
function fisseDelMese(r) {
  if (!r.voci.length) return null;
  const incerte = r.voci.some((v) => !v.certa && v.stato !== 'pagata');
  return el('div', { class: 'carta sezione' }, [
    el('div', { class: 'testa-carta' }, [
      el('span', { testo: 'Uscite fisse' }),
      el('span', { class: 'totale soldi', testo: r.daPagare > 0 ? `mancano ${euro(r.daPagare)}` : 'nessuna in attesa' }),
    ]),
    ...r.voci.map((v) => el('div', { class: `spesa ricorrente ${v.stato === 'pagata' ? 'pagata' : ''}` }, [
      el('span', {
        class: `icona-stato ${v.stato === 'pagata' ? 'pagata' : v.stato === 'attesa' ? 'attesa' : ''}`,
        'aria-hidden': 'true',
        testo: v.stato === 'pagata' ? '✓' : String(Number(v.prevista.slice(8, 10))),
      }),
      el('span', { class: 'nome' }, [
        el('b', { testo: v.causale ? `${v.nome} · ${v.causale}` : v.nome }),
        el('small', { testo: v.stato === 'pagata' ? `passata il ${dataBreve(v.prevista)}`
          : v.stato === 'attesa' ? `attesa dal ${dataBreve(v.prevista)}, non ancora vista`
            : `attesa il ${dataBreve(v.prevista)}` + (v.certa ? '' : ' · vista una volta') }),
      ]),
      el('span', { class: 'importo soldi fissa', testo: euro(v.stato === 'pagata' ? v.pagatoQuestoMese : v.importo) }),
    ])),
    incerte ? el('div', { class: 'nota fioco', style: 'padding-bottom:14px', testo:
      'Quelle viste una volta sola non entrano in “mancano”: un ritmo si riconosce dal secondo mese.' }) : null,
  ]);
}

export function vistaOggi(registro, config, alTocco, ridisegna, salvaConfig, salvaRegistro) {
  const giorno = oggiIso();
  const s = statoGiorno(config, registro, giorno);
  const giorni = strisciaSettimana(config, registro, giorno, 7);

  // Se il giorno scelto non e' piu' fra i sette si torna a oggi: a mezzanotte
  // la finestra scorre, e restare puntati su una barra che non c'e' piu'
  // vorrebbe dire mostrare un elenco che a schermo non ha piu' una colonna.
  if (!giorni.some((g) => g.giorno === scelto)) scelto = giorno;
  const mostrato = giorni.find((g) => g.giorno === scelto);
  const spese = registro.filter((t) => giornoDi(t) === scelto);
  const ric = ricorrenti(registro, giorno);
  const fisse = fisseDelMese(ric);

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

    // Un tocco nella coda ridisegna la schermata come un tocco sulle barre:
    // la cifra grande non deve ripartire da zero come se rispondesse lei.
    codaRevisione({
      registro, config, oggi: giorno, alTocco,
      ridisegna: () => { contaSu = false; ridisegna(); },
      salvaConfig: (c) => { contaSu = false; salvaConfig(c); },
      salvaRegistro: (r) => { contaSu = false; salvaRegistro(r); },
    }),

    settimana(registro, config, s, giorni, giorno, ridisegna),

    andamento(andamentoDelMese(config, registro, giorno)),

    fisse,

    soldi(s, saldoStimato(config, registro, giorno), ric.daPagare, ric.nuove),

    // L'elenco segue la barra toccata. La testata no: risponde a "quanto posso
    // spendere oggi", e oggi resta oggi qualunque giorno si stia guardando.
    el('div', { class: 'sezione' }, [
      el('div', { class: 'carta' }, [
        el('div', { class: 'testa-carta' }, [
          el('span', { testo: scelto === giorno ? 'Spese di oggi' : nomeGiorno(scelto) }),
          spese.length ? el('span', { class: 'totale soldi', testo: euro(mostrato.totale) }) : null,
        ]),
        ...(spese.length ? spese.map((t) => spesa(t, alTocco, undefined, categoriaDi(t, config)))
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
