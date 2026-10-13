// Plantillas y la comparación contra la quincena pasada.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  guardarPlantilla, borrarPlantilla, usarPlantilla, listaDePlantillas, plantillaDesdeMovimiento,
  MAXIMO_DE_PLANTILLAS,
} from "../motor/plantillas.js";
import { contraElCicloAnterior } from "../motor/tendencia.js";
import { TIPOS, normalizar } from "../motor/modelo.js";
import { fusionar } from "../motor/fusion.js";
import { ESTADOS } from "../motor/veredicto.js";
import { datosDePrueba, conMovimientos } from "./ayuda.js";

const HOY = "2026-09-20";

function conRenta() {
  const r = guardarPlantilla(datosDePrueba(), { nombre: "Renta", monto: 500000, tipo: TIPOS.GASTO, categoria: "casa" });
  assert.equal(r.error, null);
  return r;
}

// ── Plantillas ─────────────────────────────────────────────────────────────

test("usar una plantilla registra el movimiento con fecha de hoy, en un toque", () => {
  const { datos, plantilla } = conRenta();
  const r = usarPlantilla(datos, plantilla.id, HOY, "09:15");
  assert.equal(r.error, null);
  assert.equal(r.movimiento.fecha, HOY);
  assert.equal(r.movimiento.monto, 500000);
  assert.equal(r.movimiento.categoria, "casa");
  assert.equal(r.movimiento.nota, "Renta", "sin nota, el nombre de la plantilla dice qué fue");
  assert.deepEqual(r.datos.plantillas, datos.plantillas, "usarla no la cambia");
});

test("lo que no sirve se dice", () => {
  const base = datosDePrueba();
  assert.match(guardarPlantilla(base, { nombre: "X", monto: 0 }).error, /monto/);
  assert.match(guardarPlantilla(base, { nombre: "", monto: 100 }).error, /nombre/);
  assert.match(guardarPlantilla(base, { nombre: "X", monto: 100, categoria: "no-existe" }).error, /categoría/);
  const { datos } = conRenta();
  assert.match(guardarPlantilla(datos, { nombre: "renta", monto: 1, categoria: "casa" }).error, /se llama/);
});

test("editar por id reemplaza, no duplica", () => {
  const { datos, plantilla } = conRenta();
  const r = guardarPlantilla(datos, { ...plantilla, monto: 550000 });
  assert.equal(r.datos.plantillas.length, 1);
  assert.equal(r.datos.plantillas[0].monto, 550000);
});

test("tienen tope, para seguir siendo un atajo", () => {
  let datos = datosDePrueba();
  for (let i = 0; i < MAXIMO_DE_PLANTILLAS; i++) {
    datos = guardarPlantilla(datos, { nombre: `P${i}`, monto: 100, categoria: "super" }).datos;
  }
  assert.match(guardarPlantilla(datos, { nombre: "Una más", monto: 100, categoria: "super" }).error, /Caben/);
});

test("un ingreso no necesita categoría", () => {
  const r = guardarPlantilla(datosDePrueba(), { nombre: "Clases", monto: 80000, tipo: TIPOS.INGRESO });
  assert.equal(r.error, null);
  assert.equal(usarPlantilla(r.datos, r.plantilla.id, HOY).movimiento.tipo, TIPOS.INGRESO);
});

test("borrar deja lápida: la otra copia no la revive al fusionar", () => {
  const { datos, plantilla } = conRenta();
  const borrado = borrarPlantilla(datos, plantilla.id, "2026-09-20T10:00:00.000Z");
  assert.equal(borrado.plantillas.length, 0);
  const otraCopia = { ...datos, actualizado: "2026-09-19" };
  const unida = fusionar(otraCopia, { ...borrado, actualizado: "2026-09-20" });
  assert.equal(unida.plantillas.length, 0);
});

test("dos dispositivos que crean plantillas distintas conservan las dos", () => {
  const a = guardarPlantilla(datosDePrueba(), { nombre: "Renta", monto: 1, categoria: "casa" }).datos;
  const b = guardarPlantilla(datosDePrueba(), { nombre: "Camión", monto: 1, categoria: "transporte" }).datos;
  assert.deepEqual(listaDePlantillas(fusionar(a, b)).map((p) => p.nombre), ["Camión", "Renta"]);
});

test("sobreviven normalizar, y nacen de un movimiento", () => {
  const { datos } = conRenta();
  assert.deepEqual(normalizar(JSON.parse(JSON.stringify(datos))).plantillas, datos.plantillas);
  const p = plantillaDesdeMovimiento({ monto: 4500, tipo: TIPOS.GASTO, categoria: "comida-fuera", nota: "Café" });
  assert.equal(p.nombre, "Café");
});

// ── Contra la quincena pasada ──────────────────────────────────────────────

function dosQuincenas() {
  return conMovimientos(datosDePrueba(), [
    // Quincena pasada (1–15 sep): a estas alturas (día 5) llevaba 1,000 en súper y 300 en ocio.
    { tipo: TIPOS.GASTO, monto: 100000, fecha: "2026-09-02", categoria: "super", nota: "a" },
    { tipo: TIPOS.GASTO, monto: 30000, fecha: "2026-09-05", categoria: "ocio", nota: "b" },
    // Después del día 5 de la pasada: NO cuenta para comparar a la misma altura.
    { tipo: TIPOS.GASTO, monto: 999900, fecha: "2026-09-12", categoria: "super", nota: "c" },
    // Esta quincena (16–30 sep), al día 20 (= día 5): 1,500 en súper, nada de ocio.
    { tipo: TIPOS.GASTO, monto: 150000, fecha: "2026-09-17", categoria: "super", nota: "d" },
    { tipo: TIPOS.INGRESO, monto: 800000, fecha: "2026-09-16", nota: "nómina" },
  ]);
}

test("compara a la misma altura de la quincena, no contra la quincena entera", () => {
  const r = contraElCicloAnterior(dosQuincenas(), HOY);
  assert.equal(r.dias, 5);
  assert.equal(r.totalAntes, 130000);
  assert.equal(r.totalAhora, 150000);
  assert.deepEqual(r.filas.map((f) => [f.categoriaId, f.diferencia]), [["super", 50000], ["ocio", -30000]]);
  assert.equal(r.veredicto.estado, ESTADOS.AJUSTADO);
  assert.match(r.veredicto.motivo, /\$200\.00 más .* sobre todo en Súper/);
});

test("ir por debajo se dice como buena noticia", () => {
  const datos = conMovimientos(datosDePrueba(), [
    { tipo: TIPOS.GASTO, monto: 100000, fecha: "2026-09-02", categoria: "super", nota: "a" },
    { tipo: TIPOS.GASTO, monto: 10000, fecha: "2026-09-17", categoria: "super", nota: "b" },
  ]);
  const r = contraElCicloAnterior(datos, HOY);
  assert.equal(r.veredicto.estado, ESTADOS.VA_BIEN);
  assert.match(r.veredicto.motivo, /\$900\.00 menos/);
});

test("sin nada en la quincena pasada no se inventa una comparación", () => {
  const datos = conMovimientos(datosDePrueba(), [
    { tipo: TIPOS.GASTO, monto: 10000, fecha: "2026-09-17", categoria: "super", nota: "b" },
  ]);
  const r = contraElCicloAnterior(datos, HOY);
  assert.equal(r.veredicto.estado, ESTADOS.SIN_DATOS);
  assert.deepEqual(r.filas, []);
});

test("un ciclo más largo que el anterior se compara contra el anterior completo", () => {
  // 31 de agosto: la segunda quincena de agosto tiene 16 días; la anterior (1–15) solo 15.
  const datos = conMovimientos(datosDePrueba(), [
    { tipo: TIPOS.GASTO, monto: 100, fecha: "2026-08-15", categoria: "super", nota: "a" },
  ]);
  const r = contraElCicloAnterior(datos, "2026-08-31");
  assert.equal(r.dias, 15);
  assert.equal(r.hastaAnterior, "2026-08-15");
});
