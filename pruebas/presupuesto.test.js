import { test } from "node:test";
import assert from "node:assert/strict";
import { resumenPresupuesto, veredictoCategoria, topeVigente, topesVariables, gastoPorCategoria } from "../motor/presupuesto.js";
import { ESTADOS } from "../motor/veredicto.js";
import { datosDePrueba, conMovimientos } from "./ayuda.js";

const gastos = [
  { fecha: "2026-09-03", monto: 120000, tipo: "gasto", categoria: "super" },
  { fecha: "2026-09-07", monto: 155000, tipo: "gasto", categoria: "super" },
  { fecha: "2026-09-05", monto: 90000, tipo: "gasto", categoria: "transporte" },
  { fecha: "2026-09-06", monto: 95000, tipo: "gasto", categoria: "comida-fuera" },
  { fecha: "2026-09-06", monto: 40000, tipo: "gasto", categoria: "ocio" },
  { fecha: "2026-08-30", monto: 999999, tipo: "gasto", categoria: "super" },
];

test("el semáforo usa los umbrales declarados", () => {
  assert.equal(veredictoCategoria(50000, 100000).estado, ESTADOS.VA_BIEN);
  assert.equal(veredictoCategoria(80000, 100000).estado, ESTADOS.AJUSTADO, "80% ya es ámbar");
  assert.equal(veredictoCategoria(100000, 100000).estado, ESTADOS.AJUSTADO, "justo en el tope todavía no es rojo");
  assert.equal(veredictoCategoria(100001, 100000).estado, ESTADOS.NO_ALCANZA);
});

test("una categoría sin tope NO se pinta de verde: se declara SIN_TOPE", () => {
  const v = veredictoCategoria(40000, null);
  assert.equal(v.estado, ESTADOS.SIN_TOPE);
  assert.match(v.motivo, /no hay contra qué comparar/);
});

test("todo veredicto dice de dónde salió y trae sus dos números", () => {
  const v = veredictoCategoria(275000, 300000);
  assert.equal(v.fuente, "CODIGO");
  assert.equal(v.datos.gastado, 275000);
  assert.equal(v.datos.tope, 300000);
  assert.equal(v.datos.restante, 25000);
});

test("el resumen no mezcla meses y pone primero lo que aprieta", () => {
  const datos = conMovimientos(datosDePrueba(), gastos);
  const filas = resumenPresupuesto(datos, "2026-09-08");

  const porId = Object.fromEntries(filas.map((f) => [f.categoria.id, f]));
  assert.equal(porId.super.gastado, 275000, "el gasto de agosto no entra en septiembre");
  assert.equal(porId.super.veredicto.estado, ESTADOS.AJUSTADO, "275,000 de 300,000 es 92%");
  assert.equal(porId["comida-fuera"].veredicto.estado, ESTADOS.NO_ALCANZA, "95,000 de 80,000 se pasó");
  assert.equal(porId.ocio.veredicto.estado, ESTADOS.SIN_TOPE);
  assert.equal(filas[0].categoria.id, "comida-fuera", "lo rojo va primero");
});

test("el tope del mes le gana al del catálogo, y el histórico no se toca", () => {
  const datos = { ...datosDePrueba(), presupuestos: { "2026-09": { super: 400000 } } };
  assert.equal(topeVigente(datos, "2026-09", "super"), 400000);
  assert.equal(topeVigente(datos, "2026-10", "super"), 300000, "otro mes conserva el tope del catálogo");
});

test("topesVariables dice qué NO está contando", () => {
  const t = topesVariables(datosDePrueba(), "2026-09");
  assert.equal(t.total, 480000, "300,000 + 100,000 + 80,000; la renta es fija y no entra");
  assert.deepEqual(t.sinTope, ["ocio"]);
  assert.equal(t.completo, false);
});

test("gastoPorCategoria solo suma gastos", () => {
  const datos = conMovimientos(datosDePrueba(), [
    ...gastos,
    { fecha: "2026-09-01", monto: 800000, tipo: "ingreso", categoria: null },
  ]);
  const acumulado = gastoPorCategoria(datos, "2026-09-01", "2026-09-30");
  assert.equal(acumulado.super, 275000);
  assert.equal(Object.values(acumulado).reduce((a, b) => a + b, 0), 500000);
});
