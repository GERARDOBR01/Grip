// Fijos y deudas — lo que ya está comprometido antes de que decidas nada.
//
// Sobre las deudas hay una regla que no se rompe: SIN TASA CAPTURADA NO SE PROYECTA
// INTERÉS. El saldo se reporta como lo que es —original menos pagos— y se declara que va
// sin intereses. Inventar una tasa "típica" daría un número creíble y falso, que es
// exactamente el peor tipo de número en una app de finanzas.

import { prorratear } from "./dinero.js";
import { mesDe, vencimientoEnMes, diasEntre, sumarMeses, mesesEntre } from "./ciclo.js";
import { TIPOS, movimientosEntre } from "./modelo.js";
import { ESTADOS, SEVERIDADES, veredicto, sinDatos } from "./veredicto.js";

/**
 * ¿A este fijo le toca en este mes?
 * Un seguro anual no se paga doce veces al año, y contarlo como mensual descuadraba la
 * capacidad de ahorro de todas las quincenas. Sin mes ancla, un fijo no mensual se toma
 * como que le toca en el mes en que se capturó.
 */
export function venceEnMes(fijo, mes) {
  const frecuencia = fijo.frecuencia || 1;
  if (frecuencia === 1) return true;
  const ancla = fijo.mesAncla || mes;
  return Math.abs(mesesEntre(ancla, mes)) % frecuencia === 0;
}

/** Lo que cuesta al mes en promedio: el monto repartido entre los meses de su frecuencia. */
export function montoMensualizado(fijo) {
  if (fijo.monto === null) return null;
  return prorratear(fijo.monto, 1, fijo.frecuencia || 1);
}

/** ¿Ya se pagó este fijo en este mes? Devuelve el movimiento que lo comprueba. */
export function pagoDeFijo(datos, fijoId, mes) {
  const lista = datos.movimientos[mes] || [];
  return lista.find((m) => m.fijoId === fijoId) || null;
}

/**
 * Lo que vence en los próximos `dias`, ordenado por fecha.
 * Incluye lo vencido y no pagado del mes en curso: eso es justo lo que no hay que olvidar.
 */
export function proximosVencimientos(datos, iso, dias = 15) {
  const hasta = sumarMeses(iso, 2);
  const salida = [];

  for (const fijo of datos.fijos) {
    if (!fijo.activo) continue;
    for (const mes of [mesDe(iso), mesDe(sumarMeses(iso, 1))]) {
      if (!venceEnMes(fijo, mes)) continue;
      const fecha = vencimientoEnMes(mes, fijo.diaCorte);
      if (fecha > hasta) continue;
      const pago = pagoDeFijo(datos, fijo.id, mes);
      const faltan = diasEntre(iso, fecha);
      if (pago || faltan > dias) continue;
      salida.push({
        fijo,
        mes,
        fecha,
        dias: faltan,
        vencido: faltan < 0,
        monto: fijo.monto,
      });
    }
  }

  return salida.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
}

/**
 * Lo que suman los fijos, en DOS números que no son el mismo:
 *   · `mensualizado` — el promedio por mes (un seguro anual entra dividido entre 12). Es el
 *     que debe entrar en la capacidad de ahorro: es lo que hay que ir apartando.
 *   · `esteMes` — lo que de verdad se paga en el mes de `iso`. Es lo que sale de la cuenta.
 * Antes había uno solo, y para cualquier fijo no mensual mentía.
 */
export function totalFijosMensual(datos, iso = null) {
  const mes = iso ? mesDe(iso) : null;
  let mensualizado = 0;
  let esteMes = 0;
  const desconocidos = [];

  for (const fijo of datos.fijos) {
    if (!fijo.activo) continue;
    if (fijo.monto === null) {
      desconocidos.push(fijo.nombre);
      continue;
    }
    mensualizado += montoMensualizado(fijo);
    if (mes && venceEnMes(fijo, mes)) esteMes += fijo.monto;
  }

  return {
    mensualizado,
    esteMes,
    total: mensualizado, // el nombre viejo sigue apuntando al promedio mensual
    desconocidos,
    veredicto: desconocidos.length
      ? sinDatos(
          `${desconocidos.length} fijo(s) sin monto no entran en el total`,
          `captura el monto de: ${desconocidos.join(", ")}`,
        )
      : veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK, "todos tus fijos tienen monto", { mensualizado }),
  };
}

/** Los pagos hechos a una deuda: movimientos etiquetados con su id. */
export function pagosDeDeuda(datos, deudaId) {
  const pagos = [];
  for (const lista of Object.values(datos.movimientos)) {
    for (const m of lista) if (m.deudaId === deudaId && m.tipo === TIPOS.GASTO) pagos.push(m);
  }
  return pagos.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

/**
 * El saldo de una deuda. Sin tasa, se declara que el número es sin intereses:
 * el pendiente real puede ser mayor, y quien lo lee tiene que saberlo.
 */
export function saldoDeuda(datos, deuda) {
  const pagos = pagosDeDeuda(datos, deuda.id);
  const pagado = pagos.reduce((t, p) => t + p.monto, 0);

  if (deuda.montoOriginal === null) {
    return {
      deuda,
      pagado,
      saldo: null,
      pagos: pagos.length,
      veredicto: sinDatos(
        `"${deuda.nombre}" no tiene monto original — no hay saldo que calcular`,
        `captura cuánto debías al inicio`,
      ),
    };
  }

  const saldo = Math.max(deuda.montoOriginal - pagado, 0);
  const nota =
    deuda.tasaAnual === null
      ? veredicto(
          saldo === 0 ? ESTADOS.VA_BIEN : ESTADOS.AJUSTADO,
          SEVERIDADES.INFO,
          "saldo sin intereses — no hay tasa capturada, así que aquí no se proyecta ninguno",
          { saldo, pagado, tasaAnual: null },
        )
      : veredicto(
          saldo === 0 ? ESTADOS.VA_BIEN : ESTADOS.AJUSTADO,
          SEVERIDADES.INFO,
          `saldo de capital; con tasa anual ${deuda.tasaAnual}% los intereses corren aparte`,
          { saldo, pagado, tasaAnual: deuda.tasaAnual },
        );

  return { deuda, pagado, saldo, pagos: pagos.length, veredicto: nota };
}

/** El total que se debe hoy, con lo que no se pudo contar declarado aparte. */
export function totalDeudas(datos) {
  let total = 0;
  const sinMonto = [];
  for (const deuda of datos.deudas) {
    if (!deuda.activa) continue;
    const { saldo } = saldoDeuda(datos, deuda);
    if (saldo === null) sinMonto.push(deuda.nombre);
    else total += saldo;
  }
  return { total, sinMonto, conIntereses: false };
}

/**
 * Movimiento listo para guardar cuando marcas un fijo como pagado.
 * Si el fijo es el pago de una deuda, el movimiento la abona: un solo registro, no dos.
 */
export function movimientoDeFijo(fijo, fecha) {
  return {
    fecha,
    monto: fijo.monto,
    tipo: TIPOS.GASTO,
    categoria: fijo.categoria,
    nota: fijo.nombre,
    fijoId: fijo.id,
    deudaId: fijo.deudaId || null,
  };
}
