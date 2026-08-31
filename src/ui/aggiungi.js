// Il foglio per scrivere una spesa a mano.
//
// E' la sorgente che non ha un OCR dietro, e serve per quello che le altre tre
// non possono vedere: i contanti - nell'estratto conto c'e' il prelievo, non il
// caffe' - e le spese che nessuna notifica ha annunciato. Per questo la riga che
// esce di qui non e' un ripiego: e' l'unico posto in cui quel dato esiste, e il
// registro la tratta di conseguenza (vedi `laRiscriveLaBanca`).
//
// Tre campi e basta. L'orario non si chiede: il tetto e' del giorno, non
// dell'ora, e ogni campo in piu' e' un motivo per non segnare il caffe'.

import { el, euro, leggiNumero, oggiIso, nomeGiorno } from './comune.js';
import { merge, transazioneAMano, esercentiAMano, giornoDi } from '../domain/registro.js';
import { ricordaFissa } from './modifica.js';

export function apriAggiungi({ leggiRegistro, leggiConfig, salvaRegistro, salvaConfig, dopoSalvato }) {
  const velo = el('div', { class: 'velo' });
  const chiudi = () => velo.remove();

  const nome = el('input', {
    class: 'nome', type: 'text', placeholder: 'Dove?', autocapitalize: 'words',
    autocorrect: 'off', spellcheck: 'false',
  });
  // Di testo e non `type="number"`, per lo stesso motivo del foglio di
  // correzione: la tastiera decimale italiana da' la virgola, e un campo
  // numerico che la riceve restituisce stringa vuota, cioe' zero senza dirlo.
  const importo = el('input', {
    type: 'text', inputmode: 'decimal', placeholder: '0,00',
    autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
  });
  const giorno = el('input', { type: 'date', value: oggiIso(), max: oggiIso() });
  const fissa = el('input', { type: 'checkbox', class: 'interruttore' });

  const esito = el('div');

  // Le grafie che hai gia' scritto tu, come tasti. Non sono suggerimenti sul
  // cosa segnare: servono a riscrivere il nome *identico*, perche' "Bar Gocce"
  // e "Bar gocce" nelle classifiche diventerebbero due posti diversi.
  const recenti = esercentiAMano(leggiRegistro());
  const scorciatoie = recenti.length
    ? el('div', { class: 'campo' }, [
      el('div', { class: 'etichette' }, recenti.map((n) => el('button', {
        class: 'etichetta', type: 'button', testo: n,
        onclick: () => {
          nome.value = n;
          nome.classList.remove('sbagliato');
          importo.focus();
        },
      }))),
    ])
    : null;

  const annulla = el('button', {
    class: 'bottone tenue', type: 'button', testo: 'Annulla', onclick: chiudi,
  });

  function salva() {
    const valore = leggiNumero(importo.value);
    nome.classList.toggle('sbagliato', !nome.value.trim());
    importo.classList.toggle('sbagliato', !(valore > 0));
    if (!nome.value.trim() || !(valore > 0) || !giorno.value) return;

    const registro = leggiRegistro();
    const nuova = transazioneAMano({
      merchant: nome.value, amount: valore, giorno: giorno.value, fissa: fissa.checked,
    }, registro);
    if (!nuova) return;

    // Dalla stessa porta di tutto il resto: cosi' una spesa scritta due volte
    // per sbaglio nello stesso istante non entra due volte, e la regola sul
    // periodo dell'estratto conto e' una sola.
    const risultato = merge(registro, [nuova]);
    if (!risultato.aggiunte.length) {
      esito.replaceChildren(el('div', { class: 'carta' }, [
        el('div', { class: 'esito' }, ['Questa spesa c’era gia’ nel registro.']),
      ]));
      return;
    }

    const config = leggiConfig();
    if (salvaConfig) ricordaFissa(config, nuova.merchant, null, fissa.checked, salvaConfig);
    salvaRegistro(risultato.registro);
    if (dopoSalvato) dopoSalvato(nuova);

    // Nessuna chiusura automatica: di spese in contanti se ne segnano tre di
    // fila, e riaprire il foglio ogni volta vorrebbe dire non segnarne nessuna.
    // Il nome e l'importo si svuotano, il giorno resta dov'e'.
    esito.replaceChildren(el('div', { class: 'carta' }, [
      el('div', { class: 'esito' }, [
        el('b', { testo: `${nuova.merchant} · ${euro(nuova.amount)}` }),
        ` · ${nomeGiorno(giornoDi(nuova)).toLowerCase()}.`,
        el('div', { class: 'minuta' }, ['Scrivine un’altra, o chiudi.']),
      ]),
    ]));
    nome.value = '';
    importo.value = '';
    fissa.checked = false;
    annulla.textContent = 'Chiudi';
    nome.focus();
  }

  velo.append(el('div', { class: 'foglio' }, [
    el('div', { class: 'presa' }),
    el('h2', { testo: 'Spesa a mano' }),
    el('p', {
      class: 'aiuto',
      testo: 'Per i contanti e per quello che l’app non ha visto passare. '
        + 'L’estratto conto non la tocca: quello che scrivi qui resta.',
    }),

    el('div', { class: 'pila' }, [
      el('div', { class: 'carta' }, [
        el('div', { class: 'campo' }, [el('label', { testo: 'Esercente' }), nome]),
        scorciatoie,
        el('div', { class: 'campo' }, [el('label', { testo: 'Importo' }), importo]),
        el('div', { class: 'campo' }, [el('label', { testo: 'Giorno' }), giorno]),
        el('label', { class: 'campo' }, [
          el('span', { class: 'campo-testo' }, [
            'Uscita fissa',
            el('small', {
              testo: 'Non consuma il tetto giornaliero. Al prossimo import vale '
                + 'per tutto cio’ che va allo stesso nome.',
            }),
          ]),
          fissa,
        ]),
      ]),
      esito,
      el('button', { class: 'bottone', type: 'button', testo: 'Aggiungi', onclick: salva }),
      annulla,
    ]),
  ]));

  // Invio dal campo dell'importo: e' l'ultimo che si compila davvero.
  importo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') salva();
  });

  velo.addEventListener('click', (e) => {
    if (e.target === velo) chiudi();
  });
  document.body.append(velo);
  nome.focus();
}
