// Lo storico, un mese alla volta.
//
// Mostrarlo tutto in una lista sola sembra piu' semplice, ma dopo tre mesi di
// estratti conto diventa un rotolo in cui non si trova niente: le domande che
// ci si fa sono sempre "quanto ho speso a luglio" e "cosa e' successo quel
// giorno", ed entrambe hanno un mese dentro.

import { el, euro, euroTondo, nomeGiorno, nomeMese, oggiIso, tinta, iniziali } from './comune.js';
import { giornoDi, meseDi, eSpesaVariabile, mesiDelRegistro, meseSpostato, riepilogoMese } from '../domain/registro.js';

export function elencoVuoto(testo) {
  return el('div', { class: 'vuoto', testo });
}

/**
 * Una riga di spesa. Il pallino ambra segnala una lettura da confermare.
 *
 * `notaFissa` sostituisce la riga piccola sotto il nome. Serve dove il posto e'
 * gia' noto - dentro il foglio di un esercente sono tutte spese sue, e ripetere
 * tredici volte la stessa citta' occupa la riga in cui servirebbe il giorno.
 */
export function spesa(t, alTocco, notaFissa) {
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
      style: `background:${tinta(t.merchant)}`,
      testo: iniziali(t.merchant),
    }),
    el('span', { class: 'nome' }, [
      el('b', { testo: t.merchant }),
      el('small', { testo: nota || (t.timeKnown === false ? 'senza orario' : '') }),
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

export function vistaRegistro(registro, alTocco, mese, vaiA) {
  if (!registro.length) {
    return el('div', { class: 'carta sezione' }, [
      elencoVuoto('Il registro e’ vuoto. Incolla uno screenshot o il file della banca.'),
    ]);
  }

  const mesi = mesiDelRegistro(registro, oggiIso());
  // Se il mese scelto non esiste piu' - registro svuotato, import che riscrive -
  // si torna a quello di oggi, che c'e' sempre.
  const corrente = mesi.includes(mese) ? mese : (mesi.includes(oggiIso().slice(0, 7)) ? oggiIso().slice(0, 7) : mesi[0]);
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
    ]));
  }

  const oggi = oggiIso();
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

  for (const [giorno, spese] of perGiorno(delMese)) {
    const totale = spese.filter(eSpesaVariabile).reduce((s, t) => s + t.amount, 0);
    pezzi.push(el('div', { class: 'sezione' }, [
      el('div', { class: 'carta' }, [
        el('div', { class: 'giorno' }, [
          el('span', { testo: nomeGiorno(giorno, oggi) }),
          totale > 0 ? el('span', { class: 'totale soldi', testo: euro(totale) }) : null,
        ]),
        ...spese.map((t) => spesa(t, alTocco)),
      ]),
    ]));
  }

  return el('div', {}, pezzi);
}
