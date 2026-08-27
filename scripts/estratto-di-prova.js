// Genera il file .xlsx usato dai test.
//
// Il fixture e' committato, quindi questo script non serve a far girare i test:
// serve a poterlo rifare. Un file binario nel repo senza il modo di
// riprodurlo e' un dato che nessuno osa piu' toccare.
//
// Scrive uno ZIP a mano - intestazione locale, directory centrale, record di
// chiusura - perche' la regola del progetto vale anche qui. `CompressionStream`
// fa il deflate, ed e' la controparte esatta di cio' che `xlsx.js` legge.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const USCITA = path.join(QUI, '../test/dati/estratto-conto.xlsx');

const EPOCA = Date.UTC(1899, 11, 30);
const seriale = (aaaa, mm, gg) => (Date.UTC(aaaa, mm - 1, gg) - EPOCA) / 86400000;
const due = (n) => String(n).padStart(2, '0');

// --- lo ZIP ---------------------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflate(bytes) {
  const flusso = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flusso).arrayBuffer());
}

async function zip(voci) {
  const pezzi = [];
  const indice = [];
  let posizione = 0;

  const scrivi = (bytes) => { pezzi.push(bytes); posizione += bytes.length; };
  const u16 = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);
  const u32 = (n) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
  const unisci = (...parti) => {
    const totale = parti.reduce((s, p) => s + p.length, 0);
    const fuori = new Uint8Array(totale);
    let o = 0;
    for (const p of parti) { fuori.set(p, o); o += p.length; }
    return fuori;
  };

  for (const [nome, testo] of voci) {
    const crudi = new TextEncoder().encode(testo);
    const compressi = await deflate(crudi);
    const nomeBytes = new TextEncoder().encode(nome);
    const offset = posizione;

    scrivi(unisci(u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
      u32(crc32(crudi)), u32(compressi.length), u32(crudi.length),
      u16(nomeBytes.length), u16(0), nomeBytes, compressi));

    indice.push(unisci(u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
      u32(crc32(crudi)), u32(compressi.length), u32(crudi.length),
      u16(nomeBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nomeBytes));
  }

  const inizioIndice = posizione;
  for (const voce of indice) scrivi(voce);

  scrivi(unisci(u32(0x06054b50), u16(0), u16(0), u16(indice.length), u16(indice.length),
    u32(posizione - inizioIndice), u32(inizioIndice), u16(0)));

  return Buffer.concat(pezzi.map((p) => Buffer.from(p)));
}

// --- il contenuto ---------------------------------------------------------

const ESERCENTI = [
  ['GOCCE DI CAFFE', 'BARI', 4.00], ['GOCCE DI CAFFE', 'BARI', 3.50],
  ['FAMILA MEGAGEST', 'BARI', 63.03], ['CRUCOTTO SNC', 'BARI', 19.00],
  ['AZZARO SRL', 'BARI', 17.98], ['CRUDAMMARE', 'BARI', 34.50],
  ['FUORI DAL COMUNE', 'BARI', 17.00], ['QUA LA ZAMPA', 'MONOPOLI', 15.90],
  ['PAYPAL *PYPL PAYMTHLY', '0600000000', 39.32], ['ESSELUNGA SPA', 'BARI', 52.41],
];

const movimenti = [
  [[2026, 8, 3], [2026, 8, 1], null, 1850.0, 'BONIFICO STIPENDIO AGOSTO Op.600000'],
  [[2026, 8, 6], [2026, 8, 5], 700.0, null, 'ADDEBITO SDD AFFITTO AGOSTO Op.600137'],
  [[2026, 8, 6], [2026, 8, 5], 2.0, null, 'COMMISSIONI E SPESE Op.600274'],
  [[2026, 8, 12], [2026, 8, 10], 61.2, null, 'ADDEBITO SDD ENEL ENERGIA Op.600411'],
];

let op = 660000;
for (let i = 0; i < 96; i++) {
  const [nome, citta, importo] = ESERCENTI[i % ESERCENTI.length];
  const gg = 1 + (i % 26);
  const ora = 7 + (i % 13);
  const minuto = (i * 7) % 60;
  op += 1;
  const descrizione = `PAGAMENTO POS ${nome}${' '.repeat(Math.max(2, 30 - nome.length))}`
    + `${due(gg)}/08/2026 ${due(ora)}.${due(minuto)} ${citta}${' '.repeat(10)}Op.${op} carta ****0000`;
  // La banca contabilizza qualche giorno dopo l'acquisto: e' proprio la
  // differenza che il parser deve saper ignorare.
  const contabile = new Date(Date.UTC(2026, 7, gg + 2));
  movimenti.push([
    [contabile.getUTCFullYear(), contabile.getUTCMonth() + 1, contabile.getUTCDate()],
    [2026, 8, gg], importo, null, descrizione,
  ]);
}

const PREAMBOLO = ['Intestato a: ROSSI MARIO', 'Saldo al: 27/08/2026',
  'Saldo contabile: +2.648,22 Euro', 'Saldo disponibile: +2.629,23 Euro'];
const COLONNE = ['Data Contabile', 'Data Valuta', 'Addebiti (euro)', 'Accrediti (euro)', 'Descrizione operazioni'];

const testi = [...PREAMBOLO, ...COLONNE];
for (const m of movimenti) if (!testi.includes(m[4])) testi.push(m[4]);
const indiceDi = new Map(testi.map((t, i) => [t, i]));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LETTERE = 'ABCDE';

const righe = [];
let n = 1;
for (const t of PREAMBOLO) righe.push(`<row r="${n}"><c r="A${n}" t="s"><v>${indiceDi.get(t)}</v></c></row>`), n++;
righe.push(`<row r="${n}">${COLONNE.map((t, i) => `<c r="${LETTERE[i]}${n}" t="s"><v>${indiceDi.get(t)}</v></c>`).join('')}</row>`);
n++;

for (const [dc, dv, addebito, accredito, descrizione] of movimenti) {
  // Lo stile 1 e' una data (numFmtId 14): senza, i seriali resterebbero numeri.
  const celle = [
    `<c r="A${n}" s="1"><v>${seriale(...dc)}</v></c>`,
    `<c r="B${n}" s="1"><v>${seriale(...dv)}</v></c>`,
  ];
  if (addebito !== null) celle.push(`<c r="C${n}"><v>${addebito}</v></c>`);
  if (accredito !== null) celle.push(`<c r="D${n}"><v>${accredito}</v></c>`);
  celle.push(`<c r="E${n}" t="s"><v>${indiceDi.get(descrizione)}</v></c>`);
  righe.push(`<row r="${n}">${celle.join('')}</row>`);
  n++;
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

const file = [
  ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
  ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
  ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Lista Movimenti" sheetId="1" r:id="rId1"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
  ['xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${NS}" count="${testi.length}" uniqueCount="${testi.length}">${testi.map((t) => `<si><t>${esc(t)}</t></si>`).join('')}</sst>`],
  ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}"><fonts count="1"><font><sz val="11"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`],
  ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><sheetData>${righe.join('')}</sheetData></worksheet>`],
];

fs.mkdirSync(path.dirname(USCITA), { recursive: true });
fs.writeFileSync(USCITA, await zip(file));
console.log(`scritto ${path.relative(process.cwd(), USCITA)}: ${movimenti.length} movimenti, ${testi.length} stringhe`);
