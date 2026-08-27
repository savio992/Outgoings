// Stipendio, uscite fisse, e le due porte del registro: export per Actual e il
// file JSONL da tenere su iCloud Drive.
//
// I campi di questa schermata non passano da `setConfig`: mentre si scrive si
// salva zitti e si aggiorna a mano il solo riquadro che dipende dai numeri.
// Avvisare il resto dell'app a ogni tasto ridisegnerebbe la vista, e con essa
// l'input che si sta usando - che perderebbe il fuoco a meta' parola.

import { el, euro, oggiIso, leggiNumero, nomeMese } from './comune.js';
import { statoGiorno, giorniDelMese, risparmioDeiMesi, dopoLeFisse } from '../domain/budget.js';
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

  function disegnaConto() {
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

  disegnaConto();

  return el('div', {}, [
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
      el('div', { class: 'titolo-sezione', testo: 'Il conto' }),
      conto,
    ]),

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
