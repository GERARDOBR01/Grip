// Aprendizaje — que no tengas que decirle dos veces lo mismo.
//
// Es la diferencia entre las apps que la gente abandona y las que no. La más respetada del
// mundo (YNAB) obliga a categorizar cada movimiento a mano, siempre, incluso los importados;
// hay quien la deja a las tres semanas por eso. Las buenas aprenden de tus correcciones.
//
// Aquí "aprender" no es nada misterioso ni hace falta que lo sea: si corriges OXXO a Súper,
// se guarda una regla, y el siguiente cargo de OXXO ya llega con Súper puesto. Determinista,
// inspeccionable y borrable — que es justo lo que se le pide a algo que toca tu dinero.
//
// Además, antes de que exista una sola regla, ya puede sugerir mirando lo que tú mismo
// capturaste a mano: si tus tres últimos cargos de OXXO fueron Súper, ese es el dato.

import { marcaDe } from "./lectura.js";
import { normalizarRegla } from "./modelo.js";
import { hoyISO } from "./ciclo.js";
import { veredicto, ESTADOS, SEVERIDADES } from "./veredicto.js";

/** Cuántos movimientos pasados hay que ver para sugerir sin una regla explícita. */
const MINIMO_PARA_DEDUCIR = 2;

/** La categoría que la persona usó más para este comercio, según su propio historial. */
export function categoriaMasUsada(datos, clave) {
  if (!clave) return null;
  const cuenta = new Map();
  for (const lista of Object.values(datos.movimientos || {})) {
    for (const m of lista) {
      if (!m.categoria || marcaDe(m.nota) !== clave) continue;
      cuenta.set(m.categoria, (cuenta.get(m.categoria) || 0) + 1);
    }
  }
  let mejor = null;
  for (const [categoria, veces] of cuenta) {
    if (!mejor || veces > mejor.veces) mejor = { categoria, veces };
  }
  return mejor && mejor.veces >= MINIMO_PARA_DEDUCIR ? mejor : null;
}

/**
 * Qué categoría le toca a este comercio. Devuelve `{ categoriaId, veredicto }` o null.
 * Primero lo que la persona dijo, después lo que la persona hizo. Nunca inventa.
 */
export function sugerirCategoria(datos, comercio) {
  const clave = marcaDe(comercio);
  if (!clave) return null;

  const regla = (datos.reglas || []).find((r) => r.clave === clave);
  if (regla) {
    return {
      categoriaId: regla.categoriaId,
      veredicto: veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK,
        `Ya me habías dicho que ${comercio} va aquí.`, { clave, veces: regla.veces, fuente: "regla" }),
    };
  }

  const deducida = categoriaMasUsada(datos, clave);
  if (deducida) {
    return {
      categoriaId: deducida.categoria,
      veredicto: veredicto(ESTADOS.AJUSTADO, SEVERIDADES.INFO,
        `Tus últimos ${deducida.veces} movimientos de ${comercio} fueron de esta categoría.`,
        { clave, veces: deducida.veces, fuente: "historial" }),
    };
  }

  return null;
}

/**
 * Guarda la corrección. Devuelve datos nuevos; no muta lo recibido.
 * Si la regla ya existía con otra categoría, gana la última: la persona cambió de opinión y
 * la app no está para discutir con ella.
 */
export function recordar(datos, comercio, categoriaId, iso = hoyISO()) {
  const clave = marcaDe(comercio);
  if (!clave || !categoriaId) return datos;

  const previas = datos.reglas || [];
  const anterior = previas.find((r) => r.clave === clave);
  const nueva = normalizarRegla({
    clave,
    categoriaId,
    veces: anterior && anterior.categoriaId === categoriaId ? anterior.veces + 1 : 1,
    ultima: iso,
  });

  return { ...datos, reglas: [nueva, ...previas.filter((r) => r.clave !== clave)] };
}

/** Borrar una regla tiene que ser tan fácil como crearla. */
export function olvidar(datos, clave) {
  return { ...datos, reglas: (datos.reglas || []).filter((r) => r.clave !== clave) };
}

/** Lo aprendido, para poder mirarlo y corregirlo en Ajustes. */
export function reglasAprendidas(datos) {
  return [...(datos.reglas || [])].sort((a, b) => b.veces - a.veces || (a.clave < b.clave ? -1 : 1));
}
