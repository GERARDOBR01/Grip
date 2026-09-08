// Respaldo — el puente para que estos datos nunca queden atrapados en ninguna app.
//
// Lo que exporta es el documento completo, tal cual, en JSON legible. Es el mismo formato
// que come el importador. Si mañana esta app deja de existir, los datos salen enteros.

import { migrar } from "../motor/migraciones.js";
import { VERSION_DATOS } from "../motor/modelo.js";
import { hoyISO } from "../motor/ciclo.js";

export function exportar(datos) {
  return JSON.stringify({ ...datos, exportado: new Date().toISOString(), version: VERSION_DATOS }, null, 2);
}

export function nombreDeRespaldo(iso = hoyISO()) {
  return `finanzas-${iso}.json`;
}

/**
 * Lee un respaldo. Nunca lanza: devuelve el motivo para poder enseñarlo en pantalla.
 * Un respaldo de una versión más nueva se RECHAZA en vez de abrirse a medias.
 */
export function importar(texto) {
  let crudo;
  try {
    crudo = JSON.parse(texto);
  } catch (e) {
    return { ok: false, motivo: "El archivo no es un JSON válido.", datos: null };
  }
  return migrar(crudo);
}
