// Respaldo — el puente para que estos datos nunca queden atrapados en ninguna app.
//
// Lo que exporta es el documento completo, tal cual, en JSON legible. Es el mismo formato
// que come el importador. Si mañana esta app deja de existir, los datos salen enteros.

import { migrar } from "../motor/migraciones.js";
import { VERSION_DATOS } from "../motor/modelo.js";
import { hoyISO, diasEntre, comparar } from "../motor/ciclo.js";

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

/**
 * Cada cuántos días tiene sentido volver a bajar un respaldo. Ni tan seguido que se vuelva
 * ruido que se aprende a ignorar, ni tan lejos que una limpieza del navegador duela.
 */
export const DIAS_ENTRE_RESPALDOS = 30;

/** Debajo de esto no se molesta a nadie: todavía no hay gran cosa que perder. */
const MINIMO_PARA_INSISTIR = 10;

/**
 * ¿Toca recordarle bajar un respaldo? Devuelve `null` cuando no, y si sí, con qué números.
 *
 * Es la lección de Mint, que cerró con 25 millones de usuarios encima: lo que salva tu
 * historia no es que la app tenga exportador, es haberlo USADO. Grip lo tiene desde el
 * principio y nunca lo mencionaba, así que servía de nada.
 *
 * No bloquea, no regaña y no aparece si no hay nada nuevo que perder.
 */
export function respaldoPendiente(datos, iso = hoyISO()) {
  const movimientos = Object.values((datos && datos.movimientos) || {}).flat();
  if (!movimientos.length) return null; // sin nada capturado, no hay nada que salvar

  const ultimo = datos.ultimoRespaldo || null;

  if (!ultimo) {
    // Nunca ha bajado uno. Se espera a que haya algo que de verdad duela perder.
    return movimientos.length >= MINIMO_PARA_INSISTIR
      ? { nunca: true, dias: null, movimientos: movimientos.length }
      : null;
  }

  const dias = diasEntre(ultimo.slice(0, 10), iso);
  if (dias < DIAS_ENTRE_RESPALDOS) return null;

  // Y si desde el último respaldo no capturó nada, tampoco hay por qué molestarlo.
  const nuevos = movimientos.filter((m) => comparar(m.fecha, ultimo.slice(0, 10)) > 0).length;
  return nuevos > 0 ? { nunca: false, dias, movimientos: nuevos } : null;
}
