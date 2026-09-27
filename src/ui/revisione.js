// La coda "da rivedere", in cima alla dashboard.
//
// Sta subito sotto il numero grande perche' quasi tutto quello che c'e' dentro
// lo rende meno vero: una lettura incerta puo' avere l'importo sbagliato, e
// un'assicurazione arrivata e non segnata se la sta mangiando il tetto. Se non
// c'e' niente da rivedere la carta non c'e': un "tutto a posto" permanente
// diventa rumore, e smette di farsi notare il giorno in cui serve.
//
// Ogni voce si sistema da qui, senza cambiare schermata: una lettura si apre
// nel foglio della spesa, una categoria si sceglie toccando l'esercente.

import { el, euro, nomeGiorno, nomeMese, siglaMese, stileTinta, iniziali } from './comune.js';
import { giornoDi } from '../domain/registro.js';
import { daRivedere, lasciaSenzaCategoria } from '../domain/revisione.js';
import { impostaCategoriaGruppo } from '../domain/statistiche.js';
import { staccaFondo } from '../domain/fondi.js';
import { sceltaCategoria } from './categorie.js';
import { spesa } from './registro.js';

// L'esercente aperto e se la coda e' tutta aperta. Vivono qui come il giorno
// scelto in Oggi: tornare sulla schermata ritrova la coda com'era.
let aperta = null;
let tutte = false;

// Oltre queste la coda si chiude sotto un tasto: in cima alla dashboard non
// deve spingere il resto fuori dallo schermo.
const QUANTE = 4;

const plurale = (n, uno, tanti) => `${n} ${n === 1 ? uno : tanti}`;

function riassunto(r) {
  return [
    r.letture ? plurale(r.letture, 'lettura incerta', 'letture incerte') : null,
    r.orfani ? plurale(r.orfani, 'spesa da un fondo tolto', 'spese da un fondo tolto') : null,
    r.scadenze ? plurale(r.scadenze, 'spesa non mensile attesa', 'spese non mensili attese') : null,
    r.categorie ? plurale(r.categorie, 'esercente senza categoria', 'esercenti senza categoria') : null,
  ].filter(Boolean).join(' · ');
}

function voce(v, { registro, config, alTocco, salvaConfig, salvaRegistro, ridisegna }) {
  if (v.tipo === 'lettura') {
    return spesa(v.transazione, alTocco, `${nomeGiorno(giornoDi(v.transazione))} · lettura da controllare`);
  }

  if (v.tipo === 'orfano') {
    const t = v.transazione;
    return el('div', { class: 'voce-coda' }, [
      spesa(t, alTocco, `${nomeGiorno(giornoDi(t))} · da un fondo che non c’e’ piu’`),
      el('div', { class: 'azioni-coda' }, [
        el('button', {
          class: 'etichetta', type: 'button', testo: 'Rimetti nel tetto',
          onclick: () => salvaRegistro(staccaFondo(registro, t.fondo)),
        }),
      ]),
    ]);
  }

  if (v.tipo === 'scadenza') {
    const f = v.fondo;
    return el('div', { class: 'spesa ricorrente' }, [
      el('span', { class: 'icona-stato attesa', 'aria-hidden': 'true', testo: siglaMese(f.scadenza) }),
      el('span', { class: 'nome' }, [
        el('b', { testo: f.nome || 'Spesa non mensile' }),
        el('small', { testo: f.scaduta
          ? `attesa da ${nomeMese(f.scadenza).toLowerCase()}: quando arriva, toccala e scegli il fondo`
          : 'arriva questo mese: quando passa, toccala e scegli il fondo' }),
      ]),
      el('span', { class: 'importo soldi fissa', testo: euro(f.serve) }),
    ]);
  }

  // Un esercente senza categoria: toccarlo apre le etichette sotto, sul posto.
  const g = v.gruppo;
  const aperto = aperta === v.chiave;
  return el('div', { class: 'voce-coda' + (aperto ? ' aperta' : '') }, [
    el('button', {
      class: 'spesa', type: 'button', 'aria-expanded': aperto ? 'true' : 'false',
      onclick: () => {
        aperta = aperto ? null : v.chiave;
        ridisegna();
      },
    }, [
      el('span', { class: 'sigillo', style: stileTinta(g.nome), testo: iniziali(g.nome) }),
      el('span', { class: 'nome' }, [
        el('b', { testo: g.nome }),
        el('small', { testo: `senza categoria · ${plurale(g.quante, 'spesa', 'spese')}` }),
      ]),
      el('span', { class: 'importo soldi', testo: euro(g.totale) }),
    ]),
    aperto ? el('div', { class: 'azioni-coda' }, [
      sceltaCategoria(config, null, (c) => {
        if (!c) return;
        aperta = null;
        salvaConfig(impostaCategoriaGruppo(config, g.chiave, c));
      }),
      el('button', {
        class: 'apri-tutto', type: 'button', testo: 'Va bene senza categoria',
        onclick: () => {
          aperta = null;
          salvaConfig(lasciaSenzaCategoria(config, g.chiave));
        },
      }),
    ]) : null,
  ]);
}

export function codaRevisione(contesto) {
  const { registro, config, oggi, ridisegna } = contesto;
  const r = daRivedere(registro, config, oggi);
  if (!r.quante) return null;

  // Una voce aperta resta visibile anche a coda chiusa: altrimenti scegliere
  // "mostra solo le prime" la farebbe sparire a meta' scelta.
  const mostrate = tutte ? r.voci
    : r.voci.filter((v, i) => i < QUANTE || v.chiave === aperta);

  return el('div', { class: 'carta sezione coda' }, [
    el('div', { class: 'testa-carta' }, [
      el('span', { testo: 'Da rivedere' }),
      el('span', { class: 'pastiglia attento', testo: String(r.quante) }),
    ]),
    el('div', { class: 'nota', testo: riassunto(r) }),
    ...mostrate.map((v) => voce(v, contesto)),
    r.quante > QUANTE ? el('button', {
      class: 'apri-tutto', type: 'button',
      testo: tutte ? 'Mostra solo le prime' : `Mostra tutte (${r.quante})`,
      onclick: () => {
        tutte = !tutte;
        ridisegna();
      },
    }) : null,
  ]);
}
