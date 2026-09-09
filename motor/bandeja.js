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
  ESTADOS_BANDEJA, ORIGENES, TIPOS, esperaRespuesta,
} from "./modelo.js";
import { interpretar, posibleDuplicado, limpiarAviso } from "./lectura.js";
import { sugerirCategoria, recordar } from "./aprendizaje.js";
import { veredicto, ESTADOS, SEVERIDADES } from "./veredicto.js";

/**
 * Lee un aviso y lo deja en la bandeja. Devuelve `{ datos, entrada, duplicado, error }`.
 * Si es exactamente el mismo aviso que ya está esperando, NO lo agrega: devuelve el aviso de
 * duplicado. Dos correos por una compra es lo normal, no la excepción.
 */
export function recibirAviso(datos, texto, remitente = "", origen = ORIGENES.PEGADO, iso = hoyISO()) {
  const lectura = interpretar(texto, remitente, iso);
  if (!lectura.movimiento) {
    // Pegado a mano, la persona está viendo la pantalla: el error se le enseña al instante y
    // meterlo a la bandeja sería ruido. Lo que llega SOLO es otra cosa. Hasta hoy se contaba
    // como "ilegible" y se tiraba, y con ocho de once bancos cuyo formato nadie ha visto —y
    // plantillas que cambian sin avisar—, ahí desaparecía dinero real sin dejar rastro.
    if (origen === ORIGENES.PEGADO) {
      return { datos, entrada: null, duplicado: null, error: lectura.veredicto };
    }

    const entrada = normalizarEntrada({
      recibido: iso,
      estado: ESTADOS_BANDEJA.ILEGIBLE,
      movimiento: null,
      banco: lectura.banco,
      origen,
      aviso: lectura.veredicto.motivo,
      falta: lectura.veredicto.datos && lectura.veredicto.datos.falta
        ? [lectura.veredicto.datos.falta]
        : ["cuánto"],
      resumen: primeraLinea(texto),
    });
    return {
      datos: { ...datos, bandeja: [entrada, ...(datos.bandeja || [])] },
      entrada,
      duplicado: null,
      error: lectura.veredicto,
    };
  }

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

/**
 * La primera línea con algo escrito, para poder reconocer el aviso en la lista.
 *
 * La primera línea Y NADA MÁS. Cuando el aviso viene del puente, esa línea es el asunto del
 * correo — "Notificación de compra" y el nombre del banco—, que alcanza para saber cuál es sin
 * guardar el cuerpo. La promesa de este motor no cambia: el correo se lee y se tira.
 */
function primeraLinea(texto) {
  const linea = limpiarAviso(texto).split("\n").map((l) => l.trim()).find(Boolean) || "";
  return linea.slice(0, 120);
}

/** Las que llegaron y no se pudieron leer: esperan que digas cuánto y dónde. */
export function ilegibles(datos) {
  return (datos.bandeja || [])
    .filter((e) => e.estado === ESTADOS_BANDEJA.ILEGIBLE)
    .sort((a, b) => comparar(b.recibido, a.recibido) || (a.id < b.id ? 1 : -1));
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
    ilegibles: ilegibles(datos).length,
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
  if (!esperaRespuesta(entrada)) {
    return { datos, movimiento: null, error: "Esa entrada ya estaba resuelta." };
  }

  const { reemplazar, ...camposCambiados } = cambios;
  // Aceptar reemplazando quita antes la preautorización: si no, el mismo consumo quedaría
  // contado dos veces y la app mentiría hacia arriba, que es la peor dirección.
  const partida = reemplazar && entrada.reemplaza ? eliminarMovimiento(datos, entrada.reemplaza) : datos;

  // Una entrada ILEGIBLE no trae movimiento: lo pone la persona. Se le da la fecha en que
  // llegó el aviso como punto de partida, que es lo más cercano a la verdad que se sabe.
  const base = entrada.movimiento || { fecha: entrada.recibido, tipo: TIPOS.GASTO, categoria: "otros" };
  const propuesto = { ...base, ...camposCambiados };
  const { datos: conMovimiento, movimiento, error } = agregarMovimiento(partida, propuesto);
  if (error) return { datos, movimiento: null, error };

  // Aprender solo tiene sentido si sabemos de qué comercio hablamos y a dónde lo mandó. En una
  // entrada ilegible el comercio no salió del correo: lo escribió la persona, y ése es
  // justamente el que hay que aprender — así el siguiente aviso del mismo lugar ya llega con
  // su categoría aunque el formato del banco siga sin entenderse.
  const paraAprender = entrada.comercio || movimiento.nota;
  const aprendido = paraAprender && movimiento.tipo === TIPOS.GASTO && movimiento.categoria
    ? recordar(conMovimiento, paraAprender, movimiento.categoria, iso)
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
      e.id === id && esperaRespuesta(e)
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
      (e) => esperaRespuesta(e) || comparar(e.recibido, antesDe) >= 0),
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

/**
 * Acepta varias entradas de un jalón, con UN solo guardado.
 *
 * Ésta es la pieza que decide si la app sirve para alguien sin tiempo. Con el puente trayendo
 * correos, son ~40 avisos por quincena, y a un toque cada uno eso es exactamente el mecanismo
 * que la investigación señala como la causa número uno de que la gente abandone estas apps
 * antes de los 30 días. En lote son tres.
 *
 * La regla de la casa NO cambia: sigue aceptando la persona, viendo antes lo que acepta. Lo
 * que cambia es que decir que sí a doce cosas cueste un toque en vez de doce.
 *
 * Si alguna no se puede aceptar, se queda esperando y las demás pasan: un fallo suelto no
 * puede tumbar la tanda ni dejarla a medias sin decirlo.
 */
export function aceptarTanda(datos, ids, iso = hoyISO()) {
  let actual = datos;
  const aceptados = [];
  const fallaron = [];

  for (const id of ids || []) {
    const paso = aceptarEntrada(actual, id, {}, iso);
    if (paso.error || !paso.movimiento) {
      fallaron.push(id);
      continue;
    }
    actual = paso.datos;
    aceptados.push(id);
  }

  return { datos: actual, aceptados, fallaron };
}

/** Deshace una tanda entera. Es lo que hace que aceptar de golpe no dé miedo. */
export function deshacerTanda(datos, ids) {
  return (ids || []).reduce((acumulado, id) => deshacerEntrada(acumulado, id), datos);
}

/** Las que se pueden aceptar sin mirarlas una por una: no quedó nada que revisar en ellas. */
export function deConfianzaAlta(datos) {
  return pendientes(datos).filter((e) => e.confianza === "alta" && !e.reemplaza);
}
