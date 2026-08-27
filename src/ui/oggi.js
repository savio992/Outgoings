// La schermata di apertura risponde a una domanda sola: quanto posso ancora
// spendere oggi.
//
// Il numero sta su un blocco colorato che cambia tinta con lo stato del budget,
// invece che su una carta bianca come tutto il resto: e' l'unica cosa che si
// guarda entrando, e deve essere la prima che si vede. Sotto, sette barre
// dicono se oggi e' un'eccezione o l'ennesimo giorno uguale - un numero solo non
// lo puo' dire.

import { el, euro, euroTondo, oggiIso, nomeGiorno, siglaGiorno, anima } from './comune.js';
import { statoGiorno, mediaGiornaliera, ultimiGiorni } from '../domain/budget.js';
import { giornoDi } from '../domain/registro.js';
import { spesa, elencoVuoto } from './registro.js';

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
  anima(cifra, !s.attiva ? s.spesoOggi
    : sfondato ? Math.abs(s.restoMese) : Math.abs(s.residuo), (n) => euro(n));

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
  ]);
}

/**
 * Il risparmio del mese, se il mese finisse oggi.
 *
 * Sta sotto il grafico e non nel blocco colorato per un motivo: la testata
 * risponde a "quanto posso spendere oggi", questa a "come sta andando il mese".
 * Sono due domande diverse e due ritmi diversi - una si guarda entrando in un
 * bar, l'altra il venerdi' sera.
 */
function risparmio(s) {
  if (!s.risparmio) return null;

  const fatto = Math.max(0, Math.min(s.risparmio, s.messoDaParte));
  const quota = Math.max(0, Math.min(1, s.messoDaParte / s.risparmio));
  const stato = s.messoDaParte < 0 ? 'oltre' : s.messoDaParte >= s.risparmio ? 'sereno' : 'attento';

  return el('div', { class: `carta sezione risparmio ${stato}` }, [
    el('div', { class: 'giorno' }, [
      el('span', { testo: 'Da parte questo mese' }),
      el('span', {
        class: 'totale soldi',
        // Sotto zero non c'e' niente da parte: c'e' un buco, e il numero da
        // scrivere e' quello, col segno. Mostrare "0,00 €" sarebbe piu' gentile
        // e direbbe una cosa falsa.
        testo: s.messoDaParte < 0 ? euro(s.messoDaParte) : `${euro(fatto)} di ${euro(s.risparmio)}`,
      }),
    ]),
    el('div', { class: 'barra' }, [el('span', { style: `width:${(quota * 100).toFixed(1)}%` })]),
    el('div', { class: 'nota', testo: s.messoDaParte < 0
      ? 'Il mese ha gia’ mangiato l’obiettivo: quello che spendi da qui in avanti esce dai risparmi.'
      : s.messoDaParte >= s.risparmio
        ? `Obiettivo coperto. Ogni giorno chiuso sotto ${euro(s.soglia)} lo allarga.`
        : `Restano ${s.giorniRestanti} giorni: chiudendoli a ${euro(s.soglia)} l’obiettivo si copre.` }),
  ]);
}

function settimana(registro, s, giorno) {
  const giorni = ultimiGiorni(registro, giorno, 7);

  // La scala segue le spese, non il tetto. Misurarla sul tetto sembra piu'
  // corretto ma non lo e': un tetto molto piu' alto della spesa - il primo mese
  // capita sempre - schiaccerebbe tutte le barre sul fondo, e il disegno che
  // dovrebbe far vedere le differenze fra i giorni smetterebbe di mostrarle.
  const massimo = Math.max(...giorni.map((g) => g.totale), 1);
  const cima = Math.max(massimo * 1.2, s.soglia > 0 && s.soglia <= massimo * 1.5 ? s.soglia * 1.15 : 0);

  // La riga del tetto si disegna solo quando cade dentro il grafico, cioe'
  // quando le spese la sfiorano: e' li' che serve. Quando e' lontanissima non
  // aggiunge niente, e il numero e' comunque scritto qui sopra.
  const mostraTetto = s.soglia > 0 && s.soglia <= cima;

  return el('div', { class: 'carta sezione settimana' }, [
    el('div', { class: 'grafico' }, [
      mostraTetto
        ? el('div', {
          class: 'tetto',
          style: `bottom:${((s.soglia / cima) * 100).toFixed(1)}%`,
        }, [el('span', { testo: euroTondo(s.soglia) })])
        : null,
      ...giorni.map((g, i) => el('div', {
        class: 'gambo' + (g.giorno === giorno ? ' oggi' : ''),
        title: `${euro(g.totale)}`,
      }, [
        // Un giorno senza spese non e' un giorno con poche spese: la barra
        // dev'essere assente, non minima, o si legge come un caffe'.
        el('span', {
          class: 'riempimento' + (s.soglia > 0 && g.totale > s.soglia ? ' alto' : ''),
          style: `height:${(g.totale > 0 ? Math.max(4, (g.totale / cima) * 100) : 0).toFixed(1)}%;`
            + `transition-delay:${i * 45}ms`,
        }),
      ])),
    ]),
    el('div', { class: 'sigle' }, giorni.map((g) => el('span', {
      class: g.giorno === giorno ? 'oggi' : null,
      testo: siglaGiorno(g.giorno),
    }))),
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

export function vistaOggi(registro, config, alTocco) {
  const giorno = oggiIso();
  const s = statoGiorno(config, registro, giorno);
  const diOggi = registro.filter((t) => giornoDi(t) === giorno);

  return el('div', {}, [
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

    settimana(registro, s, giorno),

    risparmio(s),

    el('div', { class: 'sezione' }, [
      el('div', { class: 'carta' }, [
        el('div', { class: 'giorno' }, [
          el('span', { testo: nomeGiorno(giorno) }),
          diOggi.length ? el('span', { class: 'totale soldi', testo: euro(s.spesoOggi) }) : null,
        ]),
        ...(diOggi.length ? diOggi.map((t) => spesa(t, alTocco)) : [elencoVuoto('Nessuna spesa oggi. Per ora.')]),
      ]),
    ]),
  ]);
}
