// Presupuesto — cuánto va gastado contra cuánto se puso de tope, por categoría.
//
// El tope es MENSUAL y se compara contra el mes natural, aunque el dinero se mueva por
// quincenas: es como se piensa un presupuesto ("2,000 de súper al mes"), y mezclarlo con
// el ciclo de pago haría que el mismo gasto se viera distinto según el día.
//
// Una categoría sin tope NO se pinta de verde. Se marca SIN_TOPE: no hay nada contra qué
// comparar, y decir "vas bien" sin una referencia sería inventarse el veredicto.

import { porcentaje } from "./dinero.js";
import { mesDe } from "./ciclo.js";
import { TIPOS, movimientosEntre, categoriaPorId } from "./modelo.js";
import { ESTADOS, SEVERIDADES, veredicto } from "./veredicto.js";

/** Umbrales del semáforo, en un solo lugar. */
export const UMBRAL_AMBAR = 80;

/** El tope que aplica a una categoría en un mes: el del mes si se fijó, si no el del catálogo. */
export function topeVigente(datos, mes, categoriaId) {
  const delMes = datos.presupuestos[mes];
  if (delMes && Number.isFinite(delMes[categoriaId])) return delMes[categoriaId];
  const categoria = categoriaPorId(datos, categoriaId);
  return categoria && Number.isFinite(categoria.tope) ? categoria.tope : null;
}

/** Gasto acumulado por categoría en un rango de fechas. */
export function gastoPorCategoria(datos, desde, hasta) {
  const acumulado = {};
  for (const m of movimientosEntre(datos, desde, hasta)) {
    if (m.tipo !== TIPOS.GASTO) continue;
    const id = m.categoria || "otros";
    acumulado[id] = (acumulado[id] || 0) + m.monto;
  }
  return acumulado;
}

/** El veredicto de una categoría: el semáforo, con su motivo y sus dos números. */
export function veredictoCategoria(gastado, tope) {
  if (tope === null) {
    return veredicto(ESTADOS.SIN_TOPE, SEVERIDADES.INFO, "sin tope definido — no hay contra qué comparar", {
      gastado,
      tope: null,
    });
  }

  const pct = porcentaje(gastado, tope);
  const restante = tope - gastado;

  if (gastado > tope) {
    return veredicto(ESTADOS.NO_ALCANZA, SEVERIDADES.ALTA, `pasado por ${pct - 100}% del tope`, {
      gastado,
      tope,
      pct,
      restante,
    });
  }
  if (pct >= UMBRAL_AMBAR) {
    return veredicto(ESTADOS.AJUSTADO, SEVERIDADES.MEDIA, `${pct}% del tope usado`, { gastado, tope, pct, restante });
  }
  return veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK, `${pct}% del tope usado`, { gastado, tope, pct, restante });
}

/** El presupuesto completo del mes de una fecha, ordenado por lo más apretado primero. */
export function resumenPresupuesto(datos, iso) {
  const mes = mesDe(iso);
  const desde = `${mes}-01`;
  const hasta = `${mes}-31`;
  const gastos = gastoPorCategoria(datos, desde, hasta);

  const orden = { [ESTADOS.NO_ALCANZA]: 0, [ESTADOS.AJUSTADO]: 1, [ESTADOS.VA_BIEN]: 2, [ESTADOS.SIN_TOPE]: 3 };

  return datos.categorias
    .filter((c) => !c.archivada)
    .map((categoria) => {
      const gastado = gastos[categoria.id] || 0;
      const tope = topeVigente(datos, mes, categoria.id);
      return { categoria, gastado, tope, veredicto: veredictoCategoria(gastado, tope) };
    })
    .filter((fila) => fila.gastado > 0 || fila.tope !== null)
    .sort((a, b) => orden[a.veredicto.estado] - orden[b.veredicto.estado] || b.gastado - a.gastado);
}

/**
 * Suma de los topes de las categorías variables del mes.
 * Devuelve también cuáles no tienen tope: quien lea el total sabe qué NO está contando.
 */
export function topesVariables(datos, mes) {
  let total = 0;
  const sinTope = [];
  for (const categoria of datos.categorias) {
    if (categoria.archivada || categoria.clase !== "variable") continue;
    const tope = topeVigente(datos, mes, categoria.id);
    if (tope === null) sinTope.push(categoria.id);
    else total += tope;
  }
  return { total, sinTope, completo: sinTope.length === 0 };
}
