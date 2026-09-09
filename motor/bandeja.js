// La bandeja — lo que llegó solo, esperando que tú digas que sí.
//
// Es la pieza que hace útil todo lo demás, y la regla que la gobierna es una sola:
// NADA de aquí cuenta en ningún número hasta que la persona lo acepta. Un aviso mal leído
// puede equivocarse; lo que no puede es equivocarse en silencio dentro de tus cuentas.
//
// Al aceptar, la app aprende. Esa es la mitad que convierte la bandeja de un trámite diario
// en algo que se hace cada vez más corto.

import { hoyISO, comparar } from "./ciclo.js";
import {
  agregarMovimiento, eliminarMovimiento, normalizarEntrada,
  ESTADOS_BANDEJA, ORIGENES, TIPOS,
} from "./modelo.js";
import { interpretar, posibleDuplicado } from "./lectura.js";
import { sugerirCategoria, recordar } from "./aprendizaje.js";
import { veredicto, ESTADOS, SEVERIDADES } from "./veredicto.js";

/**
 * Lee un aviso y lo deja en la bandeja. Devuelve `{ datos, entrada, duplicado, error }`.
 * Si es exactamente el mismo aviso que ya está esperando, NO lo agrega: devuelve el aviso de
 * duplicado. Dos correos por una compra es lo normal, no la excepción.
 */
export function recibirAviso(datos, texto, remitente = "", origen = ORIGENES.PEGADO, iso = hoyISO()) {
  const lectura = interpretar(texto, remitente, iso);
  if (!lectura.movimiento) return { datos, entrada: null, duplicado: null, error: lectura.veredicto };

  const duplicado = posibleDuplicado(datos, lectura);
  if (duplicado && duplicado.datos.motivo === "huella") {
    return { datos, entrada: null, duplicado, error: null };
  }

  const sugerida = lectura.movimiento.tipo === TIPOS.GASTO ? sugerirCategoria(datos, lectura.comercio) : null;
  const razones = lectura.veredicto.datos.razones || [];
  const entrada = normalizarEntrada({
    recibido: iso,
    estado: ESTADOS_BANDEJA.PENDIENTE,
    movimiento: { ...lectura.movimiento, categoria: sugerida ? sugerida.categoriaId : lectura.movimiento.categoria },
    huella: lectura.huella,
    confianza: lectura.confianza,
    banco: lectura.banco,
    comercio: lectura.comercio,
    ultimos4: lectura.ultimos4,
    origen,
    posibleTraspaso: lectura.posibleTraspaso,
    // Un cargo final NO es un gasto nuevo: sustituye a la preautorización que ya está.
    reemplaza: duplicado && duplicado.datos.motivo === "liquidacion" ? duplicado.datos.id : null,
    aviso: [duplicado ? duplicado.motivo : "", ...razones].filter(Boolean).join(" "),
  });

  return { datos: { ...datos, bandeja: [entrada, ...(datos.bandeja || [])] }, entrada, duplicado, error: null };
}

export function entradaPorId(datos, id) {
  return (datos.bandeja || []).find((e) => e.id === id) || null;
}

/** Lo que espera respuesta, lo más reciente arriba. */
export function pendientes(datos) {
  return (datos.bandeja || [])
    .filter((e) => e.estado === ESTADOS_BANDEJA.PENDIENTE)
    .sort((a, b) => comparar(b.recibido, a.recibido) || (a.id < b.id ? 1 : -1));
}

/** Para el contador de la barra y para saber si hay algo que hacer hoy. */
export function resumenBandeja(datos) {
  const espera = pendientes(datos);
  return {
    pendientes: espera.length,
    dudosos: espera.filter((e) => e.confianza !== "alta").length,
    total: (datos.bandeja || []).length,
  };
}

/**
 * Acepta una entrada: crea el movimiento de verdad y aprende de lo que se corrigió.
 * `cambios` es lo que la persona editó antes de aceptar (categoría, monto, tipo, fecha, nota).
 */
export function aceptarEntrada(datos, id, cambios = {}, iso = hoyISO()) {
  const entrada = entradaPorId(datos, id);
  if (!entrada) return { datos, movimiento: null, error: "Esa entrada ya no está en la bandeja." };
  if (entrada.estado !== ESTADOS_BANDEJA.PENDIENTE) {
    return { datos, movimiento: null, error: "Esa entrada ya estaba resuelta." };
  }

  const { reemplazar, ...camposCambiados } = cambios;
  // Aceptar reemplazando quita antes la preautorización: si no, el mismo consumo quedaría
  // contado dos veces y la app mentiría hacia arriba, que es la peor dirección.
  const partida = reemplazar && entrada.reemplaza ? eliminarMovimiento(datos, entrada.reemplaza) : datos;

  const propuesto = { ...entrada.movimiento, ...camposCambiados };
  const { datos: conMovimiento, movimiento, error } = agregarMovimiento(partida, propuesto);
  if (error) return { datos, movimiento: null, error };

  // Aprender solo tiene sentido si sabemos de qué comercio hablamos y a dónde lo mandó.
  const aprendido = entrada.comercio && movimiento.tipo === TIPOS.GASTO && movimiento.categoria
    ? recordar(conMovimiento, entrada.comercio, movimiento.categoria, iso)
    : conMovimiento;

  return {
    datos: {
      ...aprendido,
      bandeja: aprendido.bandeja.map((e) =>
        e.id === id ? { ...e, estado: ESTADOS_BANDEJA.ACEPTADO, movimientoId: movimiento.id } : e),
      // La lápida del reemplazado viaja en `partida`; conservarla evita que el otro
      // dispositivo lo resucite en la siguiente sincronización.
    },
    movimiento,
    error: null,
  };
}

/** Descartar: ni se registra ni se vuelve a preguntar. Sirve para traspasos y para errores. */
export function descartarEntrada(datos, id) {
  return {
    ...datos,
    bandeja: (datos.bandeja || []).map((e) =>
      e.id === id && e.estado === ESTADOS_BANDEJA.PENDIENTE
        ? { ...e, estado: ESTADOS_BANDEJA.DESCARTADO }
        : e),
  };
}

/** Deshacer una aceptación: borra el movimiento que creó y la deja esperando otra vez. */
export function deshacerEntrada(datos, id) {
  const entrada = entradaPorId(datos, id);
  if (!entrada || entrada.estado !== ESTADOS_BANDEJA.ACEPTADO) return datos;

  const sinMovimiento = entrada.movimientoId ? eliminarMovimiento(datos, entrada.movimientoId) : datos;
  return {
    ...sinMovimiento,
    bandeja: sinMovimiento.bandeja.map((e) =>
      e.id === id ? { ...e, estado: ESTADOS_BANDEJA.PENDIENTE, movimientoId: null } : e),
  };
}

/**
 * Tira lo ya resuelto que es viejo. La bandeja es un buzón, no un archivo: sin esto crecería
 * para siempre y el respaldo se volvería pesado sin darle nada a nadie. Lo pendiente NUNCA
 * se tira, por viejo que sea.
 */
export function purgarBandeja(datos, antesDe) {
  return {
    ...datos,
    bandeja: (datos.bandeja || []).filter(
      (e) => e.estado === ESTADOS_BANDEJA.PENDIENTE || comparar(e.recibido, antesDe) >= 0),
  };
}

/** Cuánto suma lo que está esperando: el "si aceptas todo, esto cambia". */
export function impactoPendiente(datos) {
  const espera = pendientes(datos);
  const gasto = espera.filter((e) => e.movimiento.tipo === TIPOS.GASTO)
    .reduce((t, e) => t + e.movimiento.monto, 0);
  const ingreso = espera.filter((e) => e.movimiento.tipo === TIPOS.INGRESO)
    .reduce((t, e) => t + e.movimiento.monto, 0);

  return {
    gasto,
    ingreso,
    veredicto: espera.length
      ? veredicto(ESTADOS.AJUSTADO, SEVERIDADES.INFO,
        `${espera.length} ${espera.length === 1 ? "movimiento espera" : "movimientos esperan"} tu confirmación.`,
        { pendientes: espera.length, gasto, ingreso })
      : veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK, "No hay nada esperando.", { pendientes: 0 }),
  };
}
