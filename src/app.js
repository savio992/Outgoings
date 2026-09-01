// Briciole — le piccole spese che si sommano.
//
// Il nome del prodotto sta qui e nel manifest, e da nessun'altra parte: se un
// giorno diventa un'altra cosa, si cambiano due stringhe.

import { el, icona, ICONE, oggiIso } from './ui/comune.js';
import { carica, getRegistro, getConfig, setRegistro, setConfig, setConfigZitto, osserva } from './store.js';
import { vistaOggi } from './ui/oggi.js';
import { vistaRegistro } from './ui/registro.js';
import { vistaAnalisi } from './ui/analisi.js';
import { vistaBudget } from './ui/budget.js';
import { apriIncolla } from './ui/incolla.js';
import { apriModifica } from './ui/modifica.js';
import { apriAggiungi } from './ui/aggiungi.js';
import { meseDi } from './domain/registro.js';
import { mancaAllaMezzanotte } from './domain/tempo.js';

export const NOME = 'Briciole';

const VISTE = [
  { id: 'oggi', nome: 'Oggi', icona: ICONE.oggi },
  { id: 'registro', nome: 'Registro', icona: ICONE.registro },
  { id: 'analisi', nome: 'Analisi', icona: ICONE.analisi },
  { id: 'budget', nome: 'Budget', icona: ICONE.budget },
];

let vista = 'oggi';
// Il mese aperto. Registro e Analisi lo condividono apposta: passare da
// "cosa e' successo ad agosto" a "dove sono finiti i soldi ad agosto" e'
// la stessa domanda vista da due lati, e ritrovarsi su un altro mese
// cambiando tab vorrebbe dire rifare la strada ogni volta.
// `null` vuol dire "quello piu' recente", cosi' dopo un import il registro
// si apre dove sono arrivati i dati nuovi.
let mese = null;

const DATA = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome',
});

/** In italiano i mesi vanno minuscoli: maiuscola solo la prima lettera. */
function dataDiOggi() {
  const t = DATA.format(new Date());
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Toccare una spesa la apre in correzione, da qualunque elenco. */
function correggi(t) {
  apriModifica(t, getRegistro(), setRegistro, getConfig(), setConfig);
}

function corpo() {
  const registro = getRegistro();
  const config = getConfig();
  const vaiA = (nuovo) => {
    mese = nuovo;
    disegna();
    scrollTo({ top: 0 });
  };
  if (vista === 'registro') {
    return vistaRegistro(registro, correggi, mese ?? oggiIso().slice(0, 7), vaiA);
  }
  if (vista === 'analisi') {
    return vistaAnalisi({
      registro,
      config,
      mese: mese ?? oggiIso().slice(0, 7),
      vaiA,
      // Le classifiche aperte e il taglio scelto vivono dentro la vista: per
      // ridisegnarle basta rifare il giro da qui, senza passarli in giro.
      ridisegna: disegna,
      oggi: oggiIso(),
      salvaConfig: setConfig,
      alTocco: correggi,
    });
  }
  if (vista === 'budget') return vistaBudget(registro, config, setConfig, setRegistro, setConfigZitto);
  return vistaOggi(registro, config, correggi);
}

/**
 * I modi di far entrare una spesa, uno sotto l'altro in fondo alla schermata.
 *
 * Stanno insieme perche' rispondono alla stessa domanda - come ci arriva questa
 * spesa nel registro - e il tasto a mano compare anche nel Registro: che una
 * spesa in contanti non l'hai segnata te ne accorgi guardando il giorno in cui
 * manca, non stando su Oggi.
 */
function azioni() {
  const pezzi = [];
  if (vista === 'oggi') {
    pezzi.push(el('button', {
      class: 'bottone', type: 'button', testo: 'Incolla uno screenshot',
      onclick: () => apriIncolla({
        registro: getRegistro(),
        config: getConfig(),
        salvaRegistro: setRegistro,
        salvaConfig: setConfig,
      }),
    }));
  }
  if (vista === 'oggi' || vista === 'registro') {
    pezzi.push(el('button', {
      class: 'bottone tenue', type: 'button', testo: 'Scrivi una spesa a mano',
      onclick: () => apriAggiungi({
        leggiRegistro: getRegistro,
        leggiConfig: getConfig,
        salvaRegistro: setRegistro,
        salvaConfig: setConfig,
        // Una spesa segnata su un mese che non stai guardando entrerebbe davvero
        // ma a schermo non succederebbe niente, e il tasto sembrerebbe rotto.
        dopoSalvato: (t) => { mese = meseDi(t); },
      }),
    }));
  }
  return pezzi.length ? el('div', { class: 'pila' }, pezzi) : null;
}

function navigazione() {
  return el('nav', { class: 'nav' }, VISTE.map((v) => el('button', {
    type: 'button',
    'aria-current': vista === v.id ? 'page' : null,
    onclick: () => {
      vista = v.id;
      disegna();
      scrollTo({ top: 0 });
    },
  }, [icona(v.icona), el('span', { testo: v.nome })])));
}

function disegna() {
  const app = document.getElementById('app');
  // replaceChildren scrive "null" a schermo se gli si passa un null: i pezzi
  // opzionali vanno filtrati prima, non passati e sperati.
  app.replaceChildren(...[
    el('header', { class: 'intestazione' }, [
      el('div', { class: 'marchio' }, [NOME.slice(0, 3), el('span', { testo: NOME.slice(3) })]),
      el('div', { class: 'data', testo: dataDiOggi() }),
    ]),
    corpo(),
    azioni(),
  ].filter(Boolean));

  const vecchia = document.querySelector('.nav');
  if (vecchia) vecchia.remove();
  document.body.append(navigazione());
}

/**
 * Ridisegna quando cambia il giorno.
 *
 * Una PWA installata sulla Home non viene quasi mai chiusa: e' la stessa pagina
 * per settimane, e la data l'ha letta una volta sola all'apertura. Senza
 * qualcuno che la ricontrolli, a mezzanotte il tetto resta quello di ieri e la
 * striscia dei sette giorni finisce sul giorno sbagliato - e a schermo non
 * sembra un orologio fermo, sembra un'app che ha smesso di contare.
 *
 * Ci vogliono tutte e due le sponde. Gli eventi di risveglio non coprono l'app
 * lasciata aperta a cavallo di mezzanotte, e su iOS in standalone il ritorno
 * dallo sfondo non sempre passa da `visibilitychange` - per quello c'e' anche
 * `pageshow`, che e' la strada della bfcache. La sveglia di mezzanotte non
 * copre il caso opposto: in background iOS sospende i timer, e quello che
 * doveva suonare alle 00:00 suona quando riapri. Per questo il confronto e'
 * sempre sulla data vera e mai sul fatto che la sveglia sia suonata: se e'
 * suonata tardi il giro seguente rimette a posto l'ora, se e' suonata presto
 * non ridisegna niente.
 */
function orologio() {
  let giorno = oggiIso();
  let sveglia = null;

  // Il secondo in piu' e' perche' la sveglia non suoni sul confine: puntata
  // esatta puo' scattare un istante prima, trovare ancora la data di ieri e
  // ripuntarsi sullo stesso istante, in cerchio.
  const punta = () => {
    clearTimeout(sveglia);
    sveglia = setTimeout(controlla, mancaAllaMezzanotte(giorno, Date.now()) + 1000);
  };

  function controlla() {
    if (oggiIso() !== giorno) {
      giorno = oggiIso();
      disegna();
    }
    punta();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') controlla();
  });
  // Il ritorno dalla bfcache: su iOS e' la strada che l'app installata prende
  // piu' spesso, e da sola non fa scattare `visibilitychange`.
  window.addEventListener('pageshow', controlla);
  punta();
}

export function avvia() {
  carica();
  osserva(disegna);
  disegna();
  orologio();
}
