// Importar un estado de cuenta. Lo que se cuida: que lea los formatos que de verdad exportan los
// bancos de aquí, que no invente nada, y que volver a subir el mismo archivo no duplique.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  partirCSV, analizarCSV, filasAMovimientos, leerOFX, leerFecha, leerMonto, ordenDeFechas,
  mandarABandeja, esOFX,
} from "../motor/importar.js";
import { recordar } from "../motor/aprendizaje.js";
import { aceptarTanda, deConfianzaAlta } from "../motor/bandeja.js";
import { TIPOS, ORIGENES, ESTADOS_BANDEJA } from "../motor/modelo.js";
import { datosDePrueba, conMovimientos } from "./ayuda.js";

const HOY = "2026-09-20";

// Inventados, con la forma de los de verdad: preámbulo, encabezado con acentos, cargo y abono
// en columnas separadas, saldo al final, comillas con comas dentro.
const CSV_CARGO_ABONO = `Cuenta: ****1234
Periodo: 01/09/2026 - 15/09/2026

"Fecha","Descripción","Cargo","Abono","Saldo"
"02/09/2026","OXXO 1234 MTY","89.00","","10,911.00"
"03/09/2026","NOMINA EMPRESA, S.A. DE C.V.","","8,000.00","18,911.00"
"14/09/2026","UBER EATS","1,250.50","","17,660.50"
"","Total","1,339.50","8,000.00",""
`;

const CSV_UN_MONTO = `Fecha;Concepto;Importe;Referencia
2026-09-02;SPOTIFY;-129,00;A1
2026-09-05;DEPOSITO;1.500,00;A2
`;

const OFX = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260902120000<TRNAMT>-89.00<FITID>F001<NAME>OXXO 1234
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260903<TRNAMT>8000.00<FITID>F002<NAME>NOMINA<MEMO>PAGO QUINCENA
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>roto<TRNAMT>-1<FITID>F003
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

// ── Leer celdas ────────────────────────────────────────────────────────────

test("fechas: las formas en que las escriben los bancos", () => {
  assert.equal(leerFecha("02/09/2026"), "2026-09-02");
  assert.equal(leerFecha("02/09/2026", "mda"), "2026-02-09");
  assert.equal(leerFecha("2026-09-02"), "2026-09-02");
  assert.equal(leerFecha("2-sep-26"), "2026-09-02");
  assert.equal(leerFecha("02 Sept 2026"), "2026-09-02");
  assert.equal(leerFecha("20260902"), "2026-09-02");
  assert.equal(leerFecha("31/02/2026"), null, "una fecha que no existe no se inventa");
  assert.equal(leerFecha("Total"), null);
});

test("el orden de las fechas se descubre si algún número lo delata", () => {
  assert.deepEqual(ordenDeFechas(["02/09/2026", "25/09/2026"]), { orden: "dma", seguro: true });
  assert.deepEqual(ordenDeFechas(["09/02/2026", "09/25/2026"]), { orden: "mda", seguro: true });
  assert.deepEqual(ordenDeFechas(["02/09/2026"]), { orden: "dma", seguro: false });
});

test("montos: signo, paréntesis, menos al final y coma decimal", () => {
  assert.equal(leerMonto("$1,234.50"), 123450);
  assert.equal(leerMonto("-89"), -8900);
  assert.equal(leerMonto("(1,234.50)"), -123450);
  assert.equal(leerMonto("1,234.50-"), -123450);
  assert.equal(leerMonto("1.234,50"), 123450);
  assert.equal(leerMonto("-129,00"), -12900);
  assert.equal(leerMonto(""), null);
  assert.equal(leerMonto("abc"), null);
});

test("las comillas protegen comas y saltos de línea", () => {
  const filas = partirCSV('a,b\n"uno, dos","tres\ncuatro"\n');
  assert.deepEqual(filas, [["a", "b"], ["uno, dos", "tres\ncuatro"]]);
});

// ── Qué columna es qué ─────────────────────────────────────────────────────

test("encuentra el encabezado después del preámbulo y separa cargo de abono (y no toma el saldo)", () => {
  const a = analizarCSV(CSV_CARGO_ABONO);
  assert.deepEqual(a.encabezado, ["Fecha", "Descripción", "Cargo", "Abono", "Saldo"]);
  assert.deepEqual(a.mapeo, { fecha: 0, descripcion: 1, monto: null, cargo: 2, abono: 3, referencia: null });
  const { movimientos, descartadas } = filasAMovimientos(a.filas, a.mapeo, { orden: a.orden });
  assert.deepEqual(movimientos.map((m) => [m.fecha, m.tipo, m.monto]), [
    ["2026-09-02", TIPOS.GASTO, 8900],
    ["2026-09-03", TIPOS.INGRESO, 800000],
    ["2026-09-14", TIPOS.GASTO, 125050],
  ]);
  assert.equal(movimientos[1].nota, "NOMINA EMPRESA, S.A. DE C.V.");
  assert.equal(descartadas, 1, "el renglón de totales no es un movimiento");
});

test("punto y coma, una sola columna con signo, coma decimal y referencia", () => {
  const a = analizarCSV(CSV_UN_MONTO);
  assert.equal(a.mapeo.monto, 2);
  assert.equal(a.mapeo.referencia, 3);
  const { movimientos } = filasAMovimientos(a.filas, a.mapeo, { orden: a.orden });
  assert.deepEqual(movimientos.map((m) => [m.tipo, m.monto, m.ref]), [[TIPOS.GASTO, 12900, "A1"], [TIPOS.INGRESO, 150000, "A2"]]);
  const invertidos = filasAMovimientos(a.filas, a.mapeo, { invertir: true }).movimientos;
  assert.equal(invertidos[0].tipo, TIPOS.INGRESO, "para los bancos que ponen los cargos en positivo");
});

test("sin encabezado, se adivina por el contenido", () => {
  const a = analizarCSV("02/09/2026,OXXO 1234,-89.00,1000.00\n03/09/2026,UBER,-50.00,950.00\n");
  assert.equal(a.encabezado, null);
  assert.equal(a.mapeo.fecha, 0);
  assert.equal(a.mapeo.descripcion, 1);
  assert.equal(a.mapeo.monto, 2, "la primera columna de números; la última es el saldo");
});

test("OFX: sin mapeo, con su FITID, y lo ilegible se descarta", () => {
  assert.ok(esOFX(OFX));
  assert.ok(!esOFX(CSV_CARGO_ABONO));
  const { movimientos, descartadas } = leerOFX(OFX);
  assert.deepEqual(movimientos, [
    { fecha: "2026-09-02", monto: 8900, tipo: TIPOS.GASTO, nota: "OXXO 1234", ref: "F001" },
    { fecha: "2026-09-03", monto: 800000, tipo: TIPOS.INGRESO, nota: "NOMINA PAGO QUINCENA", ref: "F002" },
  ]);
  assert.equal(descartadas, 1);
});

// ── A la bandeja ───────────────────────────────────────────────────────────

function importado(datos = datosDePrueba()) {
  const a = analizarCSV(CSV_CARGO_ABONO);
  return mandarABandeja(datos, filasAMovimientos(a.filas, a.mapeo, { orden: a.orden }).movimientos, HOY);
}

test("todo va a la bandeja, pendiente, y nada cuenta todavía", () => {
  const r = importado();
  assert.equal(r.nuevos, 3);
  assert.equal(Object.keys(r.datos.movimientos).length, 0);
  assert.ok(r.datos.bandeja.every((e) => e.estado === ESTADOS_BANDEJA.PENDIENTE && e.origen === ORIGENES.ARCHIVO));
});

test("subir el mismo archivo dos veces no duplica nada", () => {
  const primera = importado();
  const segunda = importado(primera.datos);
  assert.equal(segunda.nuevos, 0);
  assert.equal(segunda.repetidos, 3);
  assert.equal(segunda.datos.bandeja.length, 3);
});

test("dos movimientos idénticos en el mismo archivo son dos, no uno", () => {
  const dos = [
    { fecha: "2026-09-02", monto: 4500, tipo: TIPOS.GASTO, nota: "CAFE", ref: null },
    { fecha: "2026-09-02", monto: 4500, tipo: TIPOS.GASTO, nota: "CAFE", ref: null },
  ];
  assert.equal(mandarABandeja(datosDePrueba(), dos, HOY).nuevos, 2);
});

test("lo que se parece a algo ya capturado entra marcado para revisar, no se acepta solo", () => {
  const datos = conMovimientos(datosDePrueba(), [
    { tipo: TIPOS.GASTO, monto: 8900, fecha: "2026-09-01", nota: "OXXO", categoria: "super" },
  ]);
  const r = importado(datos);
  assert.equal(r.parecidos, 1);
  const oxxo = r.datos.bandeja.find((e) => e.movimiento.monto === 8900);
  assert.equal(oxxo.confianza, "baja");
  assert.match(oxxo.aviso, /si es el mismo, descártalo/);
  assert.ok(!deConfianzaAlta(r.datos).some((e) => e.id === oxxo.id));
  assert.equal(deConfianzaAlta(r.datos).length, 2, "los otros dos sí se pueden aceptar en tanda");
});

test("usa las reglas: llegan con su categoría", () => {
  const datos = recordar(datosDePrueba(), "UBER EATS", "comida-fuera", HOY);
  const r = importado(datos);
  assert.equal(r.datos.bandeja.find((e) => e.comercio === "UBER EATS").movimiento.categoria, "comida-fuera");
});

test("aceptar en tanda lo importado crea los movimientos", () => {
  const r = importado();
  const { datos, aceptados } = aceptarTanda(r.datos, deConfianzaAlta(r.datos).map((e) => e.id), HOY);
  assert.equal(aceptados.length, 3);
  assert.equal(Object.values(datos.movimientos).flat().length, 3);
});

test("la tanda tiene tope, y lo que no cupo entra al volver a subir el archivo", () => {
  const muchos = Array.from({ length: 5 }, (_, i) => ({ fecha: "2026-09-02", monto: 100 + i, tipo: TIPOS.GASTO, nota: `X${i}`, ref: null }));
  const primera = mandarABandeja(datosDePrueba(), muchos, HOY, 3);
  assert.equal(primera.nuevos, 3);
  assert.equal(primera.sinCupo, 2);
  const aceptado = aceptarTanda(primera.datos, primera.datos.bandeja.map((e) => e.id), HOY).datos;
  const segunda = mandarABandeja(aceptado, muchos, HOY, 3);
  assert.equal(segunda.nuevos, 2);
  assert.equal(segunda.repetidos, 3);
});
