// Tendencia — ¿voy mejorando?
//
// La app contesta muy bien "¿cómo voy hoy?", y no contestaba "¿estoy mejor que hace tres
// meses?". Son preguntas distintas: se puede tener una quincena buena dentro de un año malo.
//
// Y va la cuarta regla de YNAB traída a la quincena mexicana: no "ahorré algo", sino
// "cuántas quincenas puedo vivir con lo que tengo guardado". Ese número es el que de verdad
// dice si alguien está saliendo del hoyo o solo tuvo una semana tranquila.

import { cicloDe, sumarDias, hoyISO, comparar } from "./ciclo.js";
import { movimientosEntre, TIPOS, suma } from "./modelo.js";
import { ahorroLibre } from "./ahorro.js";
import { formatear } from "./dinero.js";
import { veredicto, sinDatos, ESTADOS, SEVERIDADES } from "./veredicto.js";

const MESES_ABREVIADOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "sep 1", "sep 2" — la etiqueta del ciclo sola se repite cada mes y no sirve para una gráfica. */
export function etiquetaCorta(ciclo) {
  return `${MESES_ABREVIADOS[Number(ciclo.inicio.slice(5, 7)) - 1]} ${ciclo.indice + 1}`;
}

/** Cuántos ciclos completos hacen falta antes de hablar de tendencia. Menos es ruido. */
const CICLOS_MINIMOS = 4;

/** Los últimos n ciclos, del más viejo al más nuevo. */
export function ciclosRecientes(datos, iso = hoyISO(), n = 6) {
  const cortes = datos.perfil.cortes;
  const lista = [];
  let cursor = iso;
  for (let i = 0; i < n; i++) {
    const ciclo = cicloDe(cursor, cortes);
    lista.unshift(ciclo);
    cursor = sumarDias(ciclo.inicio, -1);
  }
  return lista;
}

/**
 * Cuánto entró, cuánto salió y cuánto sobró en cada uno de los últimos ciclos.
 * El ciclo en curso viene marcado `completo: false`: compararlo de tú a tú con los cerrados
 * haría ver una caída donde solo hay días que todavía no pasan.
 */
export function tendenciaPorCiclo(datos, iso = hoyISO(), n = 6) {
  return ciclosRecientes(datos, iso, n).map((ciclo) => {
    const movimientos = movimientosEntre(datos, ciclo.inicio, ciclo.fin);
    const ingresos = suma(movimientos, (m) => m.tipo === TIPOS.INGRESO);
    const gastos = suma(movimientos, (m) => m.tipo === TIPOS.GASTO);
    const ahorrado = suma(movimientos, (m) => m.tipo === TIPOS.AHORRO) - suma(movimientos, (m) => m.tipo === TIPOS.RETIRO);
    return {
      etiqueta: ciclo.etiqueta,
      corta: etiquetaCorta(ciclo),
      inicio: ciclo.inicio,
      fin: ciclo.fin,
      ingresos,
      gastos,
      ahorrado,
      saldo: ingresos - gastos,
      completo: comparar(ciclo.fin, iso) < 0,
      hayDatos: movimientos.length > 0,
    };
  });
}

/**
 * ¿Va mejorando? Compara la primera mitad de los ciclos cerrados con la segunda.
 * Con pocos datos NO adivina: dice cuántos ciclos faltan para poder contestar.
 */
export function resumenTendencia(datos, iso = hoyISO(), n = 6) {
  const puntos = tendenciaPorCiclo(datos, iso, n);
  const cerrados = puntos.filter((p) => p.completo && p.hayDatos);

  if (cerrados.length < CICLOS_MINIMOS) {
    return {
      puntos,
      cambio: null,
      veredicto: sinDatos(
        `Llevas ${cerrados.length} ${cerrados.length === 1 ? "quincena" : "quincenas"} con datos; con ${CICLOS_MINIMOS} ya se puede ver si mejoras.`,
        "sigue capturando: la tendencia aparece sola",
      ),
    };
  }

  const mitad = Math.floor(cerrados.length / 2);
  const promedio = (lista) => Math.round(lista.reduce((t, p) => t + p.saldo, 0) / lista.length);
  const antes = promedio(cerrados.slice(0, mitad));
  const ahora = promedio(cerrados.slice(mitad));
  const cambio = ahora - antes;

  const mejora = cambio > 0;
  return {
    puntos,
    cambio,
    antes,
    ahora,
    veredicto: veredicto(
      mejora ? ESTADOS.VA_BIEN : ESTADOS.AJUSTADO,
      mejora ? SEVERIDADES.OK : SEVERIDADES.MEDIA,
      mejora
        ? `Te está sobrando ${formatear(cambio)} más por quincena que antes.`
        : `Te está sobrando ${formatear(Math.abs(cambio))} menos por quincena que antes.`,
      { antes, ahora, cambio, ciclos: cerrados.length },
    ),
  };
}

/**
 * Cuántas quincenas podrías vivir con lo guardado, si mañana dejaras de cobrar.
 * Es la cuarta regla de YNAB —"envejece tu dinero"— en la moneda de esta app. Se mide contra
 * lo que de verdad gastas, no contra lo que crees que gastas.
 */
export function quincenasDeColchon(datos, iso = hoyISO(), n = 6) {
  const guardado = ahorroLibre(datos);
  const cerrados = tendenciaPorCiclo(datos, iso, n).filter((p) => p.completo && p.hayDatos);

  if (!cerrados.length) {
    return {
      quincenas: null,
      guardado,
      gastoTipico: null,
      veredicto: sinDatos(
        "Todavía no sé cuánto gastas en una quincena normal, así que no puedo decir cuánto te duraría lo guardado.",
        "captura una quincena completa de gastos",
      ),
    };
  }

  const gastoTipico = Math.round(cerrados.reduce((t, p) => t + p.gastos, 0) / cerrados.length);
  if (gastoTipico <= 0) {
    return { quincenas: null, guardado, gastoTipico, veredicto: sinDatos("No hay gastos registrados con qué comparar.", "captura tus gastos de una quincena") };
  }

  const quincenas = guardado / gastoTipico;
  const redondo = Math.round(quincenas * 10) / 10;

  return {
    quincenas: redondo,
    guardado,
    gastoTipico,
    veredicto: veredicto(
      quincenas >= 4 ? ESTADOS.VA_BIEN : quincenas >= 1 ? ESTADOS.AJUSTADO : ESTADOS.NO_ALCANZA,
      quincenas >= 4 ? SEVERIDADES.OK : quincenas >= 1 ? SEVERIDADES.MEDIA : SEVERIDADES.ALTA,
      quincenas >= 1
        ? `Con lo guardado vivirías ${redondo} ${redondo === 1 ? "quincena" : "quincenas"} sin cobrar.`
        : `Lo guardado no cubre ni una quincena: gastas ${formatear(gastoTipico)} y tienes ${formatear(guardado)}.`,
      { quincenas: redondo, guardado, gastoTipico },
    ),
  };
}
