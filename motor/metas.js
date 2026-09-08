// Metas — cuánto hay que apartar por quincena, y si eso cabe en la realidad.
//
// Aquí es donde la app se gana su lugar: una meta no es un deseo con una barrita de
// progreso, es una división. Falta X, quedan N quincenas, entonces son X/N por quincena.
// Y ese número se contrasta contra la capacidad real de ahorro.
//
// Si no cabe, lo dice: NO_ALCANZA, con los dos números a la vista y la alternativa
// calculada (la fecha que sí es posible, o la aportación que sí cabe). Una meta que se
// pinta de verde cuando no cierra es peor que no tener meta.

import { formatear } from "./dinero.js";
import { ciclosHasta, cicloDe, sumarDias } from "./ciclo.js";
import { ahorroAcumulado } from "./ahorro.js";
import { ESTADOS, SEVERIDADES, veredicto, sinDatos } from "./veredicto.js";

/** Con menos de este colchón sobre lo requerido, la meta va apretada. */
export const HOLGURA_COMODA = 0.8;

/** Lo apartado para una meta: sus movimientos de tipo ahorro. */
export function ahorradoDeMeta(datos, metaId) {
  return ahorroAcumulado(datos, metaId);
}

/**
 * El plan de una meta a una fecha dada.
 * `capacidad` es la capacidad de ahorro por ciclo (o null si todavía no se puede saber).
 */
export function planDeMeta(datos, meta, iso, capacidad = null) {
  const ahorrado = ahorradoDeMeta(datos, meta.id);
  const base = { meta, ahorrado, objetivo: meta.objetivo, falta: null, ciclos: null, requerido: null };

  if (meta.objetivo === null) {
    return {
      ...base,
      veredicto: sinDatos("la meta no tiene monto objetivo", `defínele un monto a "${meta.nombre}"`),
    };
  }

  const falta = Math.max(meta.objetivo - ahorrado, 0);
  if (falta === 0 || meta.lograda) {
    return {
      ...base,
      falta: 0,
      veredicto: veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK, "meta cumplida", { ahorrado, objetivo: meta.objetivo }),
    };
  }

  if (!meta.fechaLimite) {
    return {
      ...base,
      falta,
      veredicto: sinDatos(
        "la meta no tiene fecha límite — sin fecha no hay cuánto por quincena",
        `ponle fecha a "${meta.nombre}"`,
      ),
    };
  }

  const ciclos = ciclosHasta(iso, meta.fechaLimite, datos.perfil.cortes);
  if (ciclos === 0) {
    return {
      ...base,
      falta,
      ciclos: 0,
      veredicto: veredicto(
        ESTADOS.NO_ALCANZA,
        SEVERIDADES.ALTA,
        `la fecha límite ya pasó o no queda ninguna quincena completa, y faltan ${formatear(falta)}`,
        { falta, fechaLimite: meta.fechaLimite },
      ),
    };
  }

  const requerido = Math.ceil(falta / ciclos);
  const conAlternativa = { ...base, falta, ciclos, requerido };

  if (capacidad === null) {
    return {
      ...conAlternativa,
      veredicto: sinDatos(
        `requiere ${formatear(requerido)} por quincena — falta saber tu capacidad de ahorro para decir si cabe`,
        "captura tu ingreso quincenal y los topes de tus categorías",
      ),
    };
  }

  if (capacidad <= 0) {
    return {
      ...conAlternativa,
      veredicto: veredicto(
        ESTADOS.NO_ALCANZA,
        SEVERIDADES.ALTA,
        `requiere ${formatear(requerido)} por quincena y hoy tu capacidad de ahorro es ${formatear(capacidad)}`,
        { requerido, capacidad, alternativa: { tipo: "sin-capacidad" } },
      ),
    };
  }

  if (requerido > capacidad) {
    const ciclosNecesarios = Math.ceil(falta / capacidad);
    const fechaRealista = fechaTrasCiclos(iso, ciclosNecesarios, datos.perfil.cortes);
    return {
      ...conAlternativa,
      veredicto: veredicto(
        ESTADOS.NO_ALCANZA,
        SEVERIDADES.ALTA,
        `requiere ${formatear(requerido)} por quincena, capacidad estimada ${formatear(capacidad)}`,
        {
          requerido,
          capacidad,
          alternativa: {
            tipo: "mover-fecha",
            aportacionPosible: capacidad,
            ciclosNecesarios,
            fechaRealista,
          },
        },
      ),
    };
  }

  const estado = requerido <= capacidad * HOLGURA_COMODA ? ESTADOS.VA_BIEN : ESTADOS.AJUSTADO;
  return {
    ...conAlternativa,
    veredicto: veredicto(
      estado,
      estado === ESTADOS.VA_BIEN ? SEVERIDADES.OK : SEVERIDADES.MEDIA,
      `requiere ${formatear(requerido)} por quincena, capacidad estimada ${formatear(capacidad)}`,
      { requerido, capacidad, ciclos },
    ),
  };
}

/** La fecha en la que cierra el ciclo número N contando desde hoy. */
export function fechaTrasCiclos(iso, ciclos, cortes = [15]) {
  let ciclo = cicloDe(iso, cortes);
  for (let i = 1; i < ciclos && i < 2000; i++) {
    ciclo = cicloDe(sumarDias(ciclo.fin, 1), cortes);
  }
  return ciclo.fin;
}

/** Todas las metas, las que aprietan primero. */
export function resumenMetas(datos, iso, capacidad = null) {
  const orden = { [ESTADOS.NO_ALCANZA]: 0, [ESTADOS.AJUSTADO]: 1, [ESTADOS.SIN_DATOS]: 2, [ESTADOS.VA_BIEN]: 3 };
  return datos.metas
    .map((meta) => planDeMeta(datos, meta, iso, capacidad))
    .sort((a, b) => (orden[a.veredicto.estado] ?? 9) - (orden[b.veredicto.estado] ?? 9));
}

/** Lo que exigen TODAS las metas juntas por quincena, contra la capacidad. */
export function exigenciaTotal(planes, capacidad = null) {
  const requerido = planes.reduce((t, p) => t + (p.requerido || 0), 0);
  if (capacidad === null) {
    return { requerido, veredicto: sinDatos("falta tu capacidad de ahorro", "captura tu ingreso quincenal") };
  }
  if (requerido > capacidad) {
    return {
      requerido,
      capacidad,
      veredicto: veredicto(
        ESTADOS.NO_ALCANZA,
        SEVERIDADES.ALTA,
        `tus metas juntas piden ${formatear(requerido)} por quincena y tu capacidad es ${formatear(capacidad)}`,
        { requerido, capacidad },
      ),
    };
  }
  return {
    requerido,
    capacidad,
    veredicto: veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK, `tus metas caben en tu capacidad`, { requerido, capacidad }),
  };
}
