// Lo stato dell'app e dove vive.
//
// Il registro canonico e' il file JSONL che esporti su iCloud Drive; il
// localStorage e' solo una cache, comoda ma sacrificabile. Tenerlo in questo
// ordine e' cio' che permettera' all'ESP32 di scrivere nello stesso registro
// senza passare dal browser di questo telefono.

import { daJsonl, aJsonl } from './domain/registro.js';
import { CONFIG_VUOTA } from './domain/budget.js';

const CHIAVE_REGISTRO = 'briciole.registro';
const CHIAVE_CONFIG = 'briciole.config';

let registro = [];
let config = { ...CONFIG_VUOTA };
const ascoltatori = new Set();

/** Il localStorage puo' mancare o essere pieno: non e' un motivo per non partire. */
function leggi(chiave) {
  try {
    return localStorage.getItem(chiave);
  } catch {
    return null;
  }
}

function scrivi(chiave, valore) {
  try {
    localStorage.setItem(chiave, valore);
    return true;
  } catch {
    return false;
  }
}

export function carica() {
  registro = daJsonl(leggi(CHIAVE_REGISTRO) ?? '');
  try {
    config = { ...CONFIG_VUOTA, ...JSON.parse(leggi(CHIAVE_CONFIG) ?? '{}') };
  } catch {
    config = { ...CONFIG_VUOTA };
  }
  if (!Array.isArray(config.usciteFisse)) config.usciteFisse = [];
  if (!Array.isArray(config.fisse)) config.fisse = [];
}

export const getRegistro = () => registro;
export const getConfig = () => config;

function avvisa() {
  for (const f of ascoltatori) f();
}

export function osserva(f) {
  ascoltatori.add(f);
  return () => ascoltatori.delete(f);
}

export function setRegistro(nuovo) {
  registro = nuovo;
  scrivi(CHIAVE_REGISTRO, aJsonl(nuovo));
  avvisa();
}

export function setConfig(nuova) {
  config = nuova;
  scrivi(CHIAVE_CONFIG, JSON.stringify(nuova));
  avvisa();
}

/**
 * Salva senza avvisare nessuno.
 *
 * Serve mentre si scrive dentro un campo: avvisare ridisegna la vista, e
 * ridisegnare distrugge e ricrea l'input che si sta usando, che perde il fuoco
 * e il cursore. Con un campo cosi' non si riesce a scrivere "2000" - si scrive
 * "2" e poi bisogna tornare a toccarlo. Chi chiama questa funzione si prende
 * l'onere di aggiornare a mano cio' che dipende dal valore.
 */
export function setConfigZitto(nuova) {
  config = nuova;
  scrivi(CHIAVE_CONFIG, JSON.stringify(nuova));
}

/** Il registro come file, per iCloud Drive. */
export const esportaJsonl = () => aJsonl(registro);
