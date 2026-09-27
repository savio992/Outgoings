// Stipendio, uscite fisse, limiti per categoria, e le due porte del registro:
// export per Actual e il file JSONL da tenere su iCloud Drive.
//
// In cima c'e' il piano del mese alla Monarch: lo stipendio come una barra sola
// divisa in fisse, risparmio, speso e resto. E' la catena del tetto disegnata,
// ed e' il modo piu' corto di rispondere a "perche' il tetto e' cosi' basso".
//
// I campi di questa schermata non passano da `setConfig`: mentre si scrive si
// salva zitti e si aggiorna a mano il solo riquadro che dipende dai numeri.
// Avvisare il resto dell'app a ogni tasto ridisegnerebbe la vista, e con essa
// l'input che si sta usando - che perderebbe il fuoco a meta' parola.

import { el, euro, oggiIso, leggiNumero, nomeMese, dataBreve } from './comune.js';
import {
  statoGiorno, giorniDelMese, risparmioDeiMesi, dopoLeFisse, saldoStimato, ripartizioneMese, budgetCategorie,
} from '../domain/budget.js';
import { actualBudget } from '../domain/export.js';
import { daJsonl, merge, aJsonl, aBackup, daBackup } from '../domain/registro.js';
import { VERSIONE } from '../versione.js';

/**
 * Un file al volo. Su iOS il download di un blob apre il foglio di
 * condivisione, da cui si salva in File — cioe' su iCloud Drive.
 */
function scarica(nome, contenuto, mime) {
  const url = URL.createObjectURL(new Blob([contenuto], { type: mime }));
  const a = el('a', { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Campo per una cifra in euro: di testo, perche' la virgola deve passare. */
function campoEuro(valore, alCambio) {
  const input = el('input', {
    type: 'text', inputmode: 'decimal',
    autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
    value: valore ? String(valore).replace('.', ',') : '',
    placeholder: '0,00',
    oninput: () => {
      const n = leggiNumero(input.value);
      input.classList.toggle('sbagliato', Number.isNaN(n));
      if (!Number.isNaN(n)) alCambio(n);
    },
  });
  return input;
}

/**
 * Costringe il service worker a ricontrollare, e ricarica se e' cambiato
 * qualcosa. Su iOS una PWA installata sulla Home puo' restare indietro a lungo
 * da sola, e chiuderla e riaprirla non sempre basta.
 */
async function cercaAggiornamenti() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.update();
  } catch {
    // senza service worker non c'e' niente da aggiornare: ricaricare basta
  }
  location.reload();
}

export function vistaBudget(registroIniziale, configIniziale, setConfig, setRegistro, setConfigZitto) {
  const registro = registroIniziale;
  let config = configIniziale;

  const conto = el('div', { class: 'carta' });
  const piano = el('div', { class: 'sezione' });
  const limitiDinamici = [];

  /**
   * Lo stipendio in quattro pezzi. Si ridisegna a ogni tasto insieme al conto:
   * scrivere l'affitto e vedere il pezzo grigio allungarsi e' la spiegazione.
   */
  function disegnaPiano() {
    const r = ripartizioneMese(config, registro, oggiIso());
    if (!r.stipendio) {
      piano.replaceChildren();
      return;
    }
    const scala = Math.max(r.stipendio, r.totale, 1);
    const larghezza = (v) => `${((v / scala) * 100).toFixed(2)}%`;
    piano.replaceChildren(el('div', { class: 'carta' }, [
      el('div', { class: 'testa-carta' }, [
        el('span', { testo: 'Il piano del mese' }),
        el('span', { class: 'totale', testo: nomeMese(oggiIso().slice(0, 7)) }),
      ]),
      el('div', { class: 'ripartizione' }, [
        el('div', { class: 'cifra soldi' }, [euro(r.stipendio), el('small', { testo: ' di stipendio' })]),
        el('div', { class: 'pila-barra', role: 'img', 'aria-label': r.voci.map((v) => `${v.nome} ${euro(v.importo)}`).join(', ') },
          r.voci.filter((v) => v.importo > 0).map((v) => el('span', { class: `voce-${v.chiave}`, style: `width:${larghezza(v.importo)}` }))),
        el('div', { class: 'voci' }, r.voci.map((v) => el('div', {}, [
          el('i', { class: `voce-${v.chiave}` }),
          el('span', {}, [
            el('span', { class: 'quanto soldi', testo: euro(v.importo) }),
            el('span', { class: 'cosa', testo: v.nome }),
          ]),
        ]))),
      ]),
      // Lo sfondamento si dice a parole: nella barra e' gia' dentro "spese",
      // e un pezzo rosso in piu' sembrerebbe un'altra voce di spesa.
      r.eroso > 0 ? el('div', { class: 'avviso' }, [
        'Le spese hanno gia’ preso ', el('b', { class: 'soldi', testo: euro(r.eroso) }), ' dal risparmio',
        r.oltre > 0 ? [' e sono andate oltre lo stipendio di ', el('b', { class: 'soldi', testo: euro(r.oltre) })] : null,
        '.',
      ].flat().filter(Boolean)) : null,
    ]));
  }

  function disegnaConto() {
    disegnaPiano();
    for (const f of limitiDinamici) f();
    const s = statoGiorno(config, registro, oggiIso());
    const [anno, mese] = oggiIso().split('-').map(Number);
    const nelMese = giorniDelMese(anno, mese);

    // La catena per intero, nell'ordine in cui i soldi se ne vanno: prima le
    // uscite fisse, poi il risparmio, e solo quello che avanza diventa il
    // tetto. Scritta cosi' si vede subito qual e' il pezzo da toccare quando il
    // numero in fondo non piace.
    const passi = [`Dopo ${euro(s.usciteFisse)} di uscite fisse`];
    if (s.risparmio) passi.push(`e ${euro(s.risparmio)} messi da parte`);

    conto.replaceChildren(el('div', { class: 'esito' }, s.attiva
      ? [
        `${passi.join(' ')} restano `,
        el('b', { class: 'soldi', testo: euro(s.disponibile) }),
        ` per le spese di tutti i giorni. Su ${nelMese} giorni fanno `,
        el('b', { class: 'soldi', testo: euro(s.disponibile / nelMese) }),
        ' al giorno — ma il tetto vero si ricalcola ogni mattina su quello che e’ '
        + 'rimasto, quindi un giorno di troppo si recupera nei successivi.',
      ]
      : s.troppoRisparmio
        ? [
          'Fra uscite fisse e risparmio non resta niente per i giorni: ',
          el('b', { class: 'soldi', testo: euro(dopoLeFisse(config)) }),
          ` dopo le fisse, ${euro(s.risparmio)} da mettere da parte. `,
          'Abbassa l’obiettivo, o il tetto giornaliero non esiste.',
        ]
        : ['Inserisci lo stipendio per vedere il tetto giornaliero.']));
  }

  // Mentre si scrive: salva e aggiorna solo il riquadro del conto.
  const scrivendo = (patch) => {
    config = { ...config, ...patch };
    setConfigZitto(config);
    disegnaConto();
  };
  // Aggiungere o togliere una riga cambia la forma della lista: li' il
  // ridisegno serve, e nessun campo e' sotto le dita.
  const struttura = (patch) => setConfig({ ...config, ...patch });

  // Sempre lo stato di adesso, mai una copia presa all'inizio: catturandola
  // una volta sola, scrivere il nome e poi l'importo applicava il secondo alla
  // versione senza il primo, e il nome spariva. Lo stesso valeva per il tasto
  // che toglie una riga, che riscriveva lo stato di prima.
  const uscite = () => config.usciteFisse ?? [];
  const cambiaUscita = (i, patch) => scrivendo({
    usciteFisse: uscite().map((u, k) => (k === i ? { ...u, ...patch } : u)),
  });

  const importa = el('input', {
    type: 'file', accept: '.jsonl,.json,text/plain', style: 'display:none',
    onchange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const testo = await file.text();

      // Backup o registro semplice: si prova il primo e si ricade sul secondo,
      // invece di chiedere a chi importa che formato abbia il suo file.
      const backup = daBackup(testo);
      if (backup) {
        if (backup.config) {
          config = { ...config, ...backup.config };
          setConfigZitto(config);
        }
        setRegistro(merge(registro, backup.registro).registro);
      } else {
        setRegistro(merge(registro, daJsonl(testo)).registro);
      }
      e.target.value = '';
    },
  });

  /**
   * Mese per mese, quanto e' rimasto.
   *
   * Il tetto giornaliero dice come sta andando oggi; questa lista dice se a
   * fine mese sul conto e' rimasto qualcosa, che e' l'unica cosa che a fine
   * anno si vede. I mesi che il registro copre solo a meta' restano nella
   * lista ma fuori dal totale, segnati: un risparmio calcolato su mezzo mese di
   * spese verrebbe alto e falso.
   */
  function mesiRisparmio() {
    const { mesi, totale } = risparmioDeiMesi(config, registro, oggiIso());
    if (!mesi.length || !statoGiorno(config, registro, oggiIso()).attiva) return null;

    const contabili = mesi.filter((m) => m.contabile);

    return el('div', { class: 'sezione' }, [
      el('div', { class: 'titolo-sezione', testo: 'Mese per mese' }),
      el('div', { class: 'carta' }, [
        ...mesi.slice().reverse().map((m) => el('div', { class: 'campo riga-mese' }, [
          el('label', {}, [
            nomeMese(m.mese),
            m.inCorso ? el('span', { class: 'fioco', testo: ' · in corso' })
              : m.parziale ? el('span', { class: 'fioco', testo: ' · coperto a meta’' }) : null,
          ]),
          el('span', {
            // Un mese coperto a meta' non merita il verde: il numero e' alto
            // perche' mancano le spese, non perche' sia andata bene.
            class: 'soldi esito-mese'
              + (m.parziale ? ' incerto' : m.messoDaParte < 0 ? ' rosso' : ''),
            testo: euro(m.messoDaParte),
          }),
        ])),
        contabili.length > 1
          ? el('div', { class: 'campo riga-mese totale-mesi' }, [
            el('label', { testo: `Da parte in ${contabili.length} mesi chiusi` }),
            el('span', { class: 'soldi esito-mese' + (totale < 0 ? ' rosso' : ''), testo: euro(totale) }),
          ])
          : null,
        el('div', { class: 'avviso' }, [
          'Calcolato con lo stipendio e le uscite fisse di adesso: sui mesi passati '
          + 'e’ un’ipotesi, non un estratto conto.',
        ]),
      ]),
    ]);
  }

  /**
   * Il saldo del conto: lo scrive la banca, si corregge a mano.
   *
   * Il campo esiste perche' fra un estratto conto e l'altro passa un mese, e in
   * mezzo l'unica cosa che puo' rimettere a posto il numero sei tu. La data si
   * sposta a oggi quando lo tocchi: un saldo scritto adesso e' vero adesso, e
   * tenere la data vecchia farebbe risottrarre spese gia' contate.
   */
  function saldoConto() {
    const s = saldoStimato(config, registro, oggiIso());

    return el('div', { class: 'sezione' }, [
      el('div', { class: 'titolo-sezione', testo: 'Sul conto' }),
      el('div', { class: 'carta' }, [
        el('div', { class: 'campo' }, [
          el('label', { testo: 'Saldo' }),
          campoEuro(config.saldo?.importo, (v) => scrivendo({
            saldo: { ...config.saldo, importo: v, al: oggiIso() },
          })),
        ]),
        s
          ? el('div', { class: 'esito' }, [
            `Al ${dataBreve(s.al)}. `,
            s.movimentiDopo
              ? [`Da allora il registro ha ${s.movimentiDopo} `,
                `${s.movimentiDopo === 1 ? 'movimento' : 'movimenti'} che la banca non aveva ancora `,
                'contabilizzato, quindi adesso dovresti averne circa '].join('')
              : 'Nessun movimento dopo quella data, quindi dovrebbero essere ancora ',
            el('b', { class: 'soldi', testo: euro(s.stimato) }),
            '.',
          ])
          : el('div', { class: 'esito' }, [
            'Lo prende da solo dal file della banca — c’e’ scritto in cima all’estratto '
            + 'conto. Puoi anche scriverlo qui.',
          ]),
      ]),
    ]);
  }

  /**
   * I limiti per categoria, alla Monarch: un campo e una barra per ognuna.
   *
   * Le categorie in lista sono quelle che hai gia' usato e quelle con un
   * limite, non le proposte: un limite su "Auto" senza nessun esercente
   * etichettato Auto resterebbe a zero per sempre, e sembrerebbe un mese
   * virtuoso. Il campo non si ridisegna mentre ci si scrive: si aggiornano
   * solo la barra e il conto sotto, come per il riquadro del tetto.
   */
  function limitiCategoria() {
    const mese = oggiIso().slice(0, 7);
    const usate = [...new Set([
      ...Object.values(config.categorie ?? {}).filter(Boolean),
      ...Object.keys(config.limiti ?? {}),
    ])].sort((a, b) => a.localeCompare(b, 'it'));

    if (!usate.length) {
      return el('div', { class: 'sezione' }, [
        el('div', { class: 'titolo-sezione', testo: 'Limiti per categoria' }),
        el('div', { class: 'carta' }, [el('div', { class: 'esito' }, [
          'Le categorie si scelgono toccando una spesa, o un esercente in Analisi. '
          + 'Quando ce ne sono, qui puoi dare a ognuna un tetto per il mese.',
        ])]),
      ]);
    }

    const righe = usate.map((categoria) => {
      const sotto = el('div');
      const input = campoEuro(config.limiti?.[categoria], (v) => {
        scrivendo({ limiti: { ...(config.limiti ?? {}), [categoria]: v } });
      });
      limitiDinamici.push(() => {
        const b = budgetCategorie(config, registro, mese, oggiIso());
        const riga = b.righe.find((c) => c.categoria === categoria);
        const libera = b.senzaLimite.find((c) => c.categoria === categoria);
        if (!riga) {
          sotto.replaceChildren(el('div', { class: 'conto' }, [
            el('span', { class: 'soldi', testo: `${euro(libera?.speso ?? 0)} questo mese` }),
            el('span', { testo: 'nessun limite' }),
          ]));
          return;
        }
        sotto.replaceChildren(
          el('div', { class: `metro ${riga.stato}` + (riga.resto < 0 ? ' sotto-zero' : '') }, [
            el('span', { style: `width:${(Math.min(1, riga.quota) * 100).toFixed(1)}%` }),
          ]),
          el('div', { class: 'conto' }, [
            el('span', { class: 'soldi', testo: `${euro(riga.speso)} di ${euro(riga.limite)}` }),
            el('span', { class: `soldi ${riga.stato}`, testo: riga.resto < 0
              ? `${euro(-riga.resto)} oltre`
              : riga.alGiorno !== null ? `restano ${euro(riga.resto)} · ${euro(riga.alGiorno)} al giorno`
                : `restano ${euro(riga.resto)}` }),
          ]),
        );
      });
      return el('div', { class: 'limite' }, [
        el('div', { class: 'fila' }, [el('label', { testo: categoria }), input]),
        sotto,
      ]);
    });

    const piede = el('div', { class: 'avviso' });
    limitiDinamici.push(() => {
      const b = budgetCategorie(config, registro, mese, oggiIso());
      const frasi = [];
      if (b.disponibile > 0 && b.assegnato > 0) {
        frasi.push(b.daAssegnare >= 0
          ? `Assegnati ${euro(b.assegnato)} su ${euro(b.disponibile)} del mese: ${euro(b.daAssegnare)} restano liberi.`
          : `I limiti sommano ${euro(b.assegnato)}, ${euro(-b.daAssegnare)} piu’ di quello che il mese ha per i giorni.`);
      }
      if (b.senzaCategoria.totale > 0) {
        frasi.push(`${euro(b.senzaCategoria.totale)} di spese questo mese non hanno ancora una categoria.`);
      }
      // La regola che conta, detta ogni volta che si guarda un limite: il
      // tetto del giorno non si divide in scatole.
      frasi.push('Il tetto giornaliero non cambia: segue il totale, i limiti dicono solo dove vanno i soldi.');
      piede.replaceChildren(frasi.join(' '));
    });

    return el('div', { class: 'sezione' }, [
      el('div', { class: 'titolo-sezione', testo: 'Limiti per categoria' }),
      el('div', { class: 'carta' }, [...righe, piede]),
    ]);
  }

  const limiti = limitiCategoria();
  disegnaConto();

  return el('div', {}, [
    piano,

    el('div', { class: 'sezione' }, [
      el('div', { class: 'titolo-sezione', testo: 'Entrate' }),
      el('div', { class: 'carta' }, [
        el('div', { class: 'campo' }, [
          el('label', { testo: 'Stipendio mensile' }),
          campoEuro(config.stipendio, (v) => scrivendo({ stipendio: v })),
        ]),
      ]),
    ]),

    el('div', { class: 'sezione' }, [
      el('div', { class: 'titolo-sezione', testo: 'Uscite fisse' }),
      el('div', { class: 'carta' }, [
        ...uscite().map((u, i) => el('div', { class: 'campo' }, [
          el('input', {
            class: 'nome', type: 'text', value: u.nome ?? '',
            placeholder: 'Affitto, rata, abbonamento…',
            oninput: (e) => cambiaUscita(i, { nome: e.target.value }),
          }),
          campoEuro(u.importo, (v) => cambiaUscita(i, { importo: v })),
          el('button', {
            class: 'togli', type: 'button', testo: '×', 'aria-label': 'Togli',
            onclick: () => struttura({ usciteFisse: uscite().filter((_, k) => k !== i) }),
          }),
        ])),
        el('div', { class: 'campo' }, [
          el('button', {
            class: 'togli piu', type: 'button', testo: '+',
            onclick: () => struttura({ usciteFisse: [...uscite(), { nome: '', importo: 0 }] }),
          }),
          el('label', {
            class: 'fioco',
            testo: uscite().length ? 'Aggiungi un’altra uscita' : 'Aggiungi la prima uscita fissa',
          }),
        ]),
      ]),
    ]),

    saldoConto(),

    el('div', { class: 'sezione' }, [
      el('div', { class: 'titolo-sezione', testo: 'Risparmio' }),
      el('div', { class: 'carta' }, [
        el('div', { class: 'campo' }, [
          el('label', { testo: 'Da parte ogni mese' }),
          campoEuro(config.risparmio, (v) => scrivendo({ risparmio: v })),
        ]),
        el('div', { class: 'avviso' }, [
          'Questi soldi escono dal conto prima del tetto giornaliero, come una '
          + 'bolletta. E’ l’unico modo perche' + '’' + ' restino: se il risparmio e’ '
          + 'quello che avanza, il tetto se lo riprende tutto.',
        ]),
      ]),
    ]),

    el('div', { class: 'sezione' }, [
      el('div', { class: 'titolo-sezione', testo: 'Il tetto' }),
      conto,
    ]),

    limiti,

    mesiRisparmio(),

    el('div', { class: 'sezione pila' }, [
      el('div', { class: 'titolo-sezione', testo: 'Registro' }),
      el('button', {
        class: 'bottone tenue', type: 'button',
        testo: `Esporta CSV per Actual (${registro.length})`,
        onclick: () => scarica('briciole.csv', actualBudget.serializza(registro), actualBudget.mime),
      }),
      el('button', {
        class: 'bottone tenue', type: 'button', testo: 'Salva tutto su iCloud Drive',
        onclick: () => scarica('briciole-backup.json', aBackup(registro, config), 'application/json'),
      }),
      el('button', {
        class: 'bottone tenue', type: 'button', testo: 'Salva il solo registro (JSONL)',
        onclick: () => scarica('registro.jsonl', aJsonl(registro), 'application/x-ndjson'),
      }),
      importa,
      el('button', {
        class: 'bottone tenue', type: 'button', testo: 'Riprendi da un file salvato',
        onclick: () => importa.click(),
      }),
      el('button', {
        class: 'bottone pericolo', type: 'button', testo: 'Svuota il registro',
        onclick: () => {
          if (confirm('Cancello tutte le spese? Il file che hai esportato resta.')) setRegistro([]);
        },
      }),
    ]),

    el('div', { class: 'sezione' }, [
      el('div', { class: 'titolo-sezione', testo: 'Versione' }),
      el('div', { class: 'carta' }, [
        el('div', { class: 'campo' }, [
          el('label', { class: 'fioco', testo: 'Questa app' }),
          el('code', { class: 'versione', testo: VERSIONE }),
        ]),
        el('button', {
          class: 'campo cerca', type: 'button',
          onclick: cercaAggiornamenti,
        }, [el('label', { testo: 'Cerca aggiornamenti' })]),
      ]),
    ]),
  ]);
}
