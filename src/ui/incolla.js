// Il foglio d'ingresso dei dati. E' volutamente stupido: una textarea e un
// selettore di file. Da dove arrivi il testo - Live Text da Foto, uno Shortcut,
// un estratto conto scaricato - non e' affar suo.

import { el, euro, dataBreve } from './comune.js';
import { parseAppList, parseNotifications } from '../domain/parser.js';
import { parseEstrattoConto, parseEstrattoContoDaGriglia, stipendioDaMovimenti } from '../domain/banca.js';
import { leggiXlsx } from '../domain/xlsx.js';
import { merge, sostituisciPeriodo } from '../domain/registro.js';

/**
 * Che cosa mi hai dato? Non te lo chiedo: provo i tre lettori e tengo quello
 * che riconosce qualcosa.
 *
 * L'estratto conto per primo, perche' e' l'unico riconoscibile con certezza -
 * ha un'intestazione con colonne dai nomi precisi - mentre fra le due schermate
 * si decide a maggioranza di righe lette.
 */
export function leggiTesto(testo, adesso = new Date(), opzioni) {
  const banca = parseEstrattoConto(testo, opzioni);
  if (banca.movimenti.length) return { tipo: 'banca', banca };

  const app = parseAppList(testo, adesso);
  const notifiche = parseNotifications(testo, adesso);
  return notifiche.length > app.length
    ? { tipo: 'notifiche', lette: notifiche }
    : { tipo: 'app', lette: app };
}

function riga(...pezzi) {
  return el('div', {}, pezzi.filter(Boolean));
}

function riepilogoScreenshot(esito, tipo) {
  const { aggiunte, duplicate } = esito;
  const incerte = aggiunte.filter((t) => t.confidence === 'low').length;
  const totale = aggiunte.reduce((s, t) => s + t.amount, 0);

  const pezzi = [];
  pezzi.push(aggiunte.length
    ? riga(el('b', { testo: `${aggiunte.length} ${aggiunte.length === 1 ? 'spesa aggiunta' : 'spese aggiunte'}` }),
      ` per ${euro(totale)}.`)
    : riga('Nessuna spesa nuova.'));
  if (duplicate.length) {
    pezzi.push(riga(`${duplicate.length} ${duplicate.length === 1 ? 'era gia’ nel registro' : 'erano gia’ nel registro'}.`));
  }
  if (incerte) {
    pezzi.push(el('div', { class: 'nota' }, [
      `${incerte} ${incerte === 1 ? 'e’ da verificare' : 'sono da verificare'}: le trovi col pallino nel registro.`,
    ]));
  }
  pezzi.push(el('div', { class: 'minuta' }, [
    tipo === 'app' ? 'Letto come lista movimenti dell’app.' : 'Letto come Centro Notifiche.',
  ]));
  return el('div', { class: 'esito' }, pezzi);
}

function riepilogoBanca(banca, esito, stipendio) {
  const { movimenti, periodo, saltate } = banca;
  const spese = movimenti.filter((m) => !m.entrata && !m.fissa);
  const fisse = movimenti.filter((m) => m.fissa);
  const entrate = movimenti.filter((m) => m.entrata);

  const pezzi = [
    riga(el('b', { testo: `${spese.length} spese` }),
      ` per ${euro(spese.reduce((s, m) => s + m.amount, 0))}, `,
      periodo.da === periodo.a ? `il ${dataBreve(periodo.da)}.` : `dal ${dataBreve(periodo.da)} al ${dataBreve(periodo.a)}.`),
  ];
  if (fisse.length) {
    pezzi.push(riga(`${fisse.length} ${fisse.length === 1 ? 'uscita fissa' : 'uscite fisse'} `,
      `per ${euro(fisse.reduce((s, m) => s + m.amount, 0))}: non consumano il tetto giornaliero.`));
  }
  if (entrate.length) {
    pezzi.push(riga(`${entrate.length} ${entrate.length === 1 ? 'accredito' : 'accrediti'} `,
      `per ${euro(entrate.reduce((s, m) => s + m.amount, 0))}.`));
  }
  if (stipendio) {
    pezzi.push(el('div', { class: 'nota' }, [
      'Stipendio impostato a ', el('b', { testo: euro(stipendio.importo) }),
      ` da “${stipendio.nome}”. Cambialo in Budget se ho scelto male.`,
    ]));
  }
  if (esito.rimosse.length) {
    pezzi.push(el('div', { class: 'minuta' }, [
      `${esito.rimosse.length} letture dagli screenshot in quel periodo sono state sostituite: `,
      'l’estratto conto e’ piu’ preciso.',
    ]));
  }

  // Le righe scartate non sono una nota a pie' di pagina: se di cento movimenti
  // ne entrano otto, e' l'unica cosa che conta in questa schermata.
  if (saltate) {
    pezzi.push(el('div', { class: 'nota', style: 'margin-top:8px' }, [
      el('b', { testo: `${saltate} righe non lette` }),
      ` su ${movimenti.length + saltate}. Ecco come sono fatte:`,
    ]));
    pezzi.push(el('pre', { class: 'diagnostica' }, [
      (banca.diagnostica?.esempiSaltate ?? [])
        .map((r) => r.map((c) => c || '·').join('  |  ')).join('\n') || '(nessun esempio)',
    ]));
    const d = banca.diagnostica ?? {};
    pezzi.push(el('div', { class: 'minuta' }, [
      'Colonne: ',
      Object.entries(d.colonne ?? {}).map(([nome, i]) => `${nome}=${i}`).join(' '),
      ` · intestazione ${d.celleIntestazione ?? '?'} celle`,
      d.righeCorte ? ` · ${d.righeCorte} righe con un numero diverso di celle` : '',
      '. Manda questa schermata a chi ti ha fatto l’app.',
    ]));
  }
  return el('div', { class: 'esito' }, pezzi);
}

export function apriIncolla({ registro, config, salvaRegistro, salvaConfig }) {
  const area = el('textarea', {
    placeholder: 'Incolla qui il testo copiato dallo screenshot, o le righe dell’estratto conto…',
    autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
  });
  const esito = el('div');
  const velo = el('div', { class: 'velo' });
  const chiudi = () => velo.remove();

  function messaggio(...pezzi) {
    esito.replaceChildren(el('div', { class: 'carta' }, [el('div', { class: 'esito' }, pezzi)]));
  }

  /**
   * Quando il file non produce movimenti, invece di dire "non ha funzionato"
   * si mostra cosa il lettore ha effettivamente visto. E' l'unica cosa che
   * trasforma una segnalazione in una correzione senza un giro di domande.
   */
  function mostraDiagnostica(banca) {
    const d = banca.diagnostica ?? { righe: 0, primeRighe: [] };
    const pezzi = [riga(el('b', { testo: 'Non ho riconosciuto movimenti in questo file.' }))];

    pezzi.push(riga(d.righe
      ? `Ho letto ${d.righe} righe, ma `
        + (d.intestazione
          ? 'nessuna riga sotto l’intestazione somigliava a un movimento.'
          : 'non ho trovato l’intestazione con le colonne (data, importi, descrizione).')
      : 'Il foglio risulta vuoto.'));

    if (d.primeRighe.length) {
      pezzi.push(el('div', { class: 'minuta', style: 'margin-top:8px' }, ['Le prime righe che ho letto:']));
      pezzi.push(el('pre', { class: 'diagnostica' }, [
        d.primeRighe.map((r, i) => `${i + 1}  ${r.map((c) => c || '·').join('  |  ')}`).join('\n'),
      ]));
      pezzi.push(el('div', { class: 'minuta' }, [
        'Manda questa schermata a chi ti ha fatto l’app: dice esattamente ',
        'com’e’ fatto il tuo file.',
      ]));
    }
    esito.replaceChildren(el('div', { class: 'carta' }, [el('div', { class: 'esito' }, pezzi)]));
  }

  function applica(letto) {
    if (letto.tipo === 'banca') {
      const { banca } = letto;
      if (!banca.movimenti.length) {
        mostraDiagnostica(banca);
        return false;
      }
      // Dentro il periodo coperto vince la banca: gli esercenti li chiama in un
      // altro modo, quindi le due letture della stessa spesa non si
      // riconoscerebbero mai fra loro.
      const risultato = sostituisciPeriodo(registro, banca.movimenti, banca.periodo.da, banca.periodo.a);
      const stipendio = stipendioDaMovimenti(banca.movimenti);
      if (stipendio) salvaConfig({ ...config, stipendio: stipendio.importo });
      salvaRegistro(risultato.registro);
      esito.replaceChildren(el('div', { class: 'carta' }, [riepilogoBanca(banca, risultato, stipendio)]));
      return true;
    }

    const risultato = merge(registro, letto.lette);
    if (!risultato.aggiunte.length && !risultato.duplicate.length) {
      messaggio('Non ho riconosciuto niente. Controlla di aver copiato la lista dei movimenti, ',
        'il Centro Notifiche o le righe dell’estratto conto — oppure scegli il file .xlsx della banca.');
      return false;
    }
    esito.replaceChildren(el('div', { class: 'carta' }, [riepilogoScreenshot(risultato, letto.tipo)]));
    if (!risultato.aggiunte.length) return false;
    salvaRegistro(risultato.registro);
    return true;
  }

  // I nomi che il registro usa gia': un import nuovo si allinea a quelli invece
  // di rinominare tutto lo storico.
  const opzioniBanca = () => ({
    fisse: config.fisse,
    nomiNoti: [...new Set(registro.map((t) => t.merchant))],
  });

  const elabora = (testo) => applica(leggiTesto(testo, new Date(), opzioniBanca()));

  /**
   * Un .xlsx entra dalla porta della griglia, senza passare da un testo
   * intermedio: le descrizioni della banca sono piene di spazi doppi, e
   * riserializzarle in CSV per poi rileggerle sarebbe solo un modo di perdere
   * qualcosa per strada.
   *
   * Fra i fogli vince quello con piu' movimenti: certi export mettono davanti
   * una copertina, e il primo foglio non e' sempre quello giusto.
   */
  async function elaboraXlsx(scelto) {
    let fogli;
    try {
      fogli = await leggiXlsx(await scelto.arrayBuffer());
    } catch (errore) {
      messaggio('Non riesco ad aprire questo file. ',
        typeof DecompressionStream === 'undefined'
          ? 'Il tuo iOS e’ troppo vecchio per leggere gli .xlsx: esporta in CSV.'
          : String(errore.message ?? errore));
      return false;
    }

    let migliore = { movimenti: [], periodo: null, saltate: 0 };
    for (const foglio of fogli) {
      const letto = parseEstrattoContoDaGriglia(foglio.righe, opzioniBanca());
      if (letto.movimenti.length > migliore.movimenti.length) migliore = letto;
    }
    return applica({ tipo: 'banca', banca: migliore });
  }

  const conferma = el('button', {
    class: 'bottone', type: 'button', testo: 'Leggi',
    onclick: () => {
      // Nessuna chiusura automatica: l'esito dice quante righe sono entrate e
      // quante no, e chiuderglielo sotto il naso dopo un secondo e mezzo vuol
      // dire non averglielo detto.
      if (elabora(area.value)) conferma.textContent = 'Fatto — chiudi quando hai letto';
    },
  });

  const file = el('input', {
    type: 'file',
    accept: '.xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain',
    style: 'display:none',
    onchange: async (e) => {
      const scelto = e.target.files?.[0];
      if (!scelto) return;
      e.target.value = '';
      if (/\.xlsx$/i.test(scelto.name)) await elaboraXlsx(scelto);
      else elabora(await scelto.text());
    },
  });

  velo.append(el('div', { class: 'foglio' }, [
    el('div', { class: 'presa' }),
    el('h2', { testo: 'Aggiungi spese' }),
    el('p', {
      class: 'aiuto',
      testo: 'Dalla banca: scegli il file .xlsx che hai scaricato, senza aprirlo. '
        + 'Da uno screenshot: aprilo in Foto, tieni premuto sul testo e scegli “Copia testo”, poi incolla qui.',
    }),
    el('div', { class: 'pila' }, [
      area,
      esito,
      conferma,
      file,
      el('button', {
        class: 'bottone tenue', type: 'button',
        testo: 'Scegli il file della banca (.xlsx)',
        onclick: () => file.click(),
      }),
      el('button', { class: 'bottone tenue', type: 'button', testo: 'Annulla', onclick: chiudi }),
    ]),
  ]));

  velo.addEventListener('click', (e) => {
    if (e.target === velo) chiudi();
  });
  document.body.append(velo);
  area.focus();
}
