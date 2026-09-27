// Dal reddito alla soglia di oggi.
//
// La soglia non e' un numero che si sceglie: si ricava. Quello che resta dopo le
// uscite fisse, diviso i giorni che mancano alla fine del mese. E si ricalcola
// ogni giorno sul residuo vero, quindi sforare ieri abbassa il tetto di oggi
// invece di lasciare che il buco si accumuli senza dirlo.
//
// Il risparmio entra qui e non a fine mese, insieme alle uscite fisse: e' l'unico
// punto in cui mettere da parte cambia davvero qualcosa.

import { giornoDi, eSpesaVariabile, meseDi, meseSpostato } from './registro.js';
import { coperturaMese, raggruppa, perCategoria } from './statistiche.js';
import { quoteFondi } from './fondi.js';

const due = (n) => String(n).padStart(2, '0');
const centesimi = (n) => Number((Math.round(n * 100) / 100).toFixed(2));

export const CONFIG_VUOTA = {
  stipendio: 0,
  usciteFisse: [],
  // Beneficiari che l'utente ha marcato come uscita fissa: il mutuo pagato con
  // un bonifico non e' distinguibile dai pannolini se non lo dice lui.
  fisse: [],
  // Quanto si vuole mettere da parte ogni mese.
  //
  // Non e' un traguardo da controllare a fine mese: si toglie dal disponibile
  // *prima* del tetto, insieme alle uscite fisse. Trattarlo come l'avanzo -
  // spendi, e quel che resta e' risparmio - vuol dire non risparmiare, perche'
  // il tetto si prenderebbe comunque tutto: e' il motivo per cui l'estratto
  // conto dice che il mese e' andato bene e sul conto non resta niente.
  risparmio: 0,
  // Un tetto mensile per categoria, facoltativo: { 'Bar e ristoranti': 120 }.
  // Si guarda e basta - il tetto giornaliero segue il totale, vedi
  // `budgetCategorie`.
  limiti: {},
  // Le spese che non arrivano ogni mese - assicurazione, bollo, regali - con la
  // loro quota mensile: vedi `fondi.js`.
  fondi: [],
};

/** Quanti giorni ha il mese. Il giorno 0 del mese dopo e' l'ultimo di questo. */
export function giorniDelMese(anno, mese) {
  return new Date(Date.UTC(anno, mese, 0)).getUTCDate();
}

/** La somma delle uscite ricorrenti: affitto, rate, abbonamenti. */
export function totaleUsciteFisse(config) {
  return centesimi((config?.usciteFisse ?? []).reduce((s, u) => s + (Number(u.importo) || 0), 0));
}

/** L'obiettivo di risparmio del mese, mai negativo. */
export function obiettivoRisparmio(config) {
  return centesimi(Math.max(0, Number(config?.risparmio) || 0));
}

/** Lo stipendio meno le sole uscite fisse: quanto passa davvero dalle mani. */
export function dopoLeFisse(config) {
  return centesimi((Number(config?.stipendio) || 0) - totaleUsciteFisse(config));
}

/**
 * Quanto resta ogni mese per le spese variabili, cioe' quelle che il registro vede.
 *
 * Le quote dei fondi dipendono dal mese - chi apre il fondo a due mesi dalla
 * scadenza paga di piu' quei due mesi - e da cio' che il registro ha visto
 * pagare prima, quindi senza mese e registro valgono zero.
 */
export function disponibileDelMese(config, registro = [], mese = null) {
  const fondi = mese ? quoteFondi(config, registro, mese) : 0;
  return centesimi(dopoLeFisse(config) - obiettivoRisparmio(config) - fondi);
}

function sommaTra(registro, da, a) {
  return centesimi((registro ?? [])
    .filter((t) => {
      const g = giornoDi(t);
      return g >= da && g <= a && eSpesaVariabile(t);
    })
    .reduce((s, t) => s + t.amount, 0));
}

/**
 * Lo stato di un giorno: quanto puoi ancora spendere, e come ci si e' arrivati.
 *
 * `soglia` e' il tetto di oggi, non la media del mese: si ottiene dividendo cio'
 * che resta del mese per i giorni che restano, oggi incluso. E' questo che fa il
 * recupero - se ieri hai speso troppo, oggi il numeratore e' piu' piccolo e il
 * tetto scende da solo; se hai speso poco, sale.
 *
 * Funzione pura: il giorno arriva come argomento, non dall'orologio.
 */
export function statoGiorno(config, registro, giorno) {
  const [anno, mese, gg] = String(giorno).split('-').map(Number);
  const nelMese = giorniDelMese(anno, mese);
  const primo = `${anno}-${due(mese)}-01`;
  const ultimo = `${anno}-${due(mese)}-${due(nelMese)}`;

  // Il tetto divide per i giorni che restano cio' che il registro dice essere
  // avanzato. Se il registro comincia a mese gia' iniziato, quello che hai speso
  // prima non lo sa nessuno, e il tetto esce troppo alto. Non e' un errore di
  // calcolo ed e' inevitabile - ma va detto, non lasciato passare per un numero
  // buono.
  const giorni = (registro ?? []).filter(eSpesaVariabile).map(giornoDi).sort();
  const daQuando = giorni[0] ?? null;
  const parziale = daQuando !== null && daQuando > primo;

  const disponibile = disponibileDelMese(config, registro, `${anno}-${due(mese)}`);
  const obiettivo = obiettivoRisparmio(config);
  const fondi = quoteFondi(config, registro, `${anno}-${due(mese)}`);
  const spesoPrima = gg > 1 ? sommaTra(registro, primo, `${anno}-${due(mese)}-${due(gg - 1)}`) : 0;
  const spesoOggi = sommaTra(registro, giorno, giorno);
  const restanti = Math.max(1, nelMese - gg + 1);

  // Il tetto non scende sotto zero: quando il mese e' gia' finito il messaggio e'
  // "niente", non un numero negativo da interpretare.
  const soglia = centesimi(Math.max(0, (disponibile - spesoPrima) / restanti));

  return {
    giorno,
    disponibile,
    usciteFisse: totaleUsciteFisse(config),
    spesoPrima,
    spesoOggi,
    spesoMese: centesimi(spesoPrima + spesoOggi),
    restoMese: centesimi(disponibile - spesoPrima - spesoOggi),
    giorniRestanti: restanti,
    soglia,
    residuo: centesimi(soglia - spesoOggi),
    superata: spesoOggi > soglia && soglia > 0,
    // Tutto quello che c'e' da qui a fine mese, oggi compreso: e' il numeratore
    // del tetto, ed e' esattamente `soglia * giorniRestanti`. Scriverlo accanto
    // al tetto e' l'unico modo di far vedere da dove quel numero esce, invece
    // di lasciarlo comparire come una cifra decisa da qualcuno.
    restoDaOggi: centesimi(disponibile - spesoPrima),
    // Il tetto che ci sara' domani se la giornata chiude cosi'. E' il recupero
    // detto in anticipo: spendere adesso non toglie soldi a un mese lontano,
    // toglie a domani, e vederlo prima e' l'unica cosa che puo' cambiare la
    // decisione. L'ultimo giorno del mese non ha un domani da mostrare, e li'
    // il campo e' `null` invece di un numero inventato.
    sogliaDomani: restanti > 1
      ? centesimi(Math.max(0, (disponibile - spesoPrima - spesoOggi) / (restanti - 1)))
      : null,
    risparmio: obiettivo,
    // Le quote dei fondi di questo mese: escono prima del tetto, come il
    // risparmio, ma non sono risparmio - sono spese gia' decise, solo non ancora
    // arrivate.
    fondi,
    // Quanto sarebbe messo da parte se il mese finisse adesso: e' l'obiettivo
    // piu' cio' che del tetto e' avanzato. Sopra l'obiettivo si e' risparmiato
    // di piu'; sotto zero non e' un risparmio piccolo, e' il gruzzolo che si
    // sta consumando - e va scritto cosi', non nascosto dietro uno zero.
    messoDaParte: centesimi(obiettivo + disponibile - spesoPrima - spesoOggi),
    // Senza stipendio non c'e' niente da calcolare: la UI mostra il registro e
    // basta, invece di inventare una soglia a zero e dichiararla sforata.
    attiva: disponibile > 0,
    // Lo stipendio c'e' ma se ne va tutto in uscite fisse e risparmio. E' un
    // caso diverso dal budget spento, e merita un'altra frase: qui non manca un
    // dato, e' l'obiettivo a non lasciare niente per i giorni.
    troppoRisparmio: disponibile <= 0 && dopoLeFisse(config) > 0,
    parziale,
    daQuando,
    finestra: { primo, ultimo },
  };
}

/**
 * La media giornaliera davvero spesa nel mese fino a un giorno, oggi incluso.
 * Serve a confrontare il ritmo reale con il tetto teorico.
 */
export function mediaGiornaliera(registro, giorno) {
  const [anno, mese, gg] = String(giorno).split('-').map(Number);
  const primo = `${anno}-${due(mese)}-01`;
  return centesimi(sommaTra(registro, primo, giorno) / Math.max(1, gg));
}

/**
 * I totali degli ultimi N giorni, dal piu' vecchio al piu' recente.
 *
 * Serve alla striscia settimanale: un numero solo dice quanto hai speso oggi,
 * sette dicono se oggi e' un'eccezione o l'ennesimo giorno uguale.
 */
export function ultimiGiorni(registro, giorno, quanti = 7) {
  const fine = Date.parse(String(giorno) + 'T12:00:00Z');
  const fuori = [];
  for (let i = quanti - 1; i >= 0; i--) {
    const g = new Date(fine - i * 86400000).toISOString().slice(0, 10);
    fuori.push({ giorno: g, totale: sommaTra(registro, g, g) });
  }
  return fuori;
}

/**
 * La settimana giorno per giorno, con accanto il tetto che ognuno aveva.
 *
 * `ultimiGiorni` dice quanto si e' speso; qui c'e' anche quanto si sarebbe
 * potuto spendere *quel* giorno. Non e' il tetto di oggi ripetuto sette volte:
 * `statoGiorno` divide per i giorni che restavano allora cio' che era avanzato
 * allora, quindi ogni giorno ha il suo. Ed e' il punto - disegnati uno accanto
 * all'altro, i sette tetti sono il recupero reso visibile: sforare non brucia
 * il mese, abbassa il giorno dopo, e la riga scende di uno scalino.
 *
 * Il tetto dei giorni passati lo ricalcola con lo stipendio e le uscite fisse
 * di adesso: sui mesi gia' chiusi e' un'ipotesi, come in `risparmioDeiMesi`.
 */
export function strisciaSettimana(config, registro, giorno, quanti = 7) {
  return ultimiGiorni(registro, giorno, quanti).map((g) => {
    const { soglia } = statoGiorno(config, registro, g.giorno);
    return {
      ...g,
      soglia,
      residuo: centesimi(soglia - g.totale),
      oltre: soglia > 0 && g.totale > soglia,
    };
  });
}

/**
 * Mese per mese, quanto e' finito da parte.
 *
 * A fine mese la domanda non e' se il tetto ha retto, ma se sul conto e'
 * rimasto qualcosa: e' l'unico numero che a fine anno si vede. Si calcola con lo
 * stipendio e le uscite fisse di *adesso*, che sui mesi passati e' un'ipotesi -
 * la UI lo dice, invece di far passare per storia quella che e' una proiezione.
 *
 * Un mese che il registro copre solo in parte non entra nel totale: il risparmio
 * calcolato sulle spese di mezzo mese sarebbe alto e falso, ed e' meglio non
 * dare un numero che darne uno gonfiato.
 */
export function risparmioDeiMesi(config, registro, oggi) {
  const spese = (registro ?? []).filter(eSpesaVariabile);
  const primoGiorno = spese.map(giornoDi).sort()[0] ?? null;
  if (!primoGiorno) return { mesi: [], totale: 0 };

  const meseOggi = String(oggi).slice(0, 7);
  const obiettivo = obiettivoRisparmio(config);

  const perMese = new Map();
  for (const t of spese) {
    const m = meseDi(t);
    if (m > meseOggi) continue;
    perMese.set(m, centesimi((perMese.get(m) ?? 0) + t.amount));
  }

  const mesi = [...perMese.keys()].sort().map((mese) => {
    const speso = perMese.get(mese);
    const inCorso = mese === meseOggi;
    // Il registro parte a mese gia' iniziato: le spese dei primi giorni non le
    // ha viste nessuno, e quello che sembra risparmio e' solo assenza di dati.
    const parziale = primoGiorno > `${mese}-01`;
    const disponibile = disponibileDelMese(config, registro, mese);
    return {
      mese,
      speso,
      obiettivo,
      messoDaParte: centesimi(obiettivo + disponibile - speso),
      inCorso,
      parziale,
      // Solo un mese chiuso e coperto per intero e' un risultato.
      contabile: !inCorso && !parziale,
    };
  });

  return {
    mesi,
    totale: centesimi(mesi.filter((m) => m.contabile).reduce((s, m) => s + m.messoDaParte, 0)),
  };
}

/**
 * Quanti soldi ci sono adesso, per quel che se ne puo' sapere.
 *
 * Il saldo lo dice la banca, e lo dice a una data: e' vero quel giorno e
 * comincia a invecchiare il giorno dopo. Ma le spese fatte da allora il registro
 * le ha - sono quelle lette dalle notifiche, che la banca contabilizzera' fra
 * giorni - e sottrarle e' l'unica cosa che questa app puo' fare e l'app della
 * banca no.
 *
 * `dichiarato` resta separato da `stimato` apposta: il primo e' un fatto, il
 * secondo un conto fatto da noi, e confonderli vorrebbe dire spacciare per
 * saldo un numero che nessuna banca ha mai scritto.
 *
 * Si contano *tutte* le uscite dopo quella data, fisse comprese: dal conto esce
 * anche il mutuo, che al tetto giornaliero non interessa ma al saldo si'.
 */
export function saldoStimato(config, registro, oggi) {
  const salvato = config?.saldo;
  const importo = Number(salvato?.importo);
  if (!salvato?.al || !Number.isFinite(importo)) return null;

  // Il giorno stesso del saldo e' il caso ambiguo: la banca ha fotografato il
  // conto a un'ora che non sappiamo. Quello che l'estratto conto contiene e'
  // dentro il saldo per definizione; quello che invece ha visto solo l'app -
  // una notifica, domani l'ANCS - e' arrivato dopo, perche' l'estratto conto lo
  // scarichi e poi vivi la giornata. Contare quest'ultimo e non il primo e' la
  // sola lettura che non sbaglia in nessuna delle due direzioni.
  const dopo = (registro ?? []).filter((t) => {
    const g = giornoDi(t);
    return g > salvato.al || (g === salvato.al && t.source !== 'banca');
  });
  const uscite = dopo.filter((t) => !t.entrata).reduce((s, t) => s + t.amount, 0);
  const entrate = dopo.filter((t) => t.entrata).reduce((s, t) => s + t.amount, 0);

  return {
    dichiarato: centesimi(importo),
    al: salvato.al,
    stimato: centesimi(importo - uscite + entrate),
    movimentiDopo: dopo.length,
    // Quanto e' vecchio il dato. Un saldo di tre settimane fa non e' sbagliato,
    // e' scaduto: va detto invece di lasciarlo passare per il saldo di adesso.
    giorni: Math.max(0, Math.round(
      (Date.parse(`${oggi}T12:00:00Z`) - Date.parse(`${salvato.al}T12:00:00Z`)) / 86400000,
    )),
  };
}

/**
 * Il mese in corso contro quello prima, giorno per giorno, a somme crescenti.
 *
 * Una linea sola che sale dice quanto hai speso; due linee dicono se e' tanto.
 * Il confronto e' allo stesso giorno - il 12 contro il 12 - perche' il 12
 * settembre contro tutto agosto sembra sempre un mese virtuoso.
 *
 * Il mese scorso si confronta solo se il registro lo copre per intero: mezzo
 * agosto accanto a mezzo settembre racconterebbe un aumento che e' soltanto il
 * giorno in cui e' cominciato il registro. La linea si disegna lo stesso, ma
 * `confronto` resta `null` e nessuna frase dice "piu'" o "meno".
 *
 * `ritmo` e' il disponibile del mese spalmato uguale su tutti i giorni: dove
 * saresti spendendo ogni giorno la stessa cifra. Stare sotto quella retta e'
 * cio' che fa salire il tetto dei giorni dopo.
 */
export function andamentoDelMese(config, registro, giorno) {
  const [anno, mese, gg] = String(giorno).split('-').map(Number);
  const questoMese = `${anno}-${due(mese)}`;
  const scorso = meseSpostato(questoMese, -1);
  const [annoS, meseS] = scorso.split('-').map(Number);
  const nelMese = giorniDelMese(anno, mese);
  const nelloScorso = giorniDelMese(annoS, meseS);

  const cumulata = (m, fino) => {
    const perGiorno = new Array(fino).fill(0);
    for (const t of registro ?? []) {
      if (!eSpesaVariabile(t) || meseDi(t) !== m) continue;
      const d = Number(giornoDi(t).slice(8, 10));
      if (d <= fino) perGiorno[d - 1] += t.amount;
    }
    let somma = 0;
    return perGiorno.map((v) => centesimi((somma += v)));
  };

  const questo = cumulata(questoMese, gg);
  const precedente = cumulata(scorso, nelloScorso);
  const completo = coperturaMese(registro, scorso).completo;
  const disponibile = Math.max(0, disponibileDelMese(config, registro, questoMese));
  // Il giorno 31 di un mese contro un mese scorso di 30: si confronta con
  // l'ultimo giorno che quel mese ha avuto.
  const stessoGiorno = precedente[Math.min(gg, nelloScorso) - 1] ?? 0;
  const oggiSpeso = questo[gg - 1] ?? 0;

  return {
    mese: questoMese,
    scorso,
    giorni: nelMese,
    oggi: gg,
    questo,
    precedente,
    precedenteCompleto: completo,
    disponibile,
    ritmo: disponibile > 0 ? centesimi((disponibile * gg) / nelMese) : null,
    confronto: completo
      ? { questo: oggiSpeso, scorso: stessoGiorno, differenza: centesimi(oggiSpeso - stessoGiorno) }
      : null,
  };
}

/**
 * Lo stipendio diviso in quattro: fisse, risparmio, speso, e quello che resta.
 *
 * E' la stessa catena di `statoGiorno` messa in fila come una barra sola, ed e'
 * il modo piu' corto di far vedere perche' il tetto e' quello: su 2.000 euro,
 * 1.000 se ne vanno prima ancora di cominciare. Le quattro parti sommano allo
 * stipendio finche' il mese regge.
 *
 * Quando le spese sfondano, lo sfondamento si mangia prima il risparmio - e'
 * la verita': quei soldi non verranno messi da parte - e solo dopo va oltre lo
 * stipendio. `oltre` e' quanto si e' andati oltre lo stipendio intero, e chi
 * disegna usa come scala la somma, non lo stipendio, cosi' la barra non esce.
 */
export function ripartizioneMese(config, registro, giorno) {
  const s = statoGiorno(config, registro, giorno);
  const stipendio = centesimi(Math.max(0, Number(config?.stipendio) || 0));
  // Due buchi diversi, da non confondere. Il piano puo' essere corto da solo -
  // fisse e risparmio sommano piu' dello stipendio - senza aver speso niente:
  // li' il risparmio non e' stato "preso dalle spese", non c'e' mai stato.
  // Solo quello che le spese mangiano oltre il flessibile e' eroso.
  const spazio = Math.max(0, stipendio - s.usciteFisse);
  const risparmioPossibile = Math.min(s.risparmio, spazio);
  // I fondi vengono dopo il risparmio: se lo stipendio non basta per tutti e
  // due, quello che manca lo dice `pianoCorto`, e la barra non disegna quote
  // che non ci stanno.
  const fondiPossibili = Math.min(s.fondi, Math.max(0, spazio - risparmioPossibile));
  const flessibile = Math.max(0, s.disponibile);
  const sfondo = Math.max(0, s.spesoMese - flessibile);
  const eroso = Math.min(risparmioPossibile, sfondo);
  const voci = [
    { chiave: 'fisse', nome: 'Uscite fisse', importo: s.usciteFisse },
    { chiave: 'risparmio', nome: 'Da parte', importo: centesimi(risparmioPossibile - eroso) },
    ...(s.fondi > 0 ? [{ chiave: 'fondi', nome: 'Spese non mensili', importo: centesimi(fondiPossibili) }] : []),
    { chiave: 'speso', nome: 'Spese del mese', importo: s.spesoMese },
    { chiave: 'resta', nome: 'Ancora da spendere', importo: centesimi(Math.max(0, flessibile - s.spesoMese)) },
  ];
  const totale = centesimi(voci.reduce((t, v) => t + v.importo, 0));
  return {
    stipendio,
    voci,
    totale,
    eroso: centesimi(eroso),
    // Quanto manca al piano prima ancora di cominciare il mese.
    pianoCorto: centesimi(Math.max(0, s.usciteFisse + s.risparmio + s.fondi - stipendio)),
    oltre: centesimi(Math.max(0, totale - stipendio)),
  };
}

/**
 * Le categorie con un limite, e quanto ne resta.
 *
 * I limiti sono una lente e non un secondo budget: il tetto giornaliero segue
 * il totale del flessibile e non cambia se una categoria sfora, perche' i soldi
 * sono gli stessi - cento euro in piu' al ristorante sono cento euro in meno
 * per tutto il resto, e il tetto lo sa gia'. Un limite serve a vedere *dove*
 * stanno andando, non a dividere il conto in scatole che non si parlano.
 *
 * `alGiorno` c'e' solo per il mese in corso: il resto della categoria diviso i
 * giorni che mancano, oggi compreso, come il tetto. Per un mese chiuso non ha
 * senso chiedersi quanto si puo' ancora spendere.
 *
 * Le categorie senza limite restano visibili a parte: il loro speso esiste, e
 * farlo sparire dal conto direbbe che il flessibile e' piu' grande di cosi'.
 */
export function budgetCategorie(config, registro, mese, oggi) {
  const limiti = config?.limiti ?? {};
  const cat = perCategoria(raggruppa(registro, mese, config));
  const speso = new Map(cat.categorie.map((c) => [c.categoria, c]));

  const [anno, m] = String(mese).split('-').map(Number);
  const nelMese = giorniDelMese(anno, m);
  const inCorso = String(oggi).slice(0, 7) === mese;
  const restanti = inCorso ? Math.max(1, nelMese - Number(String(oggi).slice(8, 10)) + 1) : 0;
  const trascorso = inCorso ? (nelMese - restanti + 1) / nelMese : 1;

  const conLimite = Object.entries(limiti)
    .filter(([, v]) => Number(v) > 0)
    .map(([categoria, v]) => {
      const limite = centesimi(Number(v));
      const c = speso.get(categoria);
      const totale = c ? c.totale : 0;
      const resto = centesimi(limite - totale);
      return {
        categoria,
        limite,
        speso: totale,
        quante: c ? c.quante : 0,
        resto,
        quota: limite > 0 ? totale / limite : 0,
        // "Attento" non e' "quasi finito": e' spendere piu' in fretta dei
        // giorni. Al 10 del mese un terzo del limite gia' andato e' in linea;
        // la meta' no.
        stato: totale > limite ? 'oltre'
          : totale / limite > trascorso + 0.1 ? 'attento' : 'sereno',
        alGiorno: inCorso && resto > 0 ? centesimi(resto / restanti) : null,
      };
    })
    .sort((a, b) => b.limite - a.limite || (a.categoria < b.categoria ? -1 : 1));

  const assegnato = centesimi(conLimite.reduce((s, c) => s + c.limite, 0));
  const disponibile = Math.max(0, disponibileDelMese(config, registro, mese));
  return {
    righe: conLimite,
    senzaLimite: cat.categorie
      .filter((c) => !(Number(limiti[c.categoria]) > 0))
      .map((c) => ({ categoria: c.categoria, speso: c.totale, quante: c.quante })),
    senzaCategoria: cat.senza,
    assegnato,
    disponibile,
    // Quanto del flessibile non e' ancora dentro nessun limite. Negativo vuol
    // dire che i limiti promettono piu' di quello che c'e'.
    daAssegnare: centesimi(disponibile - assegnato),
    trascorso,
  };
}
