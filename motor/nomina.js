// El recibo de nómina — el dato exacto, sin teclear y sin adivinar.
//
// El ingreso es el número del que cuelgan todos los demás: sin él, el disponible es "—" y la
// app no puede contestar nada. Y hasta hoy se tecleaba a mano, "más o menos lo que gano",
// que es justo la clase de dato que envejece mal y desalinea todo lo que toca.
//
// En México el recibo de nómina no es un papel: es un CFDI que tu patrón está OBLIGADO a
// timbrar cada vez que te paga, y que puedes bajar tú mismo de sat.gob.mx hasta cinco años
// atrás. Trae el neto exacto, y de regalo las fechas del periodo pagado — con eso la app
// configura sola tu quincena, que es de lo poco que todavía se tecleaba.
//
// ── Por qué esto NO usa un parser de XML ──
//
// Todo lo que hace falta son atributos de dos elementos. Leerlos así deja este archivo en el
// motor: sin DOM, sin navegador, y con pruebas que corren en cualquier lado — que es la regla
// de la casa. Un DOMParser habría obligado a sacarlo a la interfaz y a probarlo a ciegas.
//
// El prefijo del espacio de nombres se busca flojo (`cfdi:` y `nomina12:` son la costumbre,
// no una obligación del estándar), pero el nombre del elemento se exige exacto.

import { aCentavos } from "./dinero.js";
import { partes, diasEnMes, esISO } from "./ciclo.js";
import { veredicto, ESTADOS, SEVERIDADES } from "./veredicto.js";

/** La etiqueta de apertura de un elemento, sin importar con qué prefijo venga. */
function etiqueta(xml, nombre) {
  const patron = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${nombre}\\b[^>]*>`, "i");
  const encontrada = xml.match(patron);
  return encontrada ? encontrada[0] : "";
}

/** Un atributo de esa etiqueta, o "" si no viene. */
function atributo(etiquetaTexto, nombre) {
  const encontrado = etiquetaTexto.match(new RegExp(`\\b${nombre}\\s*=\\s*"([^"]*)"`, "i"));
  return encontrado ? encontrado[1] : "";
}

function centavosDe(texto) {
  const valor = aCentavos(texto);
  return valor === null ? null : Math.abs(valor);
}

/** El CFDI trae la fecha como "2026-09-15" o "2026-09-15T08:00:55". Nos quedamos con el día. */
function soloFecha(texto) {
  const dia = String(texto || "").slice(0, 10);
  return esISO(dia) ? dia : "";
}

/**
 * Lee un CFDI de nómina. Devuelve `{ nomina, veredicto }`; `nomina` es null si no se pudo.
 *
 * NUNCA lanza: un archivo que no es lo que dice ser tiene que dar una respuesta, no un error
 * en la consola que nadie ve.
 */
export function leerNomina(xml) {
  const texto = String(xml || "");

  const comprobante = etiqueta(texto, "Comprobante");
  const nomina = etiqueta(texto, "Nomina");

  if (!comprobante || !nomina) {
    return {
      nomina: null,
      veredicto: veredicto(ESTADOS.SIN_DATOS_SUFICIENTES, SEVERIDADES.INFO,
        "Esto no parece un recibo de nómina del SAT.",
        { falta: "el XML del CFDI, no el PDF" }),
    };
  }

  // El neto es el `Total` del comprobante: percepciones más otros pagos, menos deducciones.
  // Es lo que de verdad te depositan, y por eso es el que manda.
  const neto = centavosDe(atributo(comprobante, "Total"));
  const percepciones = centavosDe(atributo(nomina, "TotalPercepciones"));
  const deducciones = centavosDe(atributo(nomina, "TotalDeducciones"));
  const otrosPagos = centavosDe(atributo(nomina, "TotalOtrosPagos"));

  if (neto === null || neto === 0) {
    return {
      nomina: null,
      veredicto: veredicto(ESTADOS.SIN_DATOS_SUFICIENTES, SEVERIDADES.INFO,
        "El recibo no trae el total que te pagaron.", { falta: "cuánto" }),
    };
  }

  const inicio = soloFecha(atributo(nomina, "FechaInicialPago"));
  const fin = soloFecha(atributo(nomina, "FechaFinalPago"));
  const dias = Number(atributo(nomina, "NumDiasPagados")) || null;

  // Extraordinaria es aguinaldo, PTU, finiquito: dinero de verdad, pero no es tu quincena.
  // Tomarlo como ingreso recurrente inflaría el disponible de todo un ciclo.
  const tipo = (atributo(nomina, "TipoNomina") || "O").toUpperCase();
  const ordinaria = tipo === "O";

  return {
    nomina: {
      neto,
      percepciones,
      deducciones,
      otrosPagos: otrosPagos === null ? 0 : otrosPagos,
      fechaPago: soloFecha(atributo(nomina, "FechaPago")) || fin,
      inicio,
      fin,
      dias,
      tipo,
      ordinaria,
    },
    veredicto: veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK,
      ordinaria
        ? "Recibo leído: el neto sale del comprobante, no de una estimación."
        : "Recibo leído, pero es una nómina extraordinaria (aguinaldo, PTU o finiquito): no es tu ingreso de cada quincena.",
      { fuente: "CFDI", tipo }),
  };
}

/**
 * El día de corte que se deduce del periodo pagado, o null si no se deduce limpio.
 *
 * Un periodo del 1 al 15 dice, sin ambigüedad, que tu quincena corta el 15. Uno del 9 al 24 no
 * dice nada que esta app pueda usar: sus ciclos viven dentro del mes. Y un periodo que termina
 * el último día del mes tampoco aporta, porque el fin de mes ya es frontera siempre.
 *
 * Devolver null es la respuesta correcta en esos casos, no un fallo: se pregunta en vez de
 * inventar un corte que desalinearía todos los ciclos.
 */
export function corteDeNomina(nomina) {
  if (!nomina || !esISO(nomina.inicio) || !esISO(nomina.fin)) return null;

  const desde = partes(nomina.inicio);
  const hasta = partes(nomina.fin);
  if (desde.anio !== hasta.anio || desde.mes !== hasta.mes) return null;
  if (hasta.dia >= diasEnMes(hasta.anio, hasta.mes)) return null;

  return hasta.dia;
}
