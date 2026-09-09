// Fusión — juntar dos copias del documento sin perder nada de ninguna.
//
// Antes, sincronizar elegía UN documento entero por su fecha y descartaba el otro completo.
// Con un solo dispositivo eso basta; con dos, no. Medido: capturar un gasto en el celular y
// otro en la PC la misma tarde hacía desaparecer uno de los dos, en silencio. Perder una
// captura sin avisar es el peor fallo que puede tener esta app.
//
// La respuesta no necesita CRDTs ni dependencias, porque estos datos tienen la forma correcta:
// los movimientos y las entradas de bandeja son registros con `id` propio. Unirlos por id no
// pierde nada. Lo escalar —el perfil, los topes— sí se resuelve por el más reciente, que es lo
// razonable cuando no hay forma de saber más.
//
// Borrar necesita LÁPIDAS. Sin ellas, borrar un movimiento en el celular lo resucitaría al
// unirse con la copia vieja de la PC, que todavía lo tiene. Una lápida dice "esto se borró a
// propósito" y gana sobre cualquier copia que siga teniéndolo.

import { mesDe, comparar } from "./ciclo.js";
import { ESTADOS_BANDEJA } from "./modelo.js";

/** Cuál de los dos documentos se escribió al último. */
export function selloDe(documento) {
  return (documento && (documento.actualizado || documento.creado)) || "";
}

/** Une dos listas de registros con `id`. Si el mismo id está en las dos, gana el del más nuevo. */
export function unirPorId(viejos, nuevos) {
  const porId = new Map();
  for (const registro of viejos || []) if (registro && registro.id) porId.set(registro.id, registro);
  for (const registro of nuevos || []) if (registro && registro.id) porId.set(registro.id, registro);
  return [...porId.values()];
}

/**
 * Une la bandeja. Además de por id, resuelve el estado: si un dispositivo ya lo aceptó o lo
 * descartó y el otro lo sigue teniendo pendiente, gana el resuelto — lo contrario resucitaría
 * un aviso que la persona ya atendió.
 */
export function unirBandeja(viejas, nuevas) {
  const porId = new Map();
  for (const entrada of [...(viejas || []), ...(nuevas || [])]) {
    if (!entrada || !entrada.id) continue;
    const previa = porId.get(entrada.id);
    if (!previa) {
      porId.set(entrada.id, entrada);
      continue;
    }
    const previaResuelta = previa.estado !== ESTADOS_BANDEJA.PENDIENTE;
    const actualResuelta = entrada.estado !== ESTADOS_BANDEJA.PENDIENTE;
    porId.set(entrada.id, previaResuelta && !actualResuelta ? previa : entrada);
  }
  return [...porId.values()];
}

/** Todos los movimientos de un documento, en una sola lista. */
export function movimientosPlanos(documento) {
  return Object.values((documento && documento.movimientos) || []).flat();
}

/** Los movimientos vueltos a agrupar por mes, ordenados como los deja el modelo. */
export function porMes(lista) {
  const salida = {};
  for (const movimiento of lista) {
    if (!movimiento || !movimiento.fecha) continue;
    const mes = mesDe(movimiento.fecha);
    (salida[mes] = salida[mes] || []).push(movimiento);
  }
  for (const mes of Object.keys(salida)) {
    salida[mes].sort((a, b) => comparar(b.fecha, a.fecha) || (a.id < b.id ? 1 : -1));
  }
  return salida;
}

/**
 * Fusiona dos copias del documento. Nunca pierde un movimiento que exista en alguna de las dos
 * y que nadie haya borrado a propósito.
 *
 * Devuelve un documento nuevo; no muta ninguno de los dos.
 */
export function fusionar(a, b) {
  if (!a) return b || null;
  if (!b) return a;

  // Lo escalar y lo que se edita entero se toma del que se escribió al último.
  const [viejo, nuevo] = comparar(selloDe(a), selloDe(b)) <= 0 ? [a, b] : [b, a];

  const borrados = unirPorId(viejo.borrados, nuevo.borrados);
  const enterrados = new Set(borrados.map((t) => t.id));
  const vivo = (registro) => !enterrados.has(registro.id);

  return {
    ...nuevo,
    // Un movimiento existe si estaba en cualquiera de las dos copias y nadie lo borró.
    movimientos: porMes(unirPorId(movimientosPlanos(viejo), movimientosPlanos(nuevo)).filter(vivo)),
    bandeja: unirBandeja(viejo.bandeja, nuevo.bandeja).filter(vivo),
    // Estos también son listas con id: unirlas evita perder un fijo creado en el otro aparato.
    fijos: unirPorId(viejo.fijos, nuevo.fijos).filter(vivo),
    deudas: unirPorId(viejo.deudas, nuevo.deudas).filter(vivo),
    metas: unirPorId(viejo.metas, nuevo.metas).filter(vivo),
    // Las reglas aprendidas se llevan por clave, no por id: gana la más reciente de cada una.
    reglas: unirReglas(viejo.reglas, nuevo.reglas),
    borrados,
    actualizado: selloDe(nuevo),
  };
}

/** Las reglas se identifican por su comercio. Ante la misma clave, gana la que se usó al último. */
export function unirReglas(viejas, nuevas) {
  const porClave = new Map();
  for (const regla of [...(viejas || []), ...(nuevas || [])]) {
    if (!regla || !regla.clave) continue;
    const previa = porClave.get(regla.clave);
    if (!previa || comparar(previa.ultima || "", regla.ultima || "") <= 0) porClave.set(regla.clave, regla);
  }
  return [...porClave.values()];
}

/** ¿Hace falta escribir la fusión de vuelta, o los dos lados ya decían lo mismo? */
export function difieren(a, b) {
  if (!a || !b) return true;
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Cuánto se le tolera a un reloj antes de considerarlo desfasado. */
export const TOLERANCIA_RELOJ_MIN = 5;

/**
 * ¿Alguna de las dos copias viene sellada en el futuro?
 *
 * Al unir, lo escalar —el perfil, los topes— se toma de la copia con el sello más reciente.
 * Eso da por hecho que los relojes de los dos aparatos dicen más o menos lo mismo, y es la
 * suposición que rompe cualquier sistema repartido: un celular diez minutos adelantado gana
 * SIEMPRE, aunque haya escrito antes.
 *
 * Los movimientos ya no corren peligro —se unen por id y borrar exige lápida—, así que esto
 * no bloquea nada: avisa, que es lo que se puede hacer con honestidad. Devuelve los minutos
 * de desfase, o `null` si los relojes van bien.
 */
export function relojDesfasado(documentos, ahoraISO, tolerancia = TOLERANCIA_RELOJ_MIN) {
  const ahora = Date.parse(ahoraISO);
  if (!Number.isFinite(ahora)) return null;

  let peor = 0;
  for (const documento of documentos) {
    const sello = Date.parse(selloDe(documento));
    if (!Number.isFinite(sello)) continue;
    peor = Math.max(peor, Math.round((sello - ahora) / 60000));
  }
  return peor > tolerancia ? peor : null;
}
