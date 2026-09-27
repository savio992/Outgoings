// Lo storico, un mese alla volta - e, quando serve, tutto insieme.
//
// Mostrarlo tutto in una lista sola sembra piu' semplice, ma dopo tre mesi di
// estratti conto diventa un rotolo in cui non si trova niente: le domande che
// ci si fa sono sempre "quanto ho speso a luglio" e "cosa e' successo quel
// giorno", ed entrambe hanno un mese dentro.
//
// Le altre - "quanto ho dato ad Anna", "quando e' passato l'abbonamento" -
// il mese non ce l'hanno, ed e' per quelle che c'e' la ricerca. Come in
// Monarch sta in cima ed e' sempre li': appena si scrive o si sceglie un filtro
// il mese sparisce e resta l'elenco di cio' che corrisponde, da tutti i mesi.

import { el, euro, euroTondo, nomeGiorno, nomeMese, oggiIso, stileTinta, iniziali, icona, ICONE } from './comune.js';
import { giornoDi, meseDi, eSpesaVariabile, mesiDelRegistro, meseSpostato, riepilogoMese } from '../domain/registro.js';
import { cercaMovimenti, sommaMovimenti, FILTRI } from '../domain/ricerca.js';
import { categoriaDi } from '../domain/statistiche.js';

// Cosa si sta cercando. Vive dentro la vista come il giorno scelto in Oggi:
// passare a un altro tab e tornare ritrova la ricerca dov'era, che e' quello
// che si vuole quando si e' andati a controllare una cosa e si torna.
let ricerca = '';
let filtro = 'tutti';

const NOMI_FILTRI = {
  tutti: 'Tutti',
  spese: 'Spese',
  entrate: 'Entrate',
  fisse: 'Uscite fisse',
  verificare: 'Da verificare',
  mano: 'A mano',
};

// Oltre queste righe l'elenco si ferma e lo dice: il DOM di un anno intero di
// movimenti su un telefono si sente, e una ricerca che ne trova mille va
// stretta, non scorsa.
const MASSIMO_RISULTATI = 300;

export function elencoVuoto(testo) {
  return el('div', { class: 'vuoto', testo });
}

/**
 * Una riga di spesa. Il pallino ambra segnala una lettura da confermare.
 *
 * `categoria`, se c'e', apre la riga piccola: la sceglie l'utente per
 * l'esercente, e chi chiama la calcola con `categoriaDi`.
 *
 * `notaFissa` sostituisce la riga piccola sotto il nome. Serve dove il posto e'
 * gia' noto - dentro il foglio di un esercente sono tutte spese sue, e ripetere
 * tredici volte la stessa citta' occupa la riga in cui servirebbe il giorno.
 */
export function spesa(t, alTocco, notaFissa, categoria) {
  const luogo = [t.city, t.region].filter(Boolean).join(', ');
  // Un accredito e un affitto non sono spese di tutti i giorni, e nell'elenco
  // devono vedersi diversi: altrimenti un giorno con l'affitto sembra un giorno
  // in cui hai speso settecento euro.
  // La causale di un bonifico vale piu' di tutto il resto: "Pannolini" dice
  // quello che il nome del beneficiario da solo non dice.
  // "a mano" al posto della citta' che una spesa scritta da te non ha: dice da
  // dove viene la riga, ed e' l'informazione che serve quando i conti non
  // tornano - quella e' l'unica che nessun import rifara' mai.
  const nota = notaFissa ?? t.causale
    ?? (t.entrata ? 'accredito'
      : t.fissa ? 'uscita fissa'
        : t.source === 'manuale' ? 'a mano' : luogo);

  return el('button', {
    class: 'spesa',
    type: 'button',
    onclick: alTocco ? () => alTocco(t) : null,
  }, [
    el('span', {
      class: 'sigillo',
      style: stileTinta(t.merchant),
      testo: iniziali(t.merchant),
    }),
    el('span', { class: 'nome' }, [
      el('b', { testo: t.merchant }),
      // La categoria in testa alla riga piccola, come in Monarch: e' quello
      // che si cerca con l'occhio scorrendo, il resto e' dettaglio.
      el('small', {}, [
        categoria ? el('span', { class: 'categoria', testo: categoria }) : null,
        categoria && nota ? ' · ' : null,
        nota || (!categoria && t.timeKnown === false ? 'senza orario' : ''),
      ]),
    ]),
    t.confidence === 'low' ? el('span', { class: 'pallino', title: 'da verificare' }) : null,
    el('span', {
      class: 'importo soldi' + (t.entrata ? ' entrata' : t.fissa ? ' fissa' : ''),
      testo: (t.entrata ? '+' : '') + euro(t.amount),
    }),
  ]);
}

function perGiorno(spese) {
  const gruppi = new Map();
  for (const t of spese) {
    const g = giornoDi(t);
    if (!gruppi.has(g)) gruppi.set(g, []);
    gruppi.get(g).push(t);
  }
  return [...gruppi.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

/**
 * La barra dei mesi.
 *
 * Le frecce si spengono dove il registro finisce: poter andare indietro
 * all'infinito su mesi vuoti fa sembrare che i dati siano spariti.
 */
export function barraMesi(mese, mesi, vaiA) {
  const primo = mesi[mesi.length - 1];
  const ultimo = mesi[0];
  const freccia = (verso, dove, attiva) => el('button', {
    class: 'mese-freccia', type: 'button',
    disabled: !attiva, 'aria-label': verso === -1 ? 'Mese precedente' : 'Mese successivo',
    onclick: attiva ? () => vaiA(dove) : null,
  }, [verso === -1 ? '‹' : '›']);

  return el('div', { class: 'barra-mesi' }, [
    freccia(-1, meseSpostato(mese, -1), mese > primo),
    el('span', { class: 'mese-nome', testo: nomeMese(mese) }),
    freccia(1, meseSpostato(mese, 1), mese < ultimo),
  ]);
}

function riepilogo(r) {
  const voci = [
    ['speso', r.spese, ''],
    ...(r.fisse ? [['uscite fisse', r.fisse, 'fissa']] : []),
    ...(r.entrate ? [['entrate', r.entrate, 'entrata']] : []),
  ];
  return el('div', { class: 'righe' }, voci.map(([chiave, valore, classe]) => el('div', {}, [
    el('div', { class: `valore soldi ${classe}`, testo: euroTondo(valore) }),
    el('div', { class: 'chiave', testo: chiave }),
  ])));
}

/** Le spese raccolte per giorno, ogni giorno la sua carta. */
function giorniInCarte(righe, alTocco, config, oggi) {
  return perGiorno(righe).map(([giorno, spese]) => {
    const totale = spese.filter(eSpesaVariabile).reduce((s, t) => s + t.amount, 0);
    return el('div', { class: 'sezione' }, [
      el('div', { class: 'carta' }, [
        el('div', { class: 'giorno' }, [
          // L'anno solo quando non e' questo: nella ricerca si scende anche
          // negli anni prima, e "24 agosto" da solo li' e' ambiguo.
          el('span', { testo: nomeGiorno(giorno, oggi)
            + (giorno.slice(0, 4) === oggi.slice(0, 4) ? '' : ` ${giorno.slice(0, 4)}`) }),
          totale > 0 ? el('span', { class: 'totale soldi', testo: euro(totale) }) : null,
        ]),
        ...spese.map((t) => spesa(t, alTocco, undefined, categoriaDi(t, config))),
      ]),
    ]);
  });
}

/** Il mese aperto: la barra, il riepilogo, e i giorni uno sotto l'altro. */
function vistaMese(registro, alTocco, mese, vaiA, config, filtra) {
  const oggi = oggiIso();
  const mesi = mesiDelRegistro(registro, oggi);
  // Se il mese scelto non esiste piu' - registro svuotato, import che riscrive -
  // si torna a quello di oggi, che c'e' sempre.
  const corrente = mesi.includes(mese) ? mese : (mesi.includes(oggi.slice(0, 7)) ? oggi.slice(0, 7) : mesi[0]);
  const delMese = registro.filter((t) => meseDi(t) === corrente);
  const daVerificare = delMese.filter((t) => t.confidence === 'low').length;

  const pezzi = [
    el('div', { class: 'carta sezione' }, [
      barraMesi(corrente, mesi, vaiA),
      riepilogo(riepilogoMese(registro, corrente)),
    ]),
  ];

  if (daVerificare) {
    pezzi.push(el('div', { class: 'carta sezione' }, [
      el('div', { class: 'esito' }, [
        el('span', { class: 'nota' }, [
          `${daVerificare} ${daVerificare === 1 ? 'spesa e’ stata letta' : 'spese sono state lette'} in modo incerto. `,
        ]),
        'Sono quelle col pallino: toccale per correggerle.',
      ]),
      el('button', {
        class: 'apri-tutto', type: 'button', testo: 'Mostra solo quelle',
        onclick: () => filtra('verificare'),
      }),
    ]));
  }

  // Il mese appena cominciato, o uno che l'estratto conto non copre: senza una
  // riga che lo dica restano la barra e il riepilogo a zero, e sembra che le
  // spese siano sparite invece che non esserci ancora.
  if (!delMese.length) {
    pezzi.push(el('div', { class: 'carta sezione' }, [
      elencoVuoto(corrente === oggi.slice(0, 7)
        ? 'Questo mese non c’e’ ancora niente.'
        : 'Nessuna spesa in questo mese.'),
    ]));
  }

  pezzi.push(...giorniInCarte(delMese, alTocco, config, oggi));
  return pezzi;
}

/** Quello che corrisponde alla ricerca, da tutti i mesi. */
function vistaRisultati(registro, alTocco, config) {
  const trovate = cercaMovimenti(registro, { testo: ricerca, filtro }, config);
  if (!trovate.length) {
    return [el('div', { class: 'carta sezione' }, [
      elencoVuoto(ricerca.trim() ? `Niente che corrisponda a «${ricerca.trim()}».` : 'Nessun movimento con questo filtro.'),
    ])];
  }
  const conto = sommaMovimenti(trovate);
  const mostrate = trovate.slice(0, MASSIMO_RISULTATI);
  return [
    el('div', { class: 'risultati-testa' }, [
      el('span', {}, [el('b', { testo: String(conto.quante) }), conto.quante === 1 ? ' movimento' : ' movimenti']),
      el('span', { class: 'soldi' }, [
        conto.uscite ? el('b', { testo: euro(conto.uscite) }) : null,
        conto.uscite ? ' usciti' : null,
        conto.uscite && conto.entrate ? ' · ' : null,
        conto.entrate ? el('b', { testo: '+' + euro(conto.entrate) }) : null,
      ]),
    ]),
    ...giorniInCarte(mostrate, alTocco, config, oggiIso()),
    trovate.length > mostrate.length
      ? el('div', { class: 'nota fioco', testo: `Mostrati i ${MASSIMO_RISULTATI} piu’ recenti: `
        + 'scrivi qualcosa in piu’ per stringere.' })
      : null,
  ].filter(Boolean);
}

export function vistaRegistro(registro, alTocco, mese, vaiA, config = {}) {
  if (!registro.length) {
    return el('div', { class: 'carta sezione' }, [
      elencoVuoto('Il registro e’ vuoto. Incolla uno screenshot o il file della banca.'),
    ]);
  }

  const corpo = el('div');
  const filtri = el('div', { class: 'filtri', role: 'group', 'aria-label': 'Filtri' });

  // Il campo non si ridisegna mai mentre ci si scrive dentro: si cambia solo
  // quello che sta sotto. Rifare tutta la vista a ogni lettera lo ricreerebbe,
  // e la tastiera si chiuderebbe dopo il primo carattere.
  const aggiorna = () => {
    const quante = registro.filter(FILTRI.verificare).length;
    filtri.replaceChildren(...Object.entries(NOMI_FILTRI)
      .filter(([k]) => k !== 'verificare' || quante)
      .map(([k, nome]) => el('button', {
        class: 'filtro', type: 'button', 'aria-pressed': filtro === k ? 'true' : 'false',
        onclick: () => {
          filtro = filtro === k && k !== 'tutti' ? 'tutti' : k;
          aggiorna();
        },
      }, [nome, k === 'verificare' ? el('span', { class: 'conta', testo: String(quante) }) : null])));
    const attiva = ricerca.trim() !== '' || filtro !== 'tutti';
    corpo.replaceChildren(...(attiva
      ? vistaRisultati(registro, alTocco, config)
      : vistaMese(registro, alTocco, mese, vaiA, config, (f) => {
        filtro = f;
        aggiorna();
        scrollTo({ top: 0 });
      })));
  };

  const campo = el('input', {
    type: 'search', value: ricerca, placeholder: 'Cerca esercente, causale, importo',
    enterkeyhint: 'search', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
    'aria-label': 'Cerca nei movimenti',
    oninput: () => {
      ricerca = campo.value;
      togli.hidden = !ricerca;
      aggiorna();
    },
  });
  const togli = el('button', {
    class: 'togli-testo', type: 'button', testo: '×', 'aria-label': 'Svuota la ricerca',
    onclick: () => {
      ricerca = '';
      campo.value = '';
      togli.hidden = true;
      aggiorna();
      campo.focus();
    },
  });
  togli.hidden = !ricerca;

  aggiorna();
  return el('div', {}, [
    el('div', { class: 'cerca-campo' }, [icona(ICONE.cerca), campo, togli]),
    filtri,
    corpo,
  ]);
}
