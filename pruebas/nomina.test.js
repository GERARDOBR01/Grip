// El recibo de nómina — el número del que cuelgan todos los demás.
//
// Sin ingreso, el disponible es "—" y la app no contesta nada. Hasta hoy ese número se
// tecleaba a mano; ahora sale del CFDI que tu patrón está obligado a timbrar. Lo que se cuida
// aquí es que salga EXACTO y que, cuando el recibo no permita deducir algo, la app lo diga en
// vez de inventarlo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { leerNomina, corteDeNomina } from "../motor/nomina.js";
import { ESTADOS } from "../motor/veredicto.js";

const CARPETA = join(dirname(fileURLToPath(import.meta.url)), "nominas");
const xml = (nombre) => readFileSync(join(CARPETA, nombre), "utf8");

test("el corpus no está vacío: si lo estuviera, estas pruebas pasarían sin probar nada", () => {
  const casos = readdirSync(CARPETA).filter((n) => n.endsWith(".xml"));
  assert.ok(casos.length >= 3, `solo ${casos.length} recibos en el corpus`);
});

test("una quincena ordinaria da el neto exacto, en centavos", () => {
  const { nomina, veredicto } = leerNomina(xml("quincena-ordinaria.xml"));

  assert.equal(nomina.neto, 800000, "el Total del comprobante es lo que te depositan");
  assert.equal(nomina.percepciones, 980000);
  assert.equal(nomina.deducciones, 180000);
  assert.equal(veredicto.estado, ESTADOS.VA_BIEN);
});

test("y las fechas del periodo, que es lo que configura la quincena sola", () => {
  const { nomina } = leerNomina(xml("quincena-ordinaria.xml"));

  assert.equal(nomina.inicio, "2026-09-01");
  assert.equal(nomina.fin, "2026-09-15");
  assert.equal(nomina.dias, 15);
  assert.equal(corteDeNomina(nomina), 15, "del 1 al 15 dice, sin ambigüedad, que cortas el 15");
});

test("el aguinaldo NO se toma como tu ingreso de cada quincena", () => {
  const { nomina, veredicto } = leerNomina(xml("aguinaldo-extraordinaria.xml"));

  assert.equal(nomina.tipo, "E");
  assert.equal(nomina.ordinaria, false, "tomarlo como recurrente inflaría un ciclo entero");
  assert.match(veredicto.motivo, /extraordinaria/);
  assert.equal(nomina.neto, 1110000, "pero el monto se lee igual: es dinero de verdad");
});

test("el corte sale del recibo, no de lo que la app traía puesto", () => {
  const { nomina } = leerNomina(xml("decenal.xml"));

  assert.equal(nomina.dias, 10);
  assert.equal(corteDeNomina(nomina), 10, "un pago decenal corta el 10, no el 15 de siempre");
  assert.equal(nomina.neto, 350000);
});

test("un periodo que cruza de mes no deduce corte: se pregunta en vez de inventarlo", () => {
  const { nomina } = leerNomina(xml("periodo-que-cruza-mes.xml"));

  assert.equal(nomina.neto, 470000, "el recibo se lee completo");
  assert.equal(corteDeNomina(nomina), null, "los ciclos de esta app viven dentro del mes");
});

test("un periodo que termina el último día del mes tampoco aporta un corte", () => {
  assert.equal(corteDeNomina({ inicio: "2026-09-16", fin: "2026-09-30" }), null,
    "el fin de mes ya es frontera siempre");
  assert.equal(corteDeNomina({ inicio: "2026-02-15", fin: "2026-02-28" }), null,
    "y en febrero también, aunque el día sea otro");
});

test("lo que no es un recibo lo dice, en vez de reventar", () => {
  for (const basura of ["", "hola", "<html><body>no soy un CFDI</body></html>", null, undefined]) {
    const { nomina, veredicto } = leerNomina(basura);
    assert.equal(nomina, null);
    assert.equal(veredicto.estado, ESTADOS.SIN_DATOS_SUFICIENTES);
  }
});

test("un CFDI sin total tampoco inventa un ingreso", () => {
  const sinTotal = xml("quincena-ordinaria.xml").replace(/Total="8000\.00"/, 'Total="0.00"');
  const { nomina, veredicto } = leerNomina(sinTotal);

  assert.equal(nomina, null);
  assert.equal(veredicto.datos.falta, "cuánto");
});

test("el prefijo del espacio de nombres no está fijado: el estándar no lo obliga", () => {
  const otroPrefijo = xml("quincena-ordinaria.xml")
    .replace(/cfdi:/g, "c:")
    .replace(/nomina12:/g, "n12:");
  const { nomina } = leerNomina(otroPrefijo);

  assert.equal(nomina.neto, 800000);
  assert.equal(nomina.inicio, "2026-09-01");
});

test("una fecha con hora se recorta al día", () => {
  const conHora = xml("quincena-ordinaria.xml")
    .replace('FechaPago="2026-09-15"', 'FechaPago="2026-09-15T12:04:31"');
  assert.equal(leerNomina(conHora).nomina.fechaPago, "2026-09-15");
});

test("el corpus no lleva datos reales de nadie", () => {
  const sospechoso = /@gmail|@hotmail|@outlook|\b\d{16}\b|\b\d{18}\b/i;
  for (const nombre of readdirSync(CARPETA).filter((n) => n.endsWith(".xml"))) {
    assert.doesNotMatch(xml(nombre), sospechoso, `${nombre} trae algo que parece un dato real`);
  }
});
