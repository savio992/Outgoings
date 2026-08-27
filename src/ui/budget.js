// Stipendio, uscite fisse, e le due porte del registro: export per Actual e il
// file JSONL da tenere su iCloud Drive.
//
// I campi di questa schermata non passano da `setConfig`: mentre si scrive si
// salva zitti e si aggiorna a mano il solo riquadro che dipende dai numeri.
// Avvisare il resto dell'app a ogni tasto ridisegnerebbe la vista, e con essa
// l'input che si sta usando - che perderebbe il fuoco a meta' parola.

import { el, euro, oggiIso, leggiNumero } from './comune.js';
import { statoGiorno, giorniDelMese } from '../domain/budget.js';
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
    conto.replaceChildren(el('div', { class: 'esito' }, s.attiva
      ? [
        `Dopo ${euro(s.usciteFisse)} di uscite fisse restano `,
        el('b', { class: 'soldi', testo: euro(s.disponibile) }),
        ` per le spese di tutti i giorni. Su ${nelMese} giorni fanno `,
        el('b', { class: 'soldi', testo: euro(s.disponibile / nelMese) }),
        ' al giorno — ma il tetto vero si ricalcola ogni mattina su quello che e’ '
        + 'rimasto, quindi un giorno di troppo si recupera nei successivi.',
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

  const uscite = config.usciteFisse ?? [];
  const cambiaUscita = (i, patch) => scrivendo({
    usciteFisse: uscite.map((u, k) => (k === i ? { ...u, ...patch } : u)),
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
        ...uscite.map((u, i) => el('div', { class: 'campo' }, [
          el('input', {
            class: 'nome', type: 'text', value: u.nome ?? '',
            placeholder: 'Affitto, rata, abbonamento…',
            oninput: (e) => cambiaUscita(i, { nome: e.target.value }),
          }),
          campoEuro(u.importo, (v) => cambiaUscita(i, { importo: v })),
          el('button', {
            class: 'togli', type: 'button', testo: '×', 'aria-label': 'Togli',
            onclick: () => struttura({ usciteFisse: uscite.filter((_, k) => k !== i) }),
          }),
        ])),
        el('div', { class: 'campo' }, [
          el('button', {
            class: 'togli piu', type: 'button', testo: '+',
            onclick: () => struttura({ usciteFisse: [...uscite, { nome: '', importo: 0 }] }),
          }),
          el('label', {
            class: 'fioco',
            testo: uscite.length ? 'Aggiungi un’altra uscita' : 'Aggiungi la prima uscita fissa',
          }),
        ]),
      ]),
    ]),

    el('div', { class: 'sezione' }, [
      el('div', { class: 'titolo-sezione', testo: 'Il conto' }),
      conto,
    ]),

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
