// El aprendizaje — la pieza que decide si la app se hace más corta con el uso o no.
//
// Hasta ahora solo estaba cubierta de refilón, desde bandeja.test.js, y es de las que más va
// a crecer. Aquí se prueba sola, incluido lo que más cuidado pide: aplicar una regla HACIA
// ATRÁS, que reescribe historial y por eso nunca debe pasar sin que alguien lo pida.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sugerirCategoria, recordar, olvidar, reglasAprendidas, categoriaMasUsada,
  movimientosDeLaMarca, aplicarRegla,
} from "../motor/aprendizaje.js";
import { TIPOS } from "../motor/modelo.js";
import { datosDePrueba, conMovimientos } from "./ayuda.js";

const HOY = "2026-09-09";

// La clave no es el nombre del comercio: es su marca normalizada, lo que devuelve `marcaDe`.
// "OXXO GASOLINERA 4412" y "OXXO 4412" son la misma cosa, y esa cosa se llama "oxxo".

function conOxxos(categoria = null, cuantos = 3) {
  const movimientos = [];
  for (let i = 0; i < cuantos; i++) {
    movimientos.push({
      id: `m${i}`, tipo: TIPOS.GASTO, monto: 8900 + i,
      fecha: `2026-09-0${i + 1}`, nota: "OXXO GASOLINERA 4412", categoria,
    });
  }
  return conMovimientos(datosDePrueba(), movimientos);
}

// ── Lo que ya se prometía ─────────────────────────────────────────────────

test("una corrección basta: al siguiente cargo ya llega puesta", () => {
  const datos = recordar(datosDePrueba(), "OXXO GASOLINERA 4412", "super", HOY);
  const sugerida = sugerirCategoria(datos, "OXXO GASOLINERA 4412");

  assert.equal(sugerida.categoriaId, "super");
  assert.equal(sugerida.veredicto.datos.fuente, "regla");
});

test("antes de que exista una regla, se deduce de lo que tú mismo capturaste", () => {
  const sugerida = sugerirCategoria(conOxxos("super"), "OXXO GASOLINERA 4412");

  assert.equal(sugerida.categoriaId, "super");
  assert.equal(sugerida.veredicto.datos.fuente, "historial",
    "sin regla, la fuente es el historial y tiene que decirlo");
});

test("un solo movimiento no es un patrón", () => {
  assert.equal(categoriaMasUsada(conOxxos("super", 1), "oxxo"), null);
  assert.equal(sugerirCategoria(conOxxos("super", 1), "OXXO GASOLINERA 4412"), null);
});

test("cambiar de opinión gana: la app no discute con la persona", () => {
  let datos = recordar(datosDePrueba(), "OXXO 4412", "super", HOY);
  datos = recordar(datos, "OXXO 4412", "comida-fuera", HOY);

  assert.equal(sugerirCategoria(datos, "OXXO 4412").categoriaId, "comida-fuera");
  assert.equal(reglasAprendidas(datos).length, 1, "no quedan dos reglas peleando por lo mismo");
});

test("olvidar es tan fácil como aprender", () => {
  const datos = recordar(datosDePrueba(), "OXXO 4412", "super", HOY);
  const clave = reglasAprendidas(datos)[0].clave;

  assert.equal(reglasAprendidas(olvidar(datos, clave)).length, 0);
  assert.equal(sugerirCategoria(olvidar(datos, clave), "OXXO 4412"), null);
});

test("sin comercio no se inventa nada", () => {
  assert.equal(sugerirCategoria(datosDePrueba(), ""), null);
  assert.equal(recordar(datosDePrueba(), "", "super", HOY).reglas.length, 0);
  assert.equal(recordar(datosDePrueba(), "OXXO", null, HOY).reglas.length, 0);
});

// ── Hacia atrás ───────────────────────────────────────────────────────────

test("los cargos pasados del mismo comercio se pueden ver antes de tocarlos", () => {
  const encontrados = movimientosDeLaMarca(conOxxos("ocio"), "oxxo", "super");

  assert.equal(encontrados.length, 3);
  assert.ok(encontrados[0].fecha >= encontrados[2].fecha, "del más nuevo al más viejo");
});

test("no se ofrece cambiar lo que ya está donde debe", () => {
  assert.equal(movimientosDeLaMarca(conOxxos("super"), "oxxo", "super").length, 0);
});

test("el número que se ofrece es el que de verdad cambia", () => {
  const datos = conMovimientos(datosDePrueba(), [
    { id: "a", tipo: TIPOS.GASTO, monto: 8900, fecha: "2026-09-01", nota: "OXXO 4412", categoria: "ocio" },
    { id: "b", tipo: TIPOS.GASTO, monto: 4500, fecha: "2026-09-02", nota: "OXXO 4412", categoria: "super" },
    { id: "c", tipo: TIPOS.GASTO, monto: 12000, fecha: "2026-09-03", nota: "WALMART", categoria: "ocio" },
  ]);

  const ofrecidos = movimientosDeLaMarca(datos, "oxxo", "super");
  assert.equal(ofrecidos.length, 1, "solo el que está en otra categoría");

  const despues = aplicarRegla(datos, "oxxo", "super");
  const todos = Object.values(despues.movimientos).flat();
  assert.equal(todos.filter((m) => m.categoria === "super").length, 2);
  assert.equal(todos.find((m) => m.id === "c").categoria, "ocio", "otro comercio no se toca");
});

test("aplicar hacia atrás no toca el dinero, solo la categoría", () => {
  const antes = conOxxos("ocio");
  const despues = aplicarRegla(antes, "oxxo", "super");

  for (const m of Object.values(despues.movimientos).flat()) {
    const original = Object.values(antes.movimientos).flat().find((o) => o.id === m.id);
    assert.equal(m.monto, original.monto);
    assert.equal(m.fecha, original.fecha);
    assert.equal(m.nota, original.nota);
  }
});

test("aplicar hacia atrás no muta lo que recibe", () => {
  const antes = conOxxos("ocio");
  const copia = JSON.stringify(antes);
  aplicarRegla(antes, "oxxo", "super");

  assert.equal(JSON.stringify(antes), copia);
});

test("si no hay nada que cambiar, no se devuelve un objeto nuevo por gusto", () => {
  const datos = conOxxos("super");
  assert.equal(aplicarRegla(datos, "oxxo", "super"), datos);
  assert.equal(aplicarRegla(datos, "", "super"), datos);
  assert.equal(aplicarRegla(datos, "oxxo", null), datos);
});
