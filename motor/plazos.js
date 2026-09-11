// Plazos — las compras a meses sin intereses, que de gratis no tienen nada.
//
// "Sin intereses" se lee como "sin costo", y por eso es la trampa más limpia que hay: no te
// cobran de más, pero te comprometen los meses que vienen. Se compra un refri a 12 meses, y
// una pantalla a 18, y unas llantas a 6, y sin darse cuenta hay $4,000 al mes apartados hasta
// el año que entra. Nadie hizo nunca esa suma, porque no había dónde.
//
// Aquí está esa suma, y las dos reglas que la hacen honesta:
//
//   · UNA COMPRA A MESES NO ES UN GASTO DE ESTE MES. Es una mensualidad durante N meses, y
//     así entra a las cuentas: $1,000 al mes, no $12,000 hoy. Es la misma decisión que ya
//     tomó `fijos.js` al separar el promedio mensual de lo que se paga este mes.
//
//   · NO SE INVENTAN MOVIMIENTOS. Un plazo a 12 meses no escribe doce movimientos futuros en
//     el historial: eso serían doce cosas que no han pasado sentadas entre las que sí. Las
//     mensualidades se calculan cuando se necesitan y se cargan al corte que les toca.

import { repartir, formatear, plural } from "./dinero.js";
import { mesDe, mesesEntre, sumarMeses, hoyISO } from "./ciclo.js";
import { ESTADOS, SEVERIDADES, veredicto, sinDatos } from "./veredicto.js";

/** Cuántos meses hacia adelante se dibuja el calendario de lo comprometido. */
export const MESES_DE_CALENDARIO = 18;

/**
 * Las mensualidades de una compra, en centavos enteros que suman EXACTAMENTE el total.
 *
 * Va con `repartir` y no con `prorratear` a propósito: $12,000 entre 7 meses no da un número
 * redondo, y prorratear perdería centavos por el camino. Un MSI que no cuadra al peso con el
 * estado de cuenta no sirve para nada — es justo el número que la gente va a comparar.
 */
export function mensualidadesDe(plazo) {
  if (!plazo || plazo.montoTotal === null) return [];
  return repartir(plazo.montoTotal, plazo.meses);
}

/** Cuántas mensualidades van cargadas hasta ese mes, inclusive. 0 si todavía no empieza. */
export function mensualidadesCargadas(plazo, mes) {
  const transcurridos = mesesEntre(plazo.primerCargo, mes) + 1;
  return Math.min(Math.max(transcurridos, 0), plazo.meses);
}

/** Lo que esta compra carga en el corte de ese mes. 0 si ya terminó o no ha empezado. */
export function mensualidadEnMes(plazo, mes) {
  if (!plazo.activo || plazo.montoTotal === null) return 0;
  const indice = mesesEntre(plazo.primerCargo, mes);
  if (indice < 0 || indice >= plazo.meses) return 0;
  return mensualidadesDe(plazo)[indice] || 0;
}

/** Lo que esta compra ha cargado en total hasta ese mes, inclusive. */
export function cargadoHasta(plazo, mes) {
  if (plazo.montoTotal === null) return 0;
  const cuantas = mensualidadesCargadas(plazo, mes);
  return mensualidadesDe(plazo)
    .slice(0, cuantas)
    .reduce((total, m) => total + m, 0);
}

/** Cuántas mensualidades faltan por cargar después de ese mes. */
export function mesesRestantes(plazo, mes) {
  return Math.max(plazo.meses - mensualidadesCargadas(plazo, mes), 0);
}

/** Lo que falta por pagar de esta compra DESPUÉS del corte de ese mes. */
export function saldoPlazo(plazo, mes) {
  if (plazo.montoTotal === null) return null;
  return plazo.montoTotal - cargadoHasta(plazo, mes);
}

/**
 * Lo que falta por cargar DESDE ese mes, con ese mes incluido.
 *
 * La diferencia con `saldoPlazo` es de un mes y no es cosmética: si hoy estamos en el mes de
 * la última mensualidad, "lo que falta después de este corte" es cero, pero todavía te van a
 * cobrar una. Decir que ya terminaste sería la clase de cero falso que esta app no dice.
 */
export function porCargarDesde(plazo, mes) {
  if (plazo.montoTotal === null) return null;
  return plazo.montoTotal - cargadoHasta(plazo, mesAnterior(mes));
}

/** El "AAAA-MM" anterior a otro. */
function mesAnterior(mes) {
  return mesDe(sumarMeses(`${mes}-01`, -1));
}

/** ¿Esta compra todavía tiene mensualidades por caer, contando la de este mes? */
export function sigueViva(plazo, mes) {
  return plazo.activo && ultimoMes(plazo) >= mes;
}

/** El mes del último cargo: "AAAA-MM". */
export function ultimoMes(plazo) {
  return mesDe(sumarMeses(`${plazo.primerCargo}-01`, plazo.meses - 1));
}

/** Los plazos vivos de una tarjeta (o de todas) en ese mes. */
export function plazosActivos(datos, mes, tarjetaId = null) {
  return (datos.plazos || []).filter(
    (p) => p.activo && (!tarjetaId || p.tarjetaId === tarjetaId) && mensualidadEnMes(p, mes) > 0,
  );
}

/**
 * Cuánto tienes comprometido a meses, y hasta cuándo.
 *
 * Es el número que contesta "¿hasta cuándo estoy amarrado?", y la razón por la que este
 * módulo existe: es dinero que ya no es tuyo aunque todavía no haya salido de la cuenta.
 */
export function comprometidoAMeses(datos, iso = hoyISO(), tarjetaId = null) {
  const mes = mesDe(iso);
  const vivos = (datos.plazos || []).filter(
    (p) => sigueViva(p, mes) && (!tarjetaId || p.tarjetaId === tarjetaId),
  );

  const sinMonto = vivos.filter((p) => p.montoTotal === null).map((p) => p.nombre);
  const conMonto = vivos.filter((p) => p.montoTotal !== null);

  const alMes = conMonto.reduce((total, p) => total + mensualidadEnMes(p, mes), 0);
  const total = conMonto.reduce((suma, p) => suma + (porCargarDesde(p, mes) || 0), 0);
  const hastaMes = conMonto.reduce((tope, p) => {
    const fin = ultimoMes(p);
    return !tope || fin > tope ? fin : tope;
  }, null);
  // Cuántos meses faltan, no en qué mes acaba: "durante 4 meses más" se entiende de un vistazo
  // y "hasta 2026-12" hay que descifrarlo contando con los dedos.
  const mesesQueFaltan = hastaMes ? mesesEntre(mes, hastaMes) + 1 : 0;

  if (!vivos.length) {
    return {
      alMes: 0,
      total: 0,
      hastaMes: null,
      cuantos: 0,
      sinMonto: [],
      veredicto: veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK, "no tienes compras a meses activas", { total: 0 }),
    };
  }

  return {
    alMes,
    total,
    hastaMes,
    cuantos: vivos.length,
    sinMonto,
    veredicto: sinMonto.length
      ? sinDatos(
          `${plural(sinMonto.length, "compra a meses", "compras a meses")} sin monto no ${sinMonto.length === 1 ? "entra" : "entran"} en la cuenta`,
          `captura cuánto costó: ${sinMonto.join(", ")}`,
        )
      : veredicto(
          ESTADOS.AJUSTADO,
          SEVERIDADES.INFO,
          `${formatear(alMes)} al mes durante ${plural(mesesQueFaltan, "mes", "meses")} más — ${formatear(total)} en total`,
          { alMes, total, hastaMes, mesesQueFaltan, cuantos: vivos.length },
        ),
  };
}

/**
 * Mes a mes, lo que cargan los plazos hacia adelante. La lista baja conforme se acaban las
 * compras, y esa bajada es la respuesta visual a "¿cuándo vuelvo a respirar?".
 */
export function calendarioMSI(datos, iso = hoyISO(), meses = MESES_DE_CALENDARIO) {
  const salida = [];
  for (let i = 0; i < meses; i++) {
    const mes = mesDe(sumarMeses(iso, i));
    const activos = plazosActivos(datos, mes);
    salida.push({
      mes,
      monto: activos.reduce((total, p) => total + mensualidadEnMes(p, mes), 0),
      cuantos: activos.length,
    });
  }
  // Se recorta la cola vacía: enseñar seis meses en cero no dice nada que no diga terminar ahí.
  while (salida.length && salida[salida.length - 1].monto === 0) salida.pop();
  return salida;
}
