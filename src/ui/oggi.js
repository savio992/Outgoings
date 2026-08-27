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
  if (s.residuo < 0) return 'oltre';
  return s.soglia > 0 && s.spesoOggi / s.soglia >= .6 ? 'attento' : 'sereno';
}

function testata(s) {
  const cifra = el('div', { class: 'grande soldi' });
  const valore = s.attiva ? Math.abs(s.residuo) : s.spesoOggi;
  anima(cifra, valore, (n) => euro(n));

  // La barra e' la stessa informazione dell'anello di prima, ma leggibile anche
  // quando la quota e' minuscola: una tacca che parte da sinistra si vede, un
  // arco del tre per cento no.
  const quota = s.attiva && s.soglia > 0 ? Math.min(1, Math.max(0, s.spesoOggi / s.soglia)) : 0;

  return el('div', { class: `testata ${umore(s)}` }, [
    el('div', { class: 'occhiello', testo: !s.attiva ? 'spesi oggi'
      : s.residuo < 0 ? 'oltre il tetto di oggi' : 'puoi ancora spendere' }),
    cifra,
    s.attiva ? el('div', { class: 'barra' }, [
      el('span', { style: `width:${(quota * 100).toFixed(1)}%` }),
    ]) : null,
    el('div', { class: 'sottotitolo' }, s.attiva
      ? [`${euro(s.spesoOggi)} spesi su ${euro(s.soglia)}`]
      : ['Imposta stipendio e uscite fisse per avere un tetto giornaliero']),
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
