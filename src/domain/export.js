// L'export sta dietro un'interfaccia, cosi' cambiare destinazione domani
// (Google Sheet, Firefly III) e' aggiungere un oggetto qui e non toccare altro.
//
// Una Destinazione e':
//   { id, nome, estensione, mime, serializza(transazioni) -> string }

import { giornoDi } from './registro.js';

/** Virgolette solo dove servono, raddoppiate all'interno. Regola RFC 4180. */
function campo(valore) {
  const s = String(valore ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function riga(campi) {
  return campi.map(campo).join(',');
}

export const actualBudget = {
  id: 'actual-budget',
  nome: 'Actual Budget',
  estensione: 'csv',
  mime: 'text/csv',

  /**
   * Colonne `date, payee, amount, notes`, quelle che l'importer di Actual sa
   * mappare da solo.
   *
   * L'importo esce negativo: nel modello interno `amount` e' positivo perche'
   * descrive una spesa, ma per Actual un'uscita e' un numero negativo. La
   * conversione sta qui e non nel dominio, che e' il punto di avere
   * un'interfaccia. Se il tuo import e' configurato al contrario, questa e'
   * l'unica riga da girare.
   */
  serializza(transazioni) {
    const righe = [riga(['date', 'payee', 'amount', 'notes'])];
    for (const t of transazioni ?? []) {
      const note = [
        [t.city, t.region].filter(Boolean).join(', '),
        t.confidence === 'low' ? 'da verificare' : '',
      ].filter(Boolean).join(' — ');
      righe.push(riga([giornoDi(t), t.merchant, (-t.amount).toFixed(2), note]));
    }
    return righe.join('\n') + '\n';
  },
};

export const DESTINAZIONI = [actualBudget];

export function destinazione(id) {
  return DESTINAZIONI.find((d) => d.id === id) ?? actualBudget;
}
