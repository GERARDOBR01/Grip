// Deudas — el saldo, y qué pasa si sigues pagando lo que pagas.
//
// La regla que manda: SIN TASA CAPTURADA NO SE PROYECTA NINGÚN INTERÉS. Inventar una tasa
// "típica de tarjeta" daría un número creíble y falso, que es el peor tipo de número aquí.
//
// Cuando la tasa SÍ está, se calcula lo que casi ninguna app dice en voz alta: cuántos meses
// faltan de verdad, cuánto de eso son intereses, y —lo más importante— si el pago mensual
// ni siquiera cubre el interés del mes, en cuyo caso la deuda NUNCA baja por más que pagues.
// Ese caso se declara NO_ALCANZA con todas sus letras.
//
// El supuesto va escrito en el propio veredicto: interés mensual sobre saldo insoluto,
// pagos puntuales, sin comisiones ni IVA. Es una proyección, y se dice que lo es.

import { formatear, plural } from "./dinero.js";
import { saldoDeuda } from "./fijos.js";
import { ESTADOS, SEVERIDADES, veredicto, sinDatos } from "./veredicto.js";

/** Tope de meses que se proyectan. Más allá de 50 años, el número deja de significar algo. */
const MESES_MAXIMOS = 600;

/** El pago mensual de una deuda: el del fijo que la paga, si hay uno ligado. */
export function pagoMensualDe(datos, deuda) {
  const fijo = datos.fijos.find((f) => f.activo && f.deudaId === deuda.id && f.monto !== null);
  if (fijo) return { monto: fijo.monto, origen: "fijo", nombre: fijo.nombre };
  return { monto: null, origen: "ninguno" };
}

/**
 * Qué pasa con esta deuda si todo sigue igual.
 * Devuelve siempre el saldo; la proyección solo cuando hay con qué calcularla.
 */
export function planDeDeuda(datos, deuda) {
  const base = saldoDeuda(datos, deuda);
  const pago = pagoMensualDe(datos, deuda);
  const salida = { ...base, pago, meses: null, intereses: null, interesDelMes: null };

  if (base.saldo === null) return salida; // sin monto original no hay nada que proyectar
  if (base.saldo === 0) {
    return { ...salida, meses: 0, intereses: 0, veredicto: veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK, "liquidada", { saldo: 0 }) };
  }

  if (deuda.tasaAnual === null) {
    return {
      ...salida,
      veredicto: sinDatos(
        `saldo ${formatear(base.saldo)} sin intereses — no hay tasa capturada, así que aquí no se proyecta ninguno`,
        "captura la tasa anual de la deuda para saber cuánto te está costando de verdad",
      ),
    };
  }

  if (pago.monto === null) {
    return {
      ...salida,
      veredicto: sinDatos(
        `saldo ${formatear(base.saldo)} con tasa ${deuda.tasaAnual}% anual — falta saber cuánto pagas al mes`,
        "liga un pago fijo a esta deuda para proyectar cuándo la liquidas",
      ),
    };
  }

  const tasaMensual = deuda.tasaAnual / 100 / 12;
  const interesDelMes = Math.round(base.saldo * tasaMensual);

  // El caso que hunde a la gente: si el pago no cubre ni el interés, el saldo sube cada mes.
  if (pago.monto <= interesDelMes) {
    return {
      ...salida,
      interesDelMes,
      veredicto: veredicto(
        ESTADOS.NO_ALCANZA,
        SEVERIDADES.ALTA,
        `pagando ${formatear(pago.monto)} al mes esta deuda NUNCA baja: solo el interés del mes es ${formatear(interesDelMes)}`,
        { saldo: base.saldo, pago: pago.monto, interesDelMes, tasaAnual: deuda.tasaAnual },
      ),
    };
  }

  // Mes a mes, sin fórmulas cerradas: es exacto en centavos y se lee igual que se calcula.
  let saldo = base.saldo;
  let intereses = 0;
  let meses = 0;
  while (saldo > 0 && meses < MESES_MAXIMOS) {
    const interes = Math.round(saldo * tasaMensual);
    intereses += interes;
    saldo = saldo + interes - pago.monto;
    meses += 1;
  }
  if (saldo < 0) intereses += saldo; // el último pago fue de más: no se cobra lo que no se debía

  const anios = Math.floor(meses / 12);
  const sobran = meses % 12;
  const cuando = anios
    ? `${plural(anios, "año", "años")}${sobran ? ` y ${plural(sobran, "mes", "meses")}` : ""}`
    : plural(meses, "mes", "meses");

  return {
    ...salida,
    meses,
    intereses,
    interesDelMes,
    veredicto: veredicto(
      intereses > base.saldo / 2 ? ESTADOS.AJUSTADO : ESTADOS.VA_BIEN,
      intereses > base.saldo / 2 ? SEVERIDADES.MEDIA : SEVERIDADES.OK,
      `pagando ${formatear(pago.monto)} al mes la liquidas en ${cuando} y pagas ${formatear(intereses)} de intereses ` +
        `(proyección: interés mensual sobre saldo, pagos puntuales, sin comisiones ni IVA)`,
      { saldo: base.saldo, pago: pago.monto, meses, intereses, tasaAnual: deuda.tasaAnual },
    ),
  };
}

/** Cuánto ahorrarías en intereses pagando algo más cada mes. La respuesta suele sorprender. */
export function siPagarasMas(datos, deuda, extra) {
  const actual = planDeDeuda(datos, deuda);
  if (actual.meses === null || !actual.pago.monto) return null;

  const conExtra = planDeDeuda(
    { ...datos, fijos: datos.fijos.map((f) => (f.deudaId === deuda.id ? { ...f, monto: f.monto + extra } : f)) },
    deuda,
  );
  if (conExtra.meses === null) return null;

  return {
    extra,
    mesesMenos: actual.meses - conExtra.meses,
    interesesMenos: actual.intereses - conExtra.intereses,
  };
}
