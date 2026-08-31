// Il foglio per correggere una spesa.
//
// E' la meta' mancante di `confidence: 'low'`: marcare una lettura incerta non
// serve a niente se poi non la si puo' sistemare. Qui si cambia quello che l'OCR
// puo' aver sbagliato - nome, importo, giorno - e si elimina cio' che non
// doveva esserci.

import { el, euro, leggiNumero } from './comune.js';
import { correggi, elimina } from '../domain/registro.js';
import { chiaveFissa } from '../domain/banca.js';
import { isoDelGiorno } from '../domain/tempo.js';

/**
 * Tiene aggiornato l'elenco di cio' che al prossimo import vale come uscita
 * fissa. Si ricorda il beneficiario *e la causale*: allo stesso nome vanno sia
 * il mutuo sia i pannolini, e ricordare solo il nome li marcherebbe entrambi.
 *
 * La usa anche il foglio delle spese a mano: e' la stessa promessa fatta dalla
 * stessa casella, e due modi diversi di ricordarla vorrebbero dire una fissa
 * che sparisce a seconda di dove l'hai marcata.
 */
export function ricordaFissa(config, nome, causale, fissa, salvaConfig) {
  const chiave = chiaveFissa(nome, causale);
  const attuali = (config?.fisse ?? []).filter((v) => (typeof v === 'string'
    ? chiaveFissa(v, null) !== chiave
    : chiaveFissa(v?.nome, v?.causale) !== chiave));
  salvaConfig({ ...config, fisse: fissa ? [...attuali, { nome, causale: causale ?? null }] : attuali });
}

export function apriModifica(transazione, registro, salva, config, salvaConfig) {
  const velo = el('div', { class: 'velo' });
  const chiudi = () => velo.remove();

  const nome = el('input', {
    class: 'nome', type: 'text', value: transazione.merchant, autocapitalize: 'words',
  });
  // Di testo e non `type="number"`: con la tastiera italiana l'importo si
  // scrive con la virgola, e un campo numerico che la riceve restituisce
  // stringa vuota - cioe' zero, senza dirlo.
  const importo = el('input', {
    type: 'text', inputmode: 'decimal',
    autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
    value: transazione.amount.toFixed(2).replace('.', ','),
  });
  const giorno = el('input', { type: 'date', value: transazione.occurredAt.slice(0, 10) });

  // Mutuo e rate condominiali si pagano con un bonifico esattamente come i
  // pannolini: nessuna regola puo' distinguerli guardando la causale. Lo dici
  // tu una volta, e da li' in avanti l'app lo sa per quel beneficiario.
  const fissa = el('input', { type: 'checkbox', class: 'interruttore' });
  fissa.checked = Boolean(transazione.fissa);

  const salvaModifiche = () => {
    const valore = leggiNumero(importo.value);
    if (!nome.value.trim() || !Number.isFinite(valore) || valore <= 0 || !giorno.value) {
      importo.classList.toggle('sbagliato', !(valore > 0));
      return;
    }

    // L'orario si conserva se c'era davvero (notifica o ANCS); le spese lette
    // dalla lista non ne hanno mai avuto uno e restano a mezzanotte.
    const [ora, minuto] = transazione.timeKnown
      ? transazione.occurredAt.slice(11, 16).split(':').map(Number)
      : [0, 0];

    const nuovoNome = nome.value.trim();
    if (salvaConfig) ricordaFissa(config, nuovoNome, transazione.causale, fissa.checked, salvaConfig);

    salva(correggi(registro, transazione.id, {
      merchant: nuovoNome,
      amount: Math.round(valore * 100) / 100,
      occurredAt: isoDelGiorno(giorno.value, ora, minuto),
      fissa: fissa.checked,
    }));
    chiudi();
  };

  velo.append(el('div', { class: 'foglio' }, [
    el('div', { class: 'presa' }),
    el('h2', { testo: 'Correggi la spesa' }),
    el('p', {
      class: 'aiuto',
      testo: transazione.confidence === 'low'
        ? 'Questa lettura non era sicura: controllala sullo screenshot.'
        : 'Quello che cambi qui resta anche se reimporti la stessa schermata.',
    }),

    el('div', { class: 'carta' }, [
      el('div', { class: 'campo' }, [el('label', { testo: 'Esercente' }), nome]),
      el('div', { class: 'campo' }, [el('label', { testo: 'Importo' }), importo]),
      el('div', { class: 'campo' }, [el('label', { testo: 'Giorno' }), giorno]),
      transazione.entrata ? null : el('label', { class: 'campo' }, [
        el('span', { class: 'campo-testo' }, [
          'Uscita fissa',
          // Cosa esattamente l'app si ricordera' va detto qui: "vale anche per
          // i prossimi" da solo lascia credere che valga per tutti i bonifici
          // a quel nome, e per lo stesso nome ci passano il mutuo e i pannolini.
          el('small', {
            testo: `Non consuma il tetto giornaliero. Al prossimo import vale per ${
              transazione.causale
                ? `«${transazione.merchant} · ${transazione.causale}»`
                : `tutto cio' che va a «${transazione.merchant}»`}.`,
          }),
        ]),
        fissa,
      ]),
    ]),

    el('div', { class: 'pila', style: 'margin-top:14px' }, [
      el('button', { class: 'bottone', type: 'button', testo: 'Salva', onclick: salvaModifiche }),
      el('button', { class: 'bottone tenue', type: 'button', testo: 'Annulla', onclick: chiudi }),
      el('button', {
        class: 'bottone pericolo', type: 'button',
        testo: `Elimina questa spesa (${euro(transazione.amount)})`,
        onclick: () => {
          salva(elimina(registro, transazione.id));
          chiudi();
        },
      }),
    ]),
  ]));

  velo.addEventListener('click', (e) => {
    if (e.target === velo) chiudi();
  });
  document.body.append(velo);
}
