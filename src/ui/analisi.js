// Le spese guardate per esercente invece che per giorno.
//
// Il Registro dice cosa e' successo il 12 agosto. Qui si risponde a tre domande
// che un elenco in ordine di data non puo' mostrare: dove finiscono i soldi,
// cosa torna, e in che giorni della settimana esce di piu'.
//
// L'ordine delle tre carte non e' casuale. La prima classifica e' quella per
// importo, ed e' la meno utile: in cima ci finisce l'auto comprata una volta.
// La seconda e' per quante volte, ed e' l'unica su cui si possa decidere
// qualcosa - quindici caffe' da quattro euro sono una scelta che si rifa'
// domani. La terza dice quando, che e' quello che serve per non arrivare al
// sabato con il tetto gia' finito.

import { el, euro, euroTondo, tinta, iniziali, dataBreve, nomeMese } from './comune.js';
import {
  raggruppa, perRicorrenza, unaTantum, perCategoria, perGiornoSettimana,
  riepilogoAnalitico, andamentoMesi,
} from '../domain/statistiche.js';
import { impronta, mesiDelRegistro, meseDi, giornoDi } from '../domain/registro.js';
import { spesa, elencoVuoto, barraMesi } from './registro.js';

// Quante righe prima del "mostra tutti". Otto e' quanto ci sta in uno schermo
// senza scorrere: piu' in la' la classifica smette di essere una classifica e
// diventa di nuovo un elenco.
const QUANTE = 8;

// Etichette proposte, non assegnate. Nessuna finisce addosso a un esercente da
// sola: sono solo i tasti piu' comodi di una tastiera, e ce n'e' una per
// scriverne una qualsiasi.
const SUGGERITE = ['Spesa', 'Casa', 'Auto', 'Bar e ristoranti', 'Salute', 'Svago', 'Persone', 'Abbonamenti'];

// Lo stato della schermata, non dei dati: quale classifica e' aperta per intero
// e se si guarda per esercente o per categoria. Sta qui e non nella
// configurazione perche' non e' una preferenza da ricordare fra un giorno e
// l'altro - e' dove sei arrivato a guardare adesso.
let espanse = new Set();
let modo = 'esercente';

/** Una riga con la barra sotto: nome, dettaglio, importo, e quanto pesa. */
function riga(g, quota, alTocco, dettaglio) {
  return el('button', {
    class: 'gruppo', type: 'button',
    onclick: alTocco ? () => alTocco(g) : null,
  }, [
    el('span', { class: 'sigillo', style: `background:${tinta(g.nome)}`, testo: iniziali(g.nome) }),
    el('span', { class: 'nome' }, [
      el('b', { testo: g.nome }),
      el('small', { testo: dettaglio }),
    ]),
    el('span', { class: 'importo soldi', testo: euro(g.totale) }),
    el('span', { class: 'quota', style: `width:${(Math.max(0, Math.min(1, quota)) * 100).toFixed(1)}%` }),
  ]);
}

// Solo la domenica e' femminile: scrivere "il domenica" fa sembrare la frase
// generata da una macchina, che e' esattamente quello che e'.
const articolo = (g) => (g.indice === 6 ? 'la ' : 'il ') + g.nome;

/** "13 volte · 4,23 € in media", oppure il giorno se la volta e' stata una. */
function dettaglioGruppo(g) {
  if (g.quante === 1) return `una volta · ${dataBreve(g.ultimo)}`;
  return `${g.quante} volte · ${euro(g.media)} in media`;
}

function apriTutto(nome, ridisegna) {
  return el('button', {
    class: 'apri-tutto', type: 'button',
    testo: espanse.has(nome) ? 'Mostra solo i primi' : null,
    onclick: () => {
      if (espanse.has(nome)) espanse.delete(nome); else espanse.add(nome);
      ridisegna();
    },
  });
}

/** L'intestazione di una carta, con a destra un comando facoltativo. */
function titolo(testo, destra) {
  return el('div', { class: 'giorno' }, [el('span', { testo }), destra]);
}

/**
 * Dove vanno i soldi.
 *
 * Le uscite fisse non ci sono, e non e' una dimenticanza: la bolletta della luce
 * starebbe in mezzo alla classifica senza che guardarla serva a niente, perche'
 * quella cifra si decide altrove. Il loro totale e' scritto in fondo, cosi' non
 * sembra che manchino dei soldi.
 */
function dove(r, config, apri, ridisegna) {
  const perCat = perCategoria(r.gruppi);
  const haCategorie = perCat.categorie.length > 0;

  const voci = modo === 'categoria'
    ? [
      ...perCat.categorie.map((c) => ({
        nome: c.categoria, totale: c.totale, quante: c.quante,
        dettaglio: `${c.esercenti} ${c.esercenti === 1 ? 'esercente' : 'esercenti'} · ${c.quante} ${c.quante === 1 ? 'spesa' : 'spese'}`,
      })),
      // Il non-ancora-etichettato resta in fondo e si chiama con il suo nome:
      // messo in mezzo alle altre sembrerebbe una categoria, e la fetta piu'
      // grande della torta sarebbe quello che l'app non sa.
      ...(perCat.senza.esercenti ? [{
        nome: 'Senza categoria', totale: perCat.senza.totale, quante: perCat.senza.quante,
        dettaglio: `${perCat.senza.esercenti} esercenti da etichettare`, spento: true,
      }] : []),
    ]
    : r.gruppi.map((g) => ({ ...g, dettaglio: dettaglioGruppo(g) }));

  const tutte = espanse.has('dove');
  const mostrate = tutte ? voci : voci.slice(0, QUANTE);
  const massimo = Math.max(...voci.map((v) => v.totale), 1);
  const soli = unaTantum(r.gruppi);

  return el('div', { class: 'carta sezione' }, [
    titolo('Dove vanno', haCategorie ? el('button', {
      class: 'scambia', type: 'button',
      testo: modo === 'categoria' ? 'per esercente' : 'per categoria',
      onclick: () => {
        modo = modo === 'categoria' ? 'esercente' : 'categoria';
        ridisegna();
      },
    }) : null),

    ...mostrate.map((v) => {
      const nodo = riga(v, v.totale / massimo, modo === 'categoria' ? null : apri, v.dettaglio);
      if (v.spento) nodo.classList.add('spento-gruppo');
      return nodo;
    }),

    voci.length > QUANTE ? el('button', {
      class: 'apri-tutto', type: 'button',
      testo: tutte ? 'Mostra solo i primi' : `Mostra tutti (${voci.length})`,
      onclick: () => {
        if (tutte) espanse.delete('dove'); else espanse.add('dove');
        ridisegna();
      },
    }) : null,

    modo === 'esercente' && soli.quanti > 1 ? el('div', { class: 'nota', testo:
      `${soli.quanti} esercenti visti una volta sola, ${euro(soli.totale)} in tutto. `
      + 'Sono spese che non torneranno da sole.' }) : null,

    r.fisse.quante ? el('div', { class: 'nota fioco', testo:
      `Fuori da questi conti ci sono ${euro(r.fisse.totale)} di uscite fisse `
      + `(${r.fisse.quante}): quelle si decidono in Budget, non qui.` }) : null,
  ]);
}

/**
 * Cosa si ripete.
 *
 * Qui la barra misura le volte e non gli euro. E' l'unico grafico dell'app che
 * non parla di soldi, ed e' voluto: la classifica per importo esiste gia' qui
 * sopra, e rifarla ordinata diversamente non direbbe niente di nuovo.
 */
function ripete(r, apri, ridisegna) {
  const tutti = perRicorrenza(r.gruppi);
  if (!tutti.length) return null;

  const tutte = espanse.has('ripete');
  const mostrati = tutte ? tutti : tutti.slice(0, QUANTE);
  const massimo = Math.max(...tutti.map((g) => g.quante), 1);

  return el('div', { class: 'carta sezione' }, [
    // Qui le barre misurano le volte e non gli euro: senza dirlo, un caffe' da
    // quattro euro con la barra piu' lunga di un'auto da novecento sembra un
    // errore di conto invece che il punto della classifica.
    titolo('Cosa si ripete', el('span', { class: 'misura', testo: 'per volte' })),
    ...mostrati.map((g) => riga(g, g.quante / massimo, apri,
      `${g.quante} volte · ${euro(g.media)} in media`)),
    tutti.length > QUANTE ? el('button', {
      class: 'apri-tutto', type: 'button',
      testo: tutte ? 'Mostra solo i primi' : `Mostra tutti (${tutti.length})`,
      onclick: () => {
        if (tutte) espanse.delete('ripete'); else espanse.add('ripete');
        ridisegna();
      },
    }) : null,
    el('div', { class: 'nota', testo:
      `${tutti[0].nome} e’ quello che torna piu’ spesso: ${tutti[0].quante} volte `
      + `per ${euro(tutti[0].totale)}. Su questo si puo’ decidere di nuovo domani.` }),
  ]);
}

/**
 * Quando esce.
 *
 * Le barre sono la **media** di quel giorno della settimana, non il totale: in
 * un mese i mercoledi' possono essere cinque e i lunedi' quattro, e con i totali
 * il mercoledi' sembrerebbe piu' caro del venticinque per cento anche
 * spendendoci uguale.
 */
function quando(registro, mese) {
  const giorni = perGiornoSettimana(registro, mese);
  if (!giorni.some((g) => g.quante)) return null;

  const cima = Math.max(...giorni.map((g) => g.media), 1) * 1.15;
  const ordinati = [...giorni].filter((g) => g.giorni).sort((a, b) => b.media - a.media);
  const caro = ordinati[0];
  const leggero = ordinati[ordinati.length - 1];

  // Un giorno in cima perche' quel giorno hai comprato l'auto non e'
  // un'abitudine. Dirlo e' l'unico modo di lasciare la spesa nel conto senza
  // far leggere il grafico al contrario.
  const pesa = caro.maggiore && caro.maggiore.amount > caro.totale / 2
    ? ` — ma ${euro(caro.maggiore.amount)} sono ${caro.maggiore.merchant} del ${dataBreve(caro.maggiore.giorno)}, una volta sola.`
    : '.';

  return el('div', { class: 'carta sezione settimana' }, [
    titolo('Quando spendi'),
    el('div', { class: 'grafico' }, giorni.map((g, i) => el('div', {
      class: 'gambo' + (g === caro ? ' oggi' : ''),
      title: `${g.nome}: ${euro(g.media)} in media su ${g.giorni}`,
    }, [
      el('span', {
        class: 'riempimento',
        style: `height:${(g.media > 0 ? Math.max(4, (g.media / cima) * 100) : 0).toFixed(1)}%;`
          + `transition-delay:${i * 45}ms`,
      }),
    ]))),
    el('div', { class: 'sigle' }, giorni.map((g) => el('span', {
      class: g === caro ? 'oggi' : null, testo: g.sigla,
    }))),
    el('div', { class: 'nota', testo:
      `In media ${articolo(caro)} escono ${euro(caro.media)}, ${articolo(leggero)} ${euro(leggero.media)}${pesa}` }),
  ]);
}

/**
 * Mese per mese.
 *
 * Un mese che il registro copre a meta' resta spento e dice di esserlo. Metterlo
 * accanto a un mese intero racconterebbe un crollo delle spese che non e' mai
 * avvenuto - e' solo il giorno in cui e' cominciato il registro.
 */
function mesi(registro, oggi, mese, vaiA) {
  const a = andamentoMesi(registro, oggi);
  if (a.mesi.length < 2) return null;

  const massimo = Math.max(...a.mesi.map((m) => m.speso), 1);
  return el('div', { class: 'carta sezione' }, [
    titolo('Mese per mese'),
    ...a.mesi.slice().reverse().map((m) => el('button', {
      class: 'gruppo mese-riga' + (m.completo && !m.inCorso ? '' : ' spento-gruppo')
        + (m.mese === mese ? ' scelto' : ''),
      type: 'button',
      onclick: () => vaiA(m.mese),
    }, [
      el('span', { class: 'nome' }, [
        el('b', { testo: nomeMese(m.mese) }),
        el('small', { testo: m.inCorso ? `ancora in corso · ${m.giorni} giorni`
          : m.completo ? 'mese intero'
            : `solo ${m.giorni} giorni nel registro` }),
      ]),
      el('span', { class: 'importo soldi', testo: euroTondo(m.speso) }),
      el('span', { class: 'quota', style: `width:${((m.speso / massimo) * 100).toFixed(1)}%` }),
    ])),
    el('div', { class: 'nota', testo: a.confrontabili >= 2
      ? 'I mesi interi si possono confrontare fra loro.'
      : 'Per confrontare due mesi servono due mesi interi: quelli spenti il registro '
        + 'li ha visti solo in parte, e sembrerebbero piu’ leggeri di quanto sono stati.' }),
  ]);
}

// --------------------------------------------------------------------------
// Il foglio di un esercente: che categoria ha, con chi va unito, cosa ci sta
// dentro.

// "a agosto" e "a aprile" si leggono come un inciampo: davanti a vocale ci va
// la d eufonica, e sono gli unici due mesi in cui serve.
const aMese = (mese) => (/^[aeiou]/.test(mese) ? 'ad ' : 'a ') + mese;

/** Le categorie gia' usate, piu' quelle proposte, senza ripetizioni. */
function etichette(config) {
  const usate = [...new Set(Object.values(config?.categorie ?? {}).filter(Boolean))].sort();
  return [...usate, ...SUGGERITE.filter((s) => !usate.includes(s))];
}

function scriviCategoria(config, chiave, valore, salvaConfig) {
  const categorie = { ...(config.categorie ?? {}) };
  if (valore) categorie[chiave] = valore; else delete categorie[chiave];
  salvaConfig({ ...config, categorie });
}

/**
 * Unisce due gruppi, o li separa.
 *
 * L'alias si scrive per **ogni grafia** del gruppo, non solo per la sua chiave:
 * il raggruppamento fa un salto solo, e una catena "A -> B -> C" lascerebbe A
 * fuori. Il nome scelto e' sempre uno di quelli che la banca ha scritto
 * davvero.
 */
function scriviAlias(config, gruppo, verso, salvaConfig) {
  const alias = { ...(config.alias ?? {}) };
  for (const grafia of gruppo.grafie) {
    if (verso) alias[impronta(grafia)] = verso; else delete alias[impronta(grafia)];
  }
  if (!verso) delete alias[gruppo.chiave];
  salvaConfig({ ...config, alias });
}

export function apriGruppo(gruppo, contesto) {
  const { registro, mese, config, salvaConfig, alTocco, gruppi } = contesto;
  const velo = el('div', { class: 'velo' });
  const chiudi = () => velo.remove();

  const dentro = registro.filter((t) => meseDi(t) === mese
    && gruppo.grafie.includes(t.merchant) && !t.entrata && !t.fissa);

  const chips = el('div', { class: 'etichette' });
  const disegnaChips = (attuale) => {
    chips.replaceChildren(...etichette({ ...config, categorie: { ...(config.categorie ?? {}), [gruppo.chiave]: attuale } })
      .map((nome) => el('button', {
        class: 'etichetta' + (nome === attuale ? ' scelta' : ''),
        type: 'button', testo: nome,
        onclick: () => {
          const nuova = nome === attuale ? null : nome;
          scriviCategoria(config, gruppo.chiave, nuova, salvaConfig);
          config.categorie = { ...(config.categorie ?? {}) };
          if (nuova) config.categorie[gruppo.chiave] = nuova; else delete config.categorie[gruppo.chiave];
          disegnaChips(nuova);
        },
      })));
    chips.append(el('button', {
      class: 'etichetta nuova', type: 'button', testo: '+ altra',
      onclick: () => {
        const scritta = prompt('Come la chiami?', attuale ?? '');
        if (scritta === null) return;
        const pulita = scritta.trim().slice(0, 24);
        scriviCategoria(config, gruppo.chiave, pulita || null, salvaConfig);
        config.categorie = { ...(config.categorie ?? {}) };
        if (pulita) config.categorie[gruppo.chiave] = pulita; else delete config.categorie[gruppo.chiave];
        disegnaChips(pulita || null);
      },
    }));
  };
  disegnaChips(gruppo.categoria);

  const scelta = el('select', { class: 'unisci' }, [
    el('option', { value: '', testo: 'Unisci a un altro esercente…' }),
    ...gruppi.filter((g) => g.chiave !== gruppo.chiave)
      .slice()
      .sort((a, b) => (a.nome.toLowerCase() < b.nome.toLowerCase() ? -1 : 1))
      .map((g) => el('option', { value: g.nome, testo: g.nome })),
  ]);
  scelta.addEventListener('change', () => {
    if (!scelta.value) return;
    scriviAlias(config, gruppo, scelta.value, salvaConfig);
    chiudi();
  });

  velo.append(el('div', { class: 'foglio' }, [
    el('div', { class: 'presa' }),
    el('h2', { testo: gruppo.nome }),
    el('p', { class: 'aiuto', testo:
      `${gruppo.quante} ${gruppo.quante === 1 ? 'spesa' : 'spese'} `
      + `${aMese(nomeMese(mese).toLowerCase())}, `
      + `${euro(gruppo.totale)} in tutto${gruppo.quante > 1 ? `, ${euro(gruppo.media)} in media` : ''}.` }),

    el('div', { class: 'carta' }, [
      el('div', { class: 'campo' }, [
        el('span', { class: 'campo-testo' }, [
          'Categoria',
          el('small', { testo: 'La scegli tu una volta e resta attaccata a questo esercente. '
            + 'L’app non ne indovina nessuna da sola.' }),
        ]),
      ]),
      chips,
    ]),

    el('div', { class: 'carta', style: 'margin-top:14px' }, [
      el('div', { class: 'campo' }, [
        el('span', { class: 'campo-testo' }, [
          gruppo.unito ? 'Grafie unite' : 'Lo stesso posto, scritto in due modi?',
          el('small', { testo: gruppo.unito
            ? gruppo.grafie.join('  ·  ')
            : 'La banca scrive lo stesso esercente in modi diversi a seconda del terminale. '
              + 'Unendoli qui contano insieme, e nel registro restano scritti come sono.' }),
        ]),
      ]),
      el('div', { class: 'campo' }, [scelta]),
      gruppo.unito ? el('button', {
        class: 'bottone tenue', type: 'button', testo: 'Separa di nuovo',
        onclick: () => {
          scriviAlias(config, gruppo, null, salvaConfig);
          chiudi();
        },
      }) : null,
    ]),

    el('div', { class: 'carta', style: 'margin-top:14px' }, [
      el('div', { class: 'giorno' }, [
        el('span', { testo: 'Le spese' }),
        el('span', { class: 'totale soldi', testo: euro(gruppo.totale) }),
      ]),
      ...dentro.map((t) => spesa(t, (x) => {
        chiudi();
        alTocco(x);
      }, dataBreve(giornoDi(t)))),
    ]),

    el('div', { class: 'pila', style: 'margin-top:14px' }, [
      el('button', { class: 'bottone tenue', type: 'button', testo: 'Chiudi', onclick: chiudi }),
    ]),
  ]));

  velo.addEventListener('click', (e) => {
    if (e.target === velo) chiudi();
  });
  document.body.append(velo);
}

// --------------------------------------------------------------------------

export function vistaAnalisi(contesto) {
  const { registro, config, mese, vaiA, ridisegna, oggi } = contesto;
  if (!registro.length) {
    return el('div', { class: 'analisi carta sezione' }, [
      elencoVuoto('Ancora niente da raggruppare. Carica un estratto conto e torna qui.'),
    ]);
  }

  const elenco = mesiDelRegistro(registro);
  const corrente = elenco.includes(mese) ? mese : elenco[0];
  const r = riepilogoAnalitico(registro, corrente, config);
  const apri = (g) => apriGruppo(g, { ...contesto, mese: corrente, gruppi: r.gruppi });

  if (!r.quante) {
    return el('div', { class: 'analisi' }, [
      el('div', { class: 'carta sezione' }, [barraMesi(corrente, elenco, vaiA)]),
      el('div', { class: 'carta sezione' }, [elencoVuoto('Nessuna spesa variabile in questo mese.')]),
    ]);
  }

  return el('div', { class: 'analisi' }, [
    el('div', { class: 'carta sezione' }, [
      barraMesi(corrente, elenco, vaiA),
      el('div', { class: 'righe' }, [
        el('div', {}, [
          el('div', { class: 'valore soldi', testo: euroTondo(r.speso) }),
          el('div', { class: 'chiave', testo: 'spesi' }),
        ]),
        el('div', {}, [
          el('div', { class: 'valore soldi', testo: String(r.quante) }),
          el('div', { class: 'chiave', testo: 'spese' }),
        ]),
        el('div', {}, [
          el('div', { class: 'valore soldi', testo: String(r.esercenti) }),
          el('div', { class: 'chiave', testo: 'esercenti' }),
        ]),
      ]),
      // Un mese visto a meta' va detto qui e non in fondo: tutto quello che
      // segue e' calcolato su quei giorni, e senza saperlo si legge come se
      // fosse il mese intero.
      !r.copertura.completo ? el('div', { class: 'nota fioco', testo:
        `Il registro copre ${r.copertura.giorni} ${r.copertura.giorni === 1 ? 'giorno' : 'giorni'} `
        + `di questo mese, dal ${dataBreve(r.copertura.da)} al ${dataBreve(r.copertura.a)}.` }) : null,
    ]),

    dove(r, config, apri, ridisegna),
    ripete(r, apri, ridisegna),
    quando(registro, corrente),
    mesi(registro, oggi, corrente, vaiA),
  ].filter(Boolean));
}
