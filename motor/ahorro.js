// Ahorro — las tres cifras del panel: qué queda, cuánto por día, y cuánto puedes apartar.
//
// Separación deliberada entre HECHO y PROYECCIÓN:
//   · "disponible" es un hecho: ingresos − fijos del ciclo − lo que ya gastaste.
//   · "capacidad de ahorro" es una proyección, y necesita ritmo. Con menos de 3 días
//     corridos del ciclo el ritmo diario es ruido (una despensa el día 1 proyectaría un mes
//     catastrófico), así que se declara SIN_DATOS_SUFICIENTES en vez de asustar con un
//     número inventado. El "disponible" se sigue mostrando: no se pierde nada.

import { prorratear, formatear } from "./dinero.js";
import { cicloDe, mesDe, vencimientoEnMes, entre } from "./ciclo.js";
import { TIPOS, movimientosEntre, suma } from "./modelo.js";
import { venceEnMes, montoMensualizado } from "./fijos.js";
import { ESTADOS, SEVERIDADES, veredicto, sinDatos } from "./veredicto.js";

/** Días corridos del ciclo antes de aceptar proyectar un ritmo de gasto. */
export const DIAS_MINIMOS_RITMO = 3;

/** Ingresos del ciclo: lo capturado manda; si no hay nada, el ingreso del perfil, declarado. */
export function ingresosDelCiclo(datos, ciclo) {
  const capturado = suma(movimientosEntre(datos, ciclo.inicio, ciclo.fin), (m) => m.tipo === TIPOS.INGRESO);
  if (capturado > 0) return { monto: capturado, origen: "capturado" };

  const esperado = datos.perfil.ingresoQuincenal;
  if (esperado === null) {
    return {
      monto: null,
      origen: "ninguno",
      veredicto: sinDatos(
        "no hay ingreso registrado en este ciclo ni ingreso quincenal en tu perfil",
        "registra tu ingreso quincenal en Ajustes, o captura el depósito como movimiento",
      ),
    };
  }
  return { monto: esperado, origen: "perfil" };
}

/** Los fijos activos que vencen dentro del ciclo, con lo que ya se pagó y lo que falta. */
export function fijosDelCiclo(datos, ciclo) {
  const mes = mesDe(ciclo.inicio);
  const movimientos = movimientosEntre(datos, ciclo.inicio, ciclo.fin);
  const pagados = new Set(movimientos.filter((m) => m.fijoId).map((m) => m.fijoId));

  const enCiclo = datos.fijos
    .filter((f) => f.activo && venceEnMes(f, mes))
    .map((f) => ({ fijo: f, fecha: vencimientoEnMes(mes, f.diaCorte) }))
    .filter((v) => entre(v.fecha, ciclo.inicio, ciclo.fin));

  let pendiente = 0;
  let pagado = 0;
  const desconocidos = [];

  for (const v of enCiclo) {
    if (v.fijo.monto === null) {
      desconocidos.push(v.fijo.nombre);
      continue;
    }
    if (pagados.has(v.fijo.id)) pagado += v.fijo.monto;
    else pendiente += v.fijo.monto;
  }

  return { lista: enCiclo, pendiente, pagado, total: pendiente + pagado, desconocidos };
}

/** Gasto del ciclo, separando lo que ya estaba comprometido (fijos) de lo variable. */
export function gastoDelCiclo(datos, ciclo) {
  const movimientos = movimientosEntre(datos, ciclo.inicio, ciclo.fin);
  const gastos = movimientos.filter((m) => m.tipo === TIPOS.GASTO);
  const fijo = suma(gastos, (m) => Boolean(m.fijoId));
  const variable = suma(gastos, (m) => !m.fijoId);
  const ahorrado = suma(movimientos, (m) => m.tipo === TIPOS.AHORRO);
  const retirado = suma(movimientos, (m) => m.tipo === TIPOS.RETIRO);
  return { total: fijo + variable, fijo, variable, ahorrado, retirado, movimientos: gastos.length };
}

/**
 * El panel de "Hoy": todo lo que hace falta para decidir si hoy puedes gastar.
 * Devuelve siempre la misma forma; los huecos vienen como veredicto, no como cero.
 */
export function panelHoy(datos, iso) {
  const ciclo = cicloDe(iso, datos.perfil.cortes);
  const ingresos = ingresosDelCiclo(datos, ciclo);
  const fijos = fijosDelCiclo(datos, ciclo);
  const gasto = gastoDelCiclo(datos, ciclo);

  if (ingresos.monto === null) {
    return {
      ciclo,
      ingresos,
      fijos,
      gasto,
      disponible: null,
      porDia: null,
      capacidad: { monto: null, veredicto: ingresos.veredicto },
      veredicto: ingresos.veredicto,
    };
  }

  // Hecho: lo que queda del ciclo, ya descontando los fijos que todavía no se cobran.
  const disponible = ingresos.monto - gasto.total - (gasto.ahorrado - gasto.retirado) - fijos.pendiente;
  const porDia = ciclo.diasRestantes > 0 ? Math.trunc(disponible / ciclo.diasRestantes) : disponible;

  // Proyección: a este ritmo de gasto variable, ¿con cuánto cierro el ciclo?
  let capacidad;
  if (gasto.variable === 0 && ciclo.diasTranscurridos < DIAS_MINIMOS_RITMO) {
    capacidad = {
      monto: null,
      veredicto: sinDatos(
        `van ${ciclo.diasTranscurridos} de ${ciclo.dias} días del ciclo y no hay gastos capturados`,
        `captura tus gastos ${DIAS_MINIMOS_RITMO} días seguidos y aquí aparece tu capacidad real de ahorro`,
      ),
    };
  } else if (ciclo.diasTranscurridos < DIAS_MINIMOS_RITMO) {
    capacidad = {
      monto: null,
      veredicto: sinDatos(
        `solo ${ciclo.diasTranscurridos} día(s) de ritmo — muy poco para proyectar el ciclo`,
        `espera al día ${DIAS_MINIMOS_RITMO} del ciclo`,
      ),
    };
  } else {
    const ritmoDiario = Math.trunc(gasto.variable / ciclo.diasTranscurridos);
    const proyectadoRestante = ritmoDiario * Math.max(ciclo.diasRestantes - 1, 0);
    const monto = disponible - proyectadoRestante;
    capacidad = {
      monto,
      ritmoDiario,
      proyectadoRestante,
      veredicto:
        monto > 0
          ? veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK, `a tu ritmo actual cierras el ciclo con esto a favor`, {
              monto,
              ritmoDiario,
            })
          : veredicto(ESTADOS.NO_ALCANZA, SEVERIDADES.ALTA, `a tu ritmo actual el ciclo cierra en números rojos`, {
              monto,
              ritmoDiario,
            }),
    };
  }

  const general =
    disponible < 0
      ? veredicto(ESTADOS.NO_ALCANZA, SEVERIDADES.ALTA, "el ciclo ya está sobregirado", { disponible })
      : porDia !== null && ciclo.diasRestantes > 0 && disponible < ciclo.diasRestantes * 5000
        ? veredicto(ESTADOS.AJUSTADO, SEVERIDADES.MEDIA, "queda poco para los días que faltan", { disponible, porDia })
        : veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK, "el ciclo va con holgura", { disponible, porDia });

  return { ciclo, ingresos, fijos, gasto, disponible, porDia, capacidad, veredicto: general };
}

/**
 * Capacidad de ahorro POR CICLO para planear metas: lo estructural, sin el ruido del día.
 * ingreso − fijos del mes prorrateados al ciclo − topes variables prorrateados al ciclo.
 * Si faltan topes, se dice cuáles: el número sale, pero con su asterisco explícito.
 */
export function capacidadPorCiclo(datos, iso, topesDelMes) {
  const ciclo = cicloDe(iso, datos.perfil.cortes);
  const ingreso = datos.perfil.ingresoQuincenal;
  if (ingreso === null) {
    return {
      monto: null,
      veredicto: sinDatos("falta tu ingreso quincenal", "captúralo en Ajustes para poder planear metas"),
    };
  }

  const ciclosPorMes = (datos.perfil.cortes || []).length + 1;
  // El promedio mensual, no lo que toca este mes: un seguro anual hay que irlo apartando.
  const fijosMes = datos.fijos.filter((f) => f.activo && f.monto !== null).reduce((t, f) => t + montoMensualizado(f), 0);
  const fijosCiclo = prorratear(fijosMes, 1, ciclosPorMes);
  const variableCiclo = prorratear(topesDelMes.total, 1, ciclosPorMes);
  const monto = ingreso - fijosCiclo - variableCiclo;

  const nota = topesDelMes.completo
    ? veredicto(
        monto > 0 ? ESTADOS.VA_BIEN : ESTADOS.NO_ALCANZA,
        monto > 0 ? SEVERIDADES.OK : SEVERIDADES.ALTA,
        `ingreso ${formatear(ingreso)} − fijos ${formatear(fijosCiclo)} − presupuesto variable ${formatear(variableCiclo)}`,
        { ingreso, fijosCiclo, variableCiclo },
      )
    : veredicto(
        ESTADOS.AJUSTADO,
        SEVERIDADES.INFO,
        `${topesDelMes.sinTope.length} categoría(s) sin tope no entran en esta cuenta`,
        { ingreso, fijosCiclo, variableCiclo, sinTope: topesDelMes.sinTope },
      );

  return { monto, ingreso, fijosCiclo, variableCiclo, ciclo, veredicto: nota };
}

/**
 * Lo apartado históricamente, menos lo retirado.
 * Con `metaId` cuenta solo esa meta; con `soloLibre` cuenta solo lo que NO está
 * comprometido con ninguna meta — eso es el fondo de emergencia.
 */
export function ahorroAcumulado(datos, metaId = null, soloLibre = false) {
  let total = 0;
  for (const lista of Object.values(datos.movimientos)) {
    for (const m of lista) {
      if (m.tipo !== TIPOS.AHORRO && m.tipo !== TIPOS.RETIRO) continue;
      if (metaId && m.metaId !== metaId) continue;
      if (soloLibre && m.metaId) continue;
      total += m.tipo === TIPOS.AHORRO ? m.monto : -m.monto;
    }
  }
  return total;
}

/** El fondo de emergencia: lo apartado sin comprometer con ninguna meta. */
export function ahorroLibre(datos) {
  return ahorroAcumulado(datos, null, true);
}

/**
 * El fondo de emergencia contra su objetivo.
 * Sin objetivo definido no hay veredicto: se dice qué falta y cuánto suelen ser 3 meses
 * de tus fijos, que sí es un número tuyo y no una regla inventada.
 */
export function estadoColchon(datos) {
  const acumulado = ahorroLibre(datos);
  const objetivo = datos.perfil.colchonObjetivo;

  if (objetivo === null) {
    return {
      acumulado,
      objetivo: null,
      veredicto: sinDatos(
        "no has definido cuánto quieres tener de fondo de emergencia",
        "defínelo en Ajustes para saber si vas bien",
      ),
    };
  }

  const falta = Math.max(objetivo - acumulado, 0);
  if (falta === 0) {
    return {
      acumulado,
      objetivo,
      falta: 0,
      veredicto: veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK, "fondo completo", { acumulado, objetivo }),
    };
  }

  const pct = Math.round((acumulado * 100) / objetivo);
  return {
    acumulado,
    objetivo,
    falta,
    veredicto: veredicto(
      ESTADOS.AJUSTADO,
      pct >= 50 ? SEVERIDADES.MEDIA : SEVERIDADES.ALTA,
      `llevas ${pct}% del fondo — faltan ${formatear(falta)}`,
      { acumulado, objetivo, falta, pct },
    ),
  };
}
