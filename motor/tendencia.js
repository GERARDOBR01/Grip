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

// ── Contra la quincena pasada ──────────────────────────────────────────────
//
// La gráfica de arriba contesta "¿voy mejorando?". Ésta contesta la pregunta de todos los días:
// "¿en qué estoy gastando más que la vez pasada?". Y la compara a la MISMA ALTURA: el día 4 de
// esta quincena contra los primeros 4 días de la anterior. Comparar cuatro días contra quince
// cerrados haría ver un ahorro donde solo hay días que todavía no pasan — la misma trampa que
// la tendencia evita marcando el ciclo en curso como incompleto.

/** Cuánto llevas gastado por categoría contra lo que llevabas a estas alturas del ciclo anterior. */
export function contraElCicloAnterior(datos, iso = hoyISO()) {
  const cortes = datos.perfil.cortes;
  const actual = cicloDe(iso, cortes);
  const anterior = cicloDe(sumarDias(actual.inicio, -1), cortes);
  const dias = Math.min(actual.diasTranscurridos, anterior.dias);
  const hastaAnterior = sumarDias(anterior.inicio, dias - 1);

  const vacio = { actual, anterior, dias, hastaAnterior, filas: [], totalAhora: 0, totalAntes: 0, diferencia: 0 };
  if (!movimientosEntre(datos, anterior.inicio, anterior.fin).length) {
    return {
      ...vacio,
      veredicto: sinDatos(
        "La quincena pasada no tiene nada capturado, así que no hay contra qué comparar.",
        "sigue capturando: a la siguiente quincena ya sale",
      ),
    };
  }

  const porCategoria = (desde, hasta) => {
    const mapa = new Map();
    for (const m of movimientosEntre(datos, desde, hasta)) {
      if (m.tipo !== TIPOS.GASTO) continue;
      const id = m.categoria || "otros";
      mapa.set(id, (mapa.get(id) || 0) + m.monto);
    }
    return mapa;
  };
  const ahora = porCategoria(actual.inicio, iso);
  const antes = porCategoria(anterior.inicio, hastaAnterior);

  const filas = [...new Set([...ahora.keys(), ...antes.keys()])]
    .map((categoriaId) => {
      const a = ahora.get(categoriaId) || 0;
      const b = antes.get(categoriaId) || 0;
      return { categoriaId, ahora: a, antes: b, diferencia: a - b };
    })
    .filter((f) => f.diferencia !== 0)
    .sort((x, y) => y.diferencia - x.diferencia || (x.categoriaId < y.categoriaId ? -1 : 1));

  const totalAhora = [...ahora.values()].reduce((t, v) => t + v, 0);
  const totalAntes = [...antes.values()].reduce((t, v) => t + v, 0);
  const diferencia = totalAhora - totalAntes;
  const subio = filas[0] && filas[0].diferencia > 0 ? filas[0] : null;
  const nombre = (id) => {
    const c = (datos.categorias || []).find((x) => x.id === id);
    return c ? c.nombre : id;
  };
  const enDias = `en ${dias} ${dias === 1 ? "día" : "días"}`;

  return {
    ...vacio,
    filas,
    totalAhora,
    totalAntes,
    diferencia,
    veredicto: diferencia > 0
      ? veredicto(ESTADOS.AJUSTADO, SEVERIDADES.MEDIA,
        `Llevas ${formatear(diferencia)} más que a estas alturas de la quincena pasada (${enDias})` +
          (subio ? `, sobre todo en ${nombre(subio.categoriaId)}.` : "."),
        { diferencia, dias, categoriaId: subio ? subio.categoriaId : null })
      : veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK,
        diferencia < 0
          ? `Llevas ${formatear(-diferencia)} menos que a estas alturas de la quincena pasada (${enDias}).`
          : `Vas exactamente igual que a estas alturas de la quincena pasada (${enDias}).`,
        { diferencia, dias }),
  };
}
