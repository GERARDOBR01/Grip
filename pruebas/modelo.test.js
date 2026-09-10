import { test } from "node:test";
import assert from "node:assert/strict";
import { datosVacios, normalizar, agregarMovimiento, eliminarMovimiento, movimientosEntre, normalizarMovimiento, TIPOS, VERSION_DATOS } from "../motor/modelo.js";
import { migrar } from "../motor/migraciones.js";

test("el documento vacío no inventa un solo monto", () => {
  const d = datosVacios("2026-09-08");
  assert.equal(d.perfil.ingresoQuincenal, null, "null = no capturado, distinto de cero");
  assert.equal(d.perfil.colchonObjetivo, null);
  assert.deepEqual(d.movimientos, {});
  assert.ok(d.categorias.every((c) => c.tope === null), "ninguna categoría trae un tope inventado");
});

test("normalizar sobrevive a basura sin tirar lo bueno", () => {
  const d = normalizar({
    perfil: { ingresoQuincenal: "8,000.50", cortes: [15, 99, "x"] },
    categorias: [{ id: "super", nombre: "Súper", tope: "300" }, null, { sinId: true }],
    movimientos: { "2026-09": [{ fecha: "2026-09-03", monto: -450, tipo: "gasto", categoria: "super" }], basura: [1] },
    fijos: [{ nombre: "Renta", monto: "5000", diaCorte: 99 }, {}],
  });
  assert.equal(d.perfil.ingresoQuincenal, 800050);
  assert.deepEqual(d.perfil.cortes, [15]);
  assert.equal(d.categorias.length, 1);
  assert.equal(d.categorias[0].tope, 30000);
  assert.equal(d.movimientos["2026-09"][0].monto, 450, "el signo lo da el tipo, no el número");
  assert.equal(d.movimientos.basura, undefined);
  assert.equal(d.fijos.length, 1);
  assert.equal(d.fijos[0].diaCorte, 31, "un día 99 se recorta, no revienta");
});

test("agregar y eliminar movimientos no muta el documento anterior", () => {
  const antes = datosVacios("2026-09-08");
  const { datos, movimiento, error } = agregarMovimiento(antes, {
    fecha: "2026-09-08", monto: 25000, tipo: "gasto", categoria: "super",
  });
  assert.equal(error, null);
  assert.deepEqual(antes.movimientos, {}, "el documento original queda intacto");
  assert.equal(datos.movimientos["2026-09"].length, 1);

  const despues = eliminarMovimiento(datos, movimiento.id);
  assert.deepEqual(despues.movimientos, {});
});

test("un movimiento sin fecha o sin monto se rechaza con motivo", () => {
  const { error } = agregarMovimiento(datosVacios(), { monto: 100, tipo: "gasto" });
  assert.match(error, /fecha y monto/);
});

test("movimientosEntre solo mira los meses que hacen falta", () => {
  let datos = datosVacios("2026-09-08");
  for (const fecha of ["2026-08-31", "2026-09-01", "2026-09-15", "2026-09-16"]) {
    datos = agregarMovimiento(datos, { fecha, monto: 1000, tipo: "gasto", categoria: "super" }).datos;
  }
  assert.equal(movimientosEntre(datos, "2026-09-01", "2026-09-15").length, 2);
});

test("migrar acepta lo de hoy y deja los datos normalizados", () => {
  const r = migrar({ ...datosVacios("2026-09-08"), version: VERSION_DATOS });
  assert.equal(r.ok, true);
  assert.equal(r.datos.version, VERSION_DATOS);
});

test("migrar se NIEGA a abrir datos de una versión más nueva", () => {
  const r = migrar({ ...datosVacios(), version: VERSION_DATOS + 5 });
  assert.equal(r.ok, false, "abrirlos borraría lo que la versión nueva guardó");
  assert.match(r.motivo, /más nueva/);
  assert.equal(r.datos, null);
});

test("migrar rechaza lo que no es un documento", () => {
  assert.equal(migrar(null).ok, false);
  assert.equal(migrar("hola").ok, false);
});

// --- Lo que no se puede creer, no entra ---
//
// Un movimiento con fecha imposible no es un movimiento raro: es una resta que va a mentir en
// pantalla. `cicloDe("2026-02-31")` devolvía 16 días transcurridos de un ciclo de 13, y de esa
// división sale el "te queda por día" que la app enseña en grande.

test("una fecha que no existe en el calendario no entra como movimiento", () => {
  for (const fecha of ["2026-02-31", "2026-13-01", "2026-00-10", "9999-99-99", "2025-02-29", "1899-12-31"]) {
    assert.equal(normalizarMovimiento({ fecha, monto: 5000, tipo: TIPOS.GASTO }), null, `${fecha} debería rechazarse`);
  }
});

test("el 29 de febrero de un año bisiesto sí existe", () => {
  assert.ok(normalizarMovimiento({ fecha: "2024-02-29", monto: 5000, tipo: TIPOS.GASTO }));
});

test("un monto que ya no se puede sumar con exactitud no es un monto", () => {
  // 2^53 centavos es donde los enteros de JavaScript dejan de ser exactos. Guardar algo así
  // sería volver al error de coma flotante por la puerta de atrás.
  assert.equal(normalizarMovimiento({ fecha: "2026-09-09", monto: 1e20, tipo: TIPOS.GASTO }), null);
  assert.equal(normalizarMovimiento({ fecha: "2026-09-09", monto: "999999999999999999", tipo: TIPOS.GASTO }), null);
  assert.ok(normalizarMovimiento({ fecha: "2026-09-09", monto: 999999999, tipo: TIPOS.GASTO }), "un monto normal sí pasa");
});

test("un ingreso absurdo en el perfil se queda en 'no hay dato', no en un número falso", () => {
  const datos = normalizar({ ...datosVacios("2026-09-01"), perfil: { ingresoQuincenal: 1e19, cortes: [15] } });
  assert.equal(datos.perfil.ingresoQuincenal, null);
});
