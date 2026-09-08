// Veredictos — la forma común de toda respuesta del motor.
//
// Ningún cálculo devuelve un número pelón. Devuelve el número Y de dónde salió, para que
// la pantalla nunca tenga que adivinar si un cero es "gastaste cero" o "no sé todavía".
// Es la misma columna vertebral de Veristack: estado, severidad, motivo y fuente.

export const ESTADOS = {
  VA_BIEN: "VA_BIEN",
  AJUSTADO: "AJUSTADO",
  NO_ALCANZA: "NO_ALCANZA",
  SIN_TOPE: "SIN_TOPE",
  SIN_DATOS: "SIN_DATOS_SUFICIENTES",
};

export const SEVERIDADES = {
  OK: "OK",
  INFO: "INFO",
  MEDIA: "MEDIA",
  ALTA: "ALTA",
};

/** Toda salida del motor pasa por aquí. `fuente` siempre es CODIGO: aquí no interpreta nadie. */
export function veredicto(estado, severidad, motivo, datos = {}) {
  return { estado, severidad, motivo, fuente: "CODIGO", datos };
}

/**
 * La respuesta honesta cuando falta información.
 * `falta` es accionable a propósito: dice qué capturar para que el número exista.
 */
export function sinDatos(motivo, falta) {
  return veredicto(ESTADOS.SIN_DATOS, SEVERIDADES.INFO, motivo, { falta });
}

export function esSinDatos(v) {
  return Boolean(v) && v.estado === ESTADOS.SIN_DATOS;
}

/** Texto de una línea, como se lee en la interfaz y en las pruebas. */
export function comoTexto(v) {
  if (!v) return "";
  return `${v.estado} — ${v.motivo} — fuente: ${v.fuente}`;
}
