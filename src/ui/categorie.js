// La scelta della categoria, in un posto solo.
//
// Si sceglie in due fogli - quello di un esercente in Analisi e quello di una
// spesa sola - ma la categoria e' una, e sta sull'esercente: toccarla da una
// spesa vuol dire sceglierla per tutte quelle dello stesso posto, come fa la
// regola di Monarch "applica a tutte le transazioni di questo esercente". Due
// componenti diversi finirebbero per salvarla in due posti diversi.

import { el } from './comune.js';

// Etichette proposte, non assegnate. Nessuna finisce addosso a un esercente da
// sola: sono solo i tasti piu' comodi di una tastiera, e ce n'e' una per
// scriverne una qualsiasi.
export const SUGGERITE = ['Spesa', 'Casa', 'Auto', 'Bar e ristoranti', 'Salute', 'Svago', 'Persone', 'Abbonamenti'];

/** Le categorie gia' usate, piu' quelle con un limite, piu' quelle proposte. */
export function etichette(config) {
  const usate = [...new Set([
    ...Object.values(config?.categorie ?? {}).filter(Boolean),
    ...Object.keys(config?.limiti ?? {}),
  ])].sort((a, b) => a.localeCompare(b, 'it'));
  return [...usate, ...SUGGERITE.filter((s) => !usate.includes(s))];
}

/**
 * Le pastiglie delle categorie, con quella attuale accesa.
 *
 * `alCambio` riceve la nuova categoria, o `null` se si spegne quella accesa:
 * toccare due volte la stessa e' il modo di toglierla.
 */
export function sceltaCategoria(config, attuale, alCambio) {
  const chips = el('div', { class: 'etichette' });
  const disegna = (ora) => {
    const elenco = etichette(config);
    if (ora && !elenco.includes(ora)) elenco.unshift(ora);
    chips.replaceChildren(...elenco.map((nome) => el('button', {
      class: 'etichetta' + (nome === ora ? ' scelta' : ''),
      type: 'button', testo: nome,
      'aria-pressed': nome === ora ? 'true' : 'false',
      onclick: () => {
        const nuova = nome === ora ? null : nome;
        alCambio(nuova);
        disegna(nuova);
      },
    })), el('button', {
      class: 'etichetta nuova', type: 'button', testo: '+ altra',
      onclick: () => {
        const scritta = prompt('Come la chiami?', ora ?? '');
        if (scritta === null) return;
        const pulita = scritta.trim().slice(0, 24) || null;
        alCambio(pulita);
        disegna(pulita);
      },
    }));
  };
  disegna(attuale);
  return chips;
}
