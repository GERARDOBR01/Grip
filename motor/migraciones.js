// Migraciones — por qué esta app puede durar años.
//
// El documento guardado lleva su `version`. Al abrir, se sube hasta la versión actual
// aplicando en orden las migraciones que le falten. Así, cambiar la forma de los datos
// mañana no obliga a tirar la historia de hoy.
//
// El caso contrario también está cubierto y es el importante: si el documento viene de una
// versión MÁS NUEVA que este código (abrió la app en la PC, la actualizó, y hoy entra
// desde un celular con la versión vieja), no se toca nada. Se declara y se detiene. Un
// "downgrade" silencioso es la forma más rápida de perder datos para siempre.

import { VERSION_DATOS, normalizar } from "./modelo.js";

/** MIGRACIONES[n] convierte un documento de la versión n a la versión n+1. */
export const MIGRACIONES = {
  // v1 → v2: aparecen la bandeja de entrada (lo que llega solo y espera confirmación) y las
  // reglas aprendidas. Un documento de v1 no tenía ninguna de las dos, y no tenerlas es un
  // estado válido: se crean vacías. Ni un movimiento suyo se toca.
  1: (datos) => ({
    ...datos,
    bandeja: Array.isArray(datos.bandeja) ? datos.bandeja : [],
    reglas: Array.isArray(datos.reglas) ? datos.reglas : [],
  }),

  // v2 → v3: aparecen las lápidas, que son lo que permite fusionar dos dispositivos sin
  // resucitar lo borrado. Un documento de v2 no tenía ninguna y esa lista nace vacía: no
  // sabemos qué se borró antes, y suponerlo sería peor que no saberlo.
  2: (datos) => ({
    ...datos,
    borrados: Array.isArray(datos.borrados) ? datos.borrados : [],
  }),
};

export function migrar(entrada) {
  const datos = entrada && typeof entrada === "object" ? { ...entrada } : null;
  if (!datos) return { ok: false, motivo: "El respaldo no es un documento válido.", datos: null };

  const version = Number.isInteger(datos.version) ? datos.version : 1;

  if (version > VERSION_DATOS) {
    return {
      ok: false,
      motivo:
        `Estos datos son de una versión más nueva (v${version}) que esta copia de la app ` +
        `(v${VERSION_DATOS}). No se abren aquí para no perder lo que la versión nueva guardó: ` +
        `actualiza la app y vuelve a intentarlo.`,
      datos: null,
      aplicadas: [],
    };
  }

  let actual = datos;
  const aplicadas = [];
  for (let v = version; v < VERSION_DATOS; v++) {
    const paso = MIGRACIONES[v];
    if (typeof paso !== "function") {
      return { ok: false, motivo: `Falta la migración de la versión ${v} a la ${v + 1}.`, datos: null, aplicadas };
    }
    actual = paso(actual);
    actual.version = v + 1;
    aplicadas.push(`v${v}→v${v + 1}`);
  }

  return { ok: true, motivo: aplicadas.length ? `Datos actualizados: ${aplicadas.join(", ")}.` : "", datos: normalizar(actual), aplicadas };
}
