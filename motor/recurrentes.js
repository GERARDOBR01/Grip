// Recurrentes — encontrar las suscripciones que ya estás pagando.
//
// Es el negocio entero de una app que cobra por esto: mirar el historial, ver qué se repite,
// y avisar cuando algo sube de precio. Aquí sale gratis, porque los datos ya están.
//
// Dos cosas hacen que sirva en vez de estorbar:
//   · Se piden TRES cargos antes de llamarle recurrente. Dos son una casualidad.
//   · Si ya lo tienes como pago fijo, no vuelve a proponerlo. Nada peor que una app que
//     insiste en algo que ya resolviste.

import { normalizarComercio } from "./lectura.js";
import { TIPOS } from "./modelo.js";
import { diasEntre, sumarDias, hoyISO, comparar } from "./ciclo.js";
import { formatear } from "./dinero.js";
import { veredicto, ESTADOS, SEVERIDADES } from "./veredicto.js";

const MINIMO_CARGOS = 3;
const TOLERANCIA_DIAS = 8; // un cobro mensual cae en días distintos; eso no lo hace irregular

/**
 * Cuánto puede desviarse un ciclo de N meses y seguir siendo el mismo cobro.
 * Crece poco a propósito: lo mensual baila (meses de 28 a 31 días, fines de semana), pero un
 * cobro semestral cae en la misma fecha del calendario. Si la holgura creciera proporcional,
 * un hueco de 200 días pasaría por "cada 6 meses" y eso ya es inventarse un ritmo.
 */
function toleranciaDe(meses) {
  return Math.min(TOLERANCIA_DIAS + (meses - 1) * 1.5, 18);
}

/** Cada cuánto se repite, en meses, o null si el ritmo no se parece a nada conocido. */
export function frecuenciaDeDias(dias) {
  for (const [meses, centro] of [[1, 30], [2, 61], [3, 91], [6, 182], [12, 365]]) {
    if (Math.abs(dias - centro) <= toleranciaDe(meses)) return meses;
  }
  return null;
}

function mediana(numeros) {
  const orden = [...numeros].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : Math.round((orden[medio - 1] + orden[medio]) / 2);
}

/** Los gastos agrupados por comercio, cada grupo ordenado de viejo a nuevo. */
export function agruparPorComercio(datos) {
  const grupos = new Map();
  for (const lista of Object.values(datos.movimientos || {})) {
    for (const m of lista) {
      if (m.tipo !== TIPOS.GASTO) continue;
      const clave = normalizarComercio(m.nota);
      if (!clave) continue;
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(m);
    }
  }
  for (const lista of grupos.values()) lista.sort((a, b) => comparar(a.fecha, b.fecha));
  return grupos;
}

/**
 * Las suscripciones que se ven en el historial.
 * Devuelve una lista ordenada por lo que más cuesta al mes, que es el orden en que conviene
 * mirarlas cuando quieres recortar.
 */
export function detectarRecurrentes(datos, iso = hoyISO()) {
  const yaFijos = new Set((datos.fijos || []).map((f) => normalizarComercio(f.nombre)).filter(Boolean));
  const salida = [];

  for (const [clave, cargos] of agruparPorComercio(datos)) {
    if (cargos.length < MINIMO_CARGOS) continue;

    const huecos = cargos.slice(1).map((m, i) => diasEntre(cargos[i].fecha, m.fecha));
    const tipico = mediana(huecos);
    const frecuencia = frecuenciaDeDias(tipico);
    if (!frecuencia) continue;

    // Un ritmo es un ritmo si casi todos los huecos se parecen entre sí.
    const regulares = huecos.filter((d) => Math.abs(d - tipico) <= toleranciaDe(frecuencia));
    if (regulares.length < huecos.length - 1) continue;

    const ultimo = cargos[cargos.length - 1];
    const anteriores = cargos.slice(0, -1).map((m) => m.monto);
    const montoAnterior = mediana(anteriores);
    const subio = ultimo.monto > montoAnterior;

    salida.push({
      clave,
      nombre: ultimo.nota || clave,
      monto: ultimo.monto,
      montoAnterior: subio ? montoAnterior : null,
      frecuencia,
      mensualizado: Math.round(ultimo.monto / frecuencia),
      veces: cargos.length,
      ultimaFecha: ultimo.fecha,
      proximaFecha: sumarDias(ultimo.fecha, tipico),
      categoria: ultimo.categoria,
      yaEsFijo: yaFijos.has(clave),
      veredicto: subio
        ? veredicto(ESTADOS.NO_ALCANZA, SEVERIDADES.MEDIA,
          `${ultimo.nota || clave} te subió de ${formatear(montoAnterior)} a ${formatear(ultimo.monto)}.`,
          { clave, antes: montoAnterior, ahora: ultimo.monto, sube: ultimo.monto - montoAnterior })
        : veredicto(ESTADOS.VA_BIEN, SEVERIDADES.INFO,
          `Se repite cada ${frecuencia === 1 ? "mes" : `${frecuencia} meses`}: ${cargos.length} cargos de ${formatear(ultimo.monto)}.`,
          { clave, frecuencia, veces: cargos.length }),
    });
  }

  return salida.sort((a, b) => b.mensualizado - a.mensualizado);
}

/** Lo que todavía no está registrado como pago fijo — lo único que vale la pena proponer. */
export function porRegistrar(datos, iso = hoyISO()) {
  return detectarRecurrentes(datos, iso).filter((r) => !r.yaEsFijo);
}

/** Las que subieron de precio. Este es el aviso que de verdad ahorra dinero. */
export function subieronDePrecio(datos, iso = hoyISO()) {
  return detectarRecurrentes(datos, iso).filter((r) => r.montoAnterior !== null);
}

/** Convierte una recurrente detectada en el pago fijo que ya se sabe manejar. */
export function fijoDesdeRecurrente(recurrente) {
  return {
    nombre: recurrente.nombre.slice(0, 80),
    monto: recurrente.monto,
    diaCorte: Number(recurrente.proximaFecha.slice(8, 10)),
    frecuencia: recurrente.frecuencia,
    mesAncla: recurrente.frecuencia === 1 ? null : recurrente.proximaFecha.slice(0, 7),
    categoria: recurrente.categoria || "suscripciones",
    activo: true,
  };
}

/** Cuánto se va al mes en cosas que se repiten. El número que nadie tiene a la mano. */
export function totalRecurrenteMensual(datos, iso = hoyISO()) {
  const lista = detectarRecurrentes(datos, iso);
  const total = lista.reduce((t, r) => t + r.mensualizado, 0);
  return {
    total,
    cuantas: lista.length,
    veredicto: lista.length
      ? veredicto(ESTADOS.VA_BIEN, SEVERIDADES.INFO,
        `${lista.length} ${lista.length === 1 ? "cosa se repite y suma" : "cosas se repiten y suman"} ${formatear(total)} al mes.`, { total, cuantas: lista.length })
      : veredicto(ESTADOS.SIN_DATOS, SEVERIDADES.INFO,
        "Todavía no hay suficiente historial para ver qué se repite.",
        { falta: `captura al menos ${MINIMO_CARGOS} cargos del mismo lugar` }),
  };
}
