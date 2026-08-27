// Lettura di un file .xlsx, senza dipendenze.
//
// Un .xlsx e' uno ZIP di documenti XML. Per arrivare alle celle servono quattro
// cose: la directory centrale dello ZIP per trovare i pezzi, la decompressione
// (`DecompressionStream`, che sia il browser sia Node hanno gia'), la tabella
// delle stringhe condivise, e - la parte che si dimentica sempre - gli stili.
//
// Senza gli stili le date sono indistinguibili dagli importi: Excel le salva
// entrambe come numeri, e un 46261 senza il suo formato puo' essere tanto il
// 27 agosto 2026 quanto quarantaseimila euro.

const EOCD = 0x06054b50;
const CENTRALE = 0x02014b50;

// Formati data predefiniti di Excel. Dal 164 in su sono personalizzati e
// vanno guardati uno per uno.
const FORMATI_DATA = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

// Excel conta i giorni dal 30 dicembre 1899. Il 30 e non il 31 per via del
// 1900 trattato come bisestile, un baco di Lotus 1-2-3 che Excel ha copiato per
// compatibilita' e non ha piu' potuto togliere.
const EPOCA = Date.UTC(1899, 11, 30);
const GIORNO_MS = 86400000;

function vista(dati) {
  const bytes = dati instanceof Uint8Array ? dati : new Uint8Array(dati);
  return { bytes, dv: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
}

/**
 * Le voci dello ZIP, lette dalla directory centrale.
 *
 * Si parte dalla fine: il record di chiusura sta in coda al file e dice dove
 * comincia l'indice. Cercarlo all'indietro e' l'unico modo - un commento in
 * fondo all'archivio ne sposta la posizione, quindi non e' a un offset fisso.
 */
function voci({ bytes, dv }) {
  let eocd = -1;
  const minimo = Math.max(0, bytes.length - 66000);
  for (let i = bytes.length - 22; i >= minimo; i--) {
    if (dv.getUint32(i, true) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Non e’ un file .xlsx: manca l’indice dell’archivio.');

  const quante = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);

  const trovate = new Map();
  for (let n = 0; n < quante; n++) {
    if (dv.getUint32(p, true) !== CENTRALE) break;
    const metodo = dv.getUint16(p + 10, true);
    const compressa = dv.getUint32(p + 20, true);
    const lunghezzaNome = dv.getUint16(p + 28, true);
    const lunghezzaExtra = dv.getUint16(p + 30, true);
    const lunghezzaCommento = dv.getUint16(p + 32, true);
    const offsetLocale = dv.getUint32(p + 42, true);
    const nome = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + lunghezzaNome));

    trovate.set(nome, { metodo, compressa, offsetLocale });
    p += 46 + lunghezzaNome + lunghezzaExtra + lunghezzaCommento;
  }
  return trovate;
}

async function contenuto({ bytes, dv }, voce) {
  if (!voce) return null;
  // L'intestazione locale ripete nome ed extra, e le loro lunghezze possono
  // non coincidere con quelle dell'indice: i dati cominciano dopo di esse.
  const nome = dv.getUint16(voce.offsetLocale + 26, true);
  const extra = dv.getUint16(voce.offsetLocale + 28, true);
  const inizio = voce.offsetLocale + 30 + nome + extra;
  const grezzi = bytes.subarray(inizio, inizio + voce.compressa);

  if (voce.metodo === 0) return new TextDecoder().decode(grezzi);
  if (voce.metodo !== 8) throw new Error(`Compressione ${voce.metodo} non supportata.`);

  const flusso = new Blob([grezzi]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(flusso).text();
}

const ENTITA = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function scioglie(testo) {
  return testo.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (intero, corpo) => {
    if (corpo[0] === '#') {
      const codice = corpo[1] === 'x' || corpo[1] === 'X'
        ? parseInt(corpo.slice(2), 16)
        : parseInt(corpo.slice(1), 10);
      return Number.isFinite(codice) ? String.fromCodePoint(codice) : intero;
    }
    return ENTITA[corpo.toLowerCase()] ?? intero;
  });
}

/** Il testo di tutti i `<t>` dentro un frammento, concatenato. */
function testoDi(xml) {
  let fuori = '';
  for (const m of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) {
    fuori += scioglie(m[1] ?? '');
  }
  return fuori;
}

/**
 * La tabella delle stringhe.
 *
 * Una stessa `<si>` puo' essere spezzata in piu' `<r>` quando dentro la cella
 * il testo cambia formato a meta': concatenarli tutti e' cio' che evita di
 * troncare "PAGAMENTO POS" alla prima parola in grassetto.
 */
function stringhe(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => testoDi(m[1]));
}

/** Quali stili rappresentano una data. Indice = indice in `cellXfs`. */
function stiliData(xml) {
  if (!xml) return new Set();

  const personalizzati = new Map();
  for (const m of xml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    personalizzati.set(Number(m[1]), scioglie(m[2]));
  }

  const eData = (id) => {
    if (FORMATI_DATA.has(id)) return true;
    const codice = personalizzati.get(id);
    if (!codice) return false;
    // Le parti fra virgolette sono testo letterale: una "d" li' dentro non fa
    // di un formato una data.
    const senzaLetterali = codice.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
    return /[dmyhs]/i.test(senzaLetterali) && !/^[^dmyhs]*$/i.test(senzaLetterali);
  };

  const blocco = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!blocco) return new Set();

  const fuori = new Set();
  let i = 0;
  for (const m of blocco[1].matchAll(/<xf\b[^>]*>/g)) {
    const id = m[0].match(/numFmtId="(\d+)"/);
    if (id && eData(Number(id[1]))) fuori.add(i);
    i++;
  }
  return fuori;
}

const due = (n) => String(n).padStart(2, '0');

/**
 * Un numero seriale di Excel nel formato in cui la banca scrive le date nel
 * testo, cosi' il resto del programma non deve sapere da dove arriva la riga.
 */
export function dataDaSeriale(seriale) {
  const giorni = Math.floor(seriale);
  const resto = seriale - giorni;
  const d = new Date(EPOCA + giorni * GIORNO_MS);
  const data = `${due(d.getUTCDate())}/${due(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  if (resto < 1 / 86400) return data;

  const minutiTotali = Math.round(resto * 1440);
  return `${data} ${due(Math.floor(minutiTotali / 60) % 24)}.${due(minutiTotali % 60)}`;
}

/** "BC" -> 54. La colonna di una cella dal suo riferimento. */
function colonnaDa(riferimento) {
  let n = 0;
  for (const c of riferimento) {
    const codice = c.charCodeAt(0);
    if (codice < 65 || codice > 90) break;
    n = n * 26 + (codice - 64);
  }
  return n - 1;
}

function righeDaFoglio(xml, condivise, date) {
  const righe = [];
  for (const riga of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const celle = [];
    for (const c of (riga[1] ?? '').matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributi = c[1];
      const corpo = c[2] ?? '';
      const riferimento = attributi.match(/\br="([A-Z]+)\d+"/);
      const tipo = attributi.match(/\bt="([^"]+)"/)?.[1];
      const stile = attributi.match(/\bs="(\d+)"/)?.[1];

      let valore;
      if (tipo === 's') {
        const indice = Number(corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1]);
        valore = condivise[indice] ?? '';
      } else if (tipo === 'inlineStr') {
        valore = testoDi(corpo);
      } else {
        valore = scioglie(corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
        // Un numero con uno stile data e' una data: senza gli stili questa
        // distinzione non esiste, ed e' il motivo per cui vale la pena leggerli.
        if (valore && stile !== undefined && date.has(Number(stile)) && !Number.isNaN(Number(valore))) {
          valore = dataDaSeriale(Number(valore));
        }
      }

      const dove = riferimento ? colonnaDa(riferimento[1]) : celle.length;
      while (celle.length < dove) celle.push('');
      celle[dove] = valore;
    }
    righe.push(celle);
  }
  return righe;
}

/**
 * leggiXlsx(dati) -> [{ nome, righe }]
 *
 * `dati` e' l'ArrayBuffer del file. Ogni foglio esce come griglia di stringhe:
 * quello che il chiamante avrebbe avuto incollando le celle a mano, comprese le
 * date gia' scritte per esteso.
 */
export async function leggiXlsx(dati) {
  const archivio = vista(dati);
  const dentro = voci(archivio);
  const leggi = (nome) => contenuto(archivio, dentro.get(nome));

  const [condivise, stili, workbook, rels] = await Promise.all([
    leggi('xl/sharedStrings.xml').then(stringhe),
    leggi('xl/styles.xml').then(stiliData),
    leggi('xl/workbook.xml'),
    leggi('xl/_rels/workbook.xml.rels'),
  ]);
  if (!workbook) throw new Error('Non e’ un file .xlsx: manca il foglio di lavoro.');

  // Il nome del foglio sta nel workbook, il percorso del suo XML nelle
  // relazioni: le due cose vanno incrociate, l'ordine dei file nello ZIP non
  // e' garantito.
  const percorsi = new Map(
    [...(rels ?? '').matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
      .map((m) => [m[1], m[2].replace(/^\/?xl\//, '').replace(/^\//, '')]),
  );

  const fogli = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const nome = scioglie(m[0].match(/name="([^"]*)"/)?.[1] ?? '');
    const rId = m[0].match(/r:id="([^"]+)"/)?.[1];
    const percorso = percorsi.get(rId);
    if (!percorso) continue;
    const xml = await leggi('xl/' + percorso);
    if (xml) fogli.push({ nome, righe: righeDaFoglio(xml, condivise, stili) });
  }

  if (!fogli.length) throw new Error('Il file non contiene fogli leggibili.');
  return fogli;
}
