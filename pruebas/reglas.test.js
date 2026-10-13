// Reglas con palabras — lo que la persona le dice a la app, además de lo que la app aprende.
//
// Tres promesas, una por bloque:
//   1. Una regla atrapa al comercio escrito de mil formas, y nunca hay dos dueños de la misma
//      palabra.
//   2. Lo de antes se arregla solo si la persona lo pide, y solo lo que ella eligió.
//   3. Una regla de pago convierte el aviso en lo que es: dinero que va a tu tarjeta, no gasto.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reglaPara, sugerirParaAviso, sugerirCategoria, guardarRegla, recordar, partirPalabras,
  movimientosDeLaRegla, aplicarReglaA,
} from "../motor/aprendizaje.js";
import { recibirAviso, aceptarEntrada } from "../motor/bandeja.js";
import { TIPOS, ACCIONES_REGLA, normalizar, normalizarRegla } from "../motor/modelo.js";
import { migrar } from "../motor/migraciones.js";
import { fusionar } from "../motor/fusion.js";
import { datosDePrueba, conMovimientos } from "./ayuda.js";

const HOY = "2026-09-09";

function conTarjeta(extra = {}) {
  return datosDePrueba({ tarjetas: [{ id: "t_bbva", nombre: "BBVA Azul", ultimos4: "4821", diaCorte: 3, diaLimite: 23 }], ...extra });
}

function conRegla(datos, propuesta, original = null) {
  const r = guardarRegla(datos, propuesta, original, HOY);
  assert.equal(r.error, null, r.error);
  return r.datos;
}

// ── 1. Varias palabras, fragmentos, un solo dueño ───────────────────────────

test("una regla atrapa todas las formas en que el banco escribe el mismo lugar", () => {
  const datos = conRegla(datosDePrueba(), { clave: "Tiendas", palabras: "oxxo, 7 eleven", categoriaId: "super" });
  for (const comercio of ["OXXO 1234 MTY", "Oxxo Gasolinera", "COMPRA 7 ELEVEN SUC 22", "pago en OXXO"]) {
    const s = sugerirCategoria(datos, comercio);
    assert.equal(s && s.categoriaId, "super", comercio);
  }
  assert.equal(sugerirCategoria(datos, "SOXXON INDUSTRIAL"), null, "la palabra tiene que empezar donde empieza una del comercio");
});

test("acentos, mayúsculas y signos no importan, ni en la palabra ni en el aviso", () => {
  const datos = conRegla(datosDePrueba(), { clave: "Café", palabras: "Café Punta", categoriaId: "comida-fuera" });
  assert.equal(sugerirCategoria(datos, "CAFE-PUNTA DEL CIELO").categoriaId, "comida-fuera");
});

test("gana la que dijo más: la palabra más larga le gana a la corta y a la marca aprendida", () => {
  let datos = recordar(datosDePrueba(), "OXXO 4412", "super", HOY); // clave aprendida: "oxxo"
  datos = conRegla(datos, { clave: "Gasolina", palabras: "oxxo gas", categoriaId: "transporte" });
  assert.equal(sugerirCategoria(datos, "OXXO GAS 99").categoriaId, "transporte");
  assert.equal(sugerirCategoria(datos, "OXXO 4412").categoriaId, "super");
  assert.equal(reglaPara(datos, "OXXO GAS 99").palabra, "oxxo gas");
});

test("una palabra no puede tener dos dueños", () => {
  const datos = conRegla(datosDePrueba(), { clave: "Tiendas", palabras: "oxxo", categoriaId: "super" });
  const r = guardarRegla(datos, { clave: "Otra", palabras: "OXXO", categoriaId: "ocio" }, null, HOY);
  assert.match(r.error, /ya está en la regla «Tiendas»/);
  assert.equal(r.datos, datos, "un error no cambia nada");
});

test("ni puede ser el comercio exacto de otra regla", () => {
  const datos = recordar(datosDePrueba(), "OXXO 4412", "super", HOY);
  const r = guardarRegla(datos, { clave: "Tiendas", palabras: "oxxo", categoriaId: "ocio" }, null, HOY);
  assert.match(r.error, /ya tiene su propia regla/);
});

test("lo que no sirve se dice: palabra corta, sin palabras, sin categoría, nombre repetido", () => {
  const base = datosDePrueba();
  assert.match(guardarRegla(base, { clave: "X", palabras: "ox", categoriaId: "super" }).error, /muy corta/);
  assert.match(guardarRegla(base, { clave: "X", palabras: "", categoriaId: "super" }).error, /al menos una palabra/);
  assert.match(guardarRegla(base, { clave: "X", palabras: "oxxo", categoriaId: "no-existe" }).error, /categoría/);
  assert.match(guardarRegla(base, { clave: "", palabras: "oxxo", categoriaId: "super" }).error, /nombre/);
  const una = conRegla(base, { clave: "Tiendas", palabras: "oxxo", categoriaId: "super" });
  assert.match(guardarRegla(una, { clave: "tiendas", palabras: "walmart", categoriaId: "super" }).error, /se llama/);
});

test("editar conserva el nombre y lo usado, y puede quitarle palabras a una aprendida", () => {
  let datos = recordar(datosDePrueba(), "OXXO 4412", "super", HOY);
  datos = recordar(datos, "OXXO 4412", "super", HOY);
  datos = conRegla(datos, { clave: "ignorado", palabras: "oxxo gas", categoriaId: "transporte" }, "oxxo");
  const regla = datos.reglas.find((r) => r.clave === "oxxo");
  assert.deepEqual(regla.palabras, ["oxxo gas"]);
  assert.equal(regla.categoriaId, "transporte");
  assert.equal(regla.veces, 2);
  assert.equal(datos.reglas.length, 1);
});

test("aprender sobre un comercio que ya atrapa una regla de palabras no crea otra", () => {
  let datos = conRegla(datosDePrueba(), { clave: "Tiendas", palabras: "oxxo", categoriaId: "super" });
  datos = recordar(datos, "MI OXXO 1234", "super", HOY);
  assert.equal(datos.reglas.length, 1);
  assert.equal(datos.reglas[0].veces, 2);
  // Pero si la corrige a otra categoría, ese comercio exacto ("mi oxxo") gana su propia regla.
  datos = recordar(datos, "MI OXXO 1234", "ocio", HOY);
  assert.equal(datos.reglas.length, 2);
  assert.equal(sugerirCategoria(datos, "MI OXXO 1234").categoriaId, "ocio");
  assert.equal(sugerirCategoria(datos, "OXXO GAS").categoriaId, "super", "la de palabras sigue sirviendo para el resto");
});

test("partir palabras acepta coma, punto y coma y renglones", () => {
  assert.deepEqual(partirPalabras("oxxo, 7 eleven; walmart\nsoriana ,, "), ["oxxo", "7 eleven", "walmart", "soriana"]);
});

// ── 2. Hacia atrás, solo lo elegido ─────────────────────────────────────────

function historial() {
  return conMovimientos(conTarjeta(), [
    { id: "a", tipo: TIPOS.GASTO, monto: 5000, fecha: "2026-09-01", nota: "OXXO 1234", categoria: "otros" },
    { id: "b", tipo: TIPOS.GASTO, monto: 6000, fecha: "2026-09-03", nota: "OXXO GASOLINERA", categoria: "otros" },
    { id: "c", tipo: TIPOS.GASTO, monto: 7000, fecha: "2026-09-05", nota: "OXXO 9", categoria: "super" },
    { id: "d", tipo: TIPOS.INGRESO, monto: 9000, fecha: "2026-09-05", nota: "OXXO reembolso" },
    { id: "e", tipo: TIPOS.GASTO, monto: 1000, fecha: "2026-09-06", nota: "WALMART", categoria: "otros" },
  ]);
}

test("lo que la regla cambiaría: solo gastos suyos que no estén ya así, del más nuevo al más viejo", () => {
  const datos = conRegla(historial(), { clave: "Tiendas", palabras: "oxxo", categoriaId: "super" });
  assert.deepEqual(movimientosDeLaRegla(datos, "Tiendas").map((m) => m.id), ["b", "a"]);
});

test("si otra regla más específica manda sobre un movimiento, no se ofrece", () => {
  let datos = conRegla(historial(), { clave: "Tiendas", palabras: "oxxo", categoriaId: "super" });
  datos = conRegla(datos, { clave: "Gasolina", palabras: "oxxo gasolinera", categoriaId: "transporte" });
  assert.deepEqual(movimientosDeLaRegla(datos, "Tiendas").map((m) => m.id), ["a"]);
  assert.deepEqual(movimientosDeLaRegla(datos, "Gasolina").map((m) => m.id), ["b"]);
});

test("aplicar solo toca lo elegido, y solo la categoría", () => {
  const datos = conRegla(historial(), { clave: "Tiendas", palabras: "oxxo", categoriaId: "super" });
  const despues = aplicarReglaA(datos, "Tiendas", ["a"]);
  const todos = Object.values(despues.movimientos).flat();
  const a = todos.find((m) => m.id === "a");
  assert.equal(a.categoria, "super");
  assert.equal(a.monto, 5000);
  assert.equal(a.nota, "OXXO 1234");
  assert.equal(todos.find((m) => m.id === "b").categoria, "otros", "lo no elegido se queda como estaba");
  assert.equal(aplicarReglaA(datos, "Tiendas", []), datos, "elegir nada no cambia nada");
  assert.equal(aplicarReglaA(datos, "Tiendas").movimientos["2026-09"].find((m) => m.id === "b").categoria, "super", "sin lista, todos");
});

// ── 3. Pago de tarjeta ─────────────────────────────────────────────────────

const AVISO_PAGO = "Compra por $3,000.00 MXN en PAGO TDC BBVA con tarjeta terminación 1111 el 08/09/2026";

test("una regla de pago necesita una tarjeta que exista", () => {
  const r = guardarRegla(datosDePrueba(), { clave: "Pago", palabras: "pago tdc", accion: ACCIONES_REGLA.PAGO, tarjetaId: "t_bbva" });
  assert.match(r.error, /tarjeta/);
});

test("el aviso que atrapa una regla de pago llega como PAGO de esa tarjeta, no como gasto", () => {
  // El aviso sale de la cuenta de débito terminada en 1111, que también está dada de alta como
  // tarjeta: si los últimos 4 ganaran, el pago se iría a la tarjeta equivocada.
  const base = datosDePrueba({ tarjetas: [
    { id: "t_bbva", nombre: "BBVA Azul", ultimos4: "4821", diaCorte: 3, diaLimite: 23 },
    { id: "t_debito", nombre: "Débito", ultimos4: "1111", diaCorte: 1, diaLimite: 20 },
  ] });
  const datos = conRegla(base, { clave: "Pago BBVA", palabras: "pago tdc", accion: ACCIONES_REGLA.PAGO, tarjetaId: "t_bbva" });
  const s = sugerirParaAviso(datos, "PAGO TDC BBVA");
  assert.equal(s.accion, ACCIONES_REGLA.PAGO);
  assert.equal(sugerirCategoria(datos, "PAGO TDC BBVA"), null, "un pago no tiene categoría");

  const { datos: conEntrada, entrada } = recibirAviso(datos, AVISO_PAGO, "alertas@banorte.com", "pegado", HOY);
  assert.ok(entrada && entrada.comercio, "el aviso de prueba se tiene que poder leer, con su comercio");
  assert.equal(entrada.movimiento.tipo, TIPOS.PAGO);
  assert.equal(entrada.movimiento.tarjetaId, "t_bbva");
  assert.equal(entrada.movimiento.categoria, null);
  assert.match(entrada.aviso, /pago a BBVA Azul/);

  const { movimiento } = aceptarEntrada(conEntrada, entrada.id, {}, HOY);
  assert.equal(movimiento.tipo, TIPOS.PAGO);
  assert.equal(movimiento.tarjetaId, "t_bbva", "los últimos 4 del aviso no le ganan a la regla");
});

test("hacia atrás, una regla de pago convierte los gastos que atrapa en pagos", () => {
  let datos = conMovimientos(conTarjeta(), [
    { id: "p1", tipo: TIPOS.GASTO, monto: 300000, fecha: "2026-09-02", nota: "PAGO TDC BBVA", categoria: "otros" },
  ]);
  datos = conRegla(datos, { clave: "Pago BBVA", palabras: "pago tdc", accion: ACCIONES_REGLA.PAGO, tarjetaId: "t_bbva" });
  assert.deepEqual(movimientosDeLaRegla(datos, "Pago BBVA").map((m) => m.id), ["p1"]);
  const m = aplicarReglaA(datos, "Pago BBVA").movimientos["2026-09"][0];
  assert.equal(m.tipo, TIPOS.PAGO);
  assert.equal(m.categoria, null);
  assert.equal(m.tarjetaId, "t_bbva");
  assert.equal(movimientosDeLaRegla(aplicarReglaA(datos, "Pago BBVA"), "Pago BBVA").length, 0, "ya no queda nada que hacer");
});

// ── El documento ───────────────────────────────────────────────────────────

test("las reglas nuevas sobreviven normalizar, migrar y fusionar", () => {
  const datos = conRegla(conTarjeta(), { clave: "Pago BBVA", palabras: "pago tdc", accion: ACCIONES_REGLA.PAGO, tarjetaId: "t_bbva" });
  const vuelta = normalizar(JSON.parse(JSON.stringify(datos)));
  assert.deepEqual(vuelta.reglas, datos.reglas);
  assert.deepEqual(fusionar(datosDePrueba(), datos).reglas, datos.reglas);
});

test("una regla v5 sube a v6 sin perder nada y sin palabras inventadas", () => {
  const v5 = { ...datosDePrueba(), version: 5, reglas: [{ clave: "oxxo", categoriaId: "super", veces: 3, ultima: HOY }] };
  delete v5.plantillas;
  const r = migrar(v5);
  assert.ok(r.ok);
  assert.deepEqual(r.datos.reglas, [{ clave: "oxxo", accion: "categoria", categoriaId: "super", tarjetaId: null, palabras: [], veces: 3, ultima: HOY }]);
  assert.deepEqual(r.datos.plantillas, []);
});

test("normalizar tira las palabras cortas y repetidas", () => {
  const r = normalizarRegla({ clave: "x", categoriaId: "super", palabras: ["OX", "Oxxo", "oxxo", "  7  Eleven "] });
  assert.deepEqual(r.palabras, ["oxxo", "7 eleven"]);
});
