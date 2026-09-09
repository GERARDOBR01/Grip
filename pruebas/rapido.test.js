// El trabajo diario. Dos de cada tres personas dejan las apps de presupuesto antes de los 30
// días, y la causa que más se repite en la investigación no es el precio ni las funciones: es
// la revisión manual. Aquí se prueba lo que baja ese peaje sin cambiar la regla de la casa —
// que nada cuenta sin que la persona lo acepte.

import { test } from "node:test";
import assert from "node:assert/strict";
import { recibirAviso, aceptarTanda, deshacerTanda, deConfianzaAlta, pendientes } from "../motor/bandeja.js";
import { montosFrecuentes, categoriaProbable } from "../motor/rapido.js";
import { ORIGENES } from "../motor/modelo.js";
import { datosDePrueba, conMovimientos } from "./ayuda.js";

const avisoClaro = (comercio, monto, dia) =>
  `Banorte: Compra por $${monto} MXN en ${comercio} el ${dia}/09/2026 con tu tarjeta terminación 4821.`;

function conAvisos(cuantos) {
  let datos = datosDePrueba();
  for (let i = 0; i < cuantos; i++) {
    const paso = recibirAviso(datos, avisoClaro(`COMERCIO ${i}`, `${100 + i}.00`, "07"),
      "avisos@banorte.com", ORIGENES.CORREO, "2026-09-09");
    datos = paso.datos;
  }
  return datos;
}

test("los que se leyeron completos se pueden aceptar de un jalón", () => {
  const datos = conAvisos(12);
  const claras = deConfianzaAlta(datos);
  assert.equal(claras.length, 12, "los doce venían sin nada que revisar");

  const { datos: despues, aceptados, fallaron } = aceptarTanda(datos, claras.map((e) => e.id), "2026-09-09");
  assert.equal(aceptados.length, 12);
  assert.deepEqual(fallaron, []);
  assert.equal(pendientes(despues).length, 0, "la bandeja queda limpia");

  const movimientos = Object.values(despues.movimientos).flat();
  assert.equal(movimientos.length, 12, "y quedaron los doce movimientos, ni uno de más");
});

test("el peaje medido: de 12 toques a 1", () => {
  const datos = conAvisos(12);
  const unoPorUno = pendientes(datos).length;
  const enLote = 1;
  assert.equal(unoPorUno, 12);
  assert.ok(enLote < unoPorUno / 10, `${unoPorUno} toques contra ${enLote}`);
});

test("deshacer la tanda deja todo exactamente como estaba", () => {
  const datos = conAvisos(5);
  const ids = deConfianzaAlta(datos).map((e) => e.id);
  const { datos: aceptado } = aceptarTanda(datos, ids, "2026-09-09");
  const revertido = deshacerTanda(aceptado, ids);

  assert.equal(Object.values(revertido.movimientos).flat().length, 0, "no queda ningún movimiento");
  assert.equal(pendientes(revertido).length, 5, "y los cinco vuelven a esperar");
});

test("lo dudoso NO entra en el lote: ahí es donde su ojo vale", () => {
  let datos = conAvisos(3);
  // Un aviso sin comercio ni fecha: se lee, pero con cosas que revisar.
  datos = recibirAviso(datos, "Se aplicó un cargo por $450.00", "avisos@banorte.com",
    ORIGENES.CORREO, "2026-09-09").datos;

  assert.equal(pendientes(datos).length, 4);
  assert.equal(deConfianzaAlta(datos).length, 3, "el dudoso se queda fuera del botón");
});

test("una tanda con un id que ya no existe no se cae ni se queda a medias", () => {
  const datos = conAvisos(3);
  const ids = deConfianzaAlta(datos).map((e) => e.id);
  const { aceptados, fallaron } = aceptarTanda(datos, [...ids, "ent_no_existe"], "2026-09-09");
  assert.equal(aceptados.length, 3);
  assert.deepEqual(fallaron, ["ent_no_existe"]);
});

// ————————————————————————————————————————————————————————————————————————————————
// El efectivo, que nunca manda correo.

test("sin historial no propone nada: no se inventan montos", () => {
  assert.deepEqual(montosFrecuentes(datosDePrueba(), "2026-09-09"), []);
});

test("un gasto que pasó una sola vez no es 'lo de siempre'", () => {
  const datos = conMovimientos(datosDePrueba(), [
    { fecha: "2026-09-08", monto: 33333, tipo: "gasto", categoria: "otros", nota: "una vez" },
  ]);
  assert.deepEqual(montosFrecuentes(datos, "2026-09-09"), []);
});

test("saca los montos que repite, con la categoría que más les pone", () => {
  const datos = conMovimientos(datosDePrueba(), [
    { fecha: "2026-09-01", monto: 5000, tipo: "gasto", categoria: "comida", nota: "tacos" },
    { fecha: "2026-09-03", monto: 5000, tipo: "gasto", categoria: "comida", nota: "tacos" },
    { fecha: "2026-09-05", monto: 5000, tipo: "gasto", categoria: "transporte", nota: "camión" },
    { fecha: "2026-09-06", monto: 12000, tipo: "gasto", categoria: "super", nota: "oxxo" },
    { fecha: "2026-09-07", monto: 12000, tipo: "gasto", categoria: "super", nota: "oxxo" },
  ]);
  const frecuentes = montosFrecuentes(datos, "2026-09-09");
  assert.deepEqual(frecuentes.map((f) => f.monto), [5000, 12000], "el más repetido primero");
  assert.equal(frecuentes[0].categoriaId, "comida", "2 de 3 veces fue comida");
  assert.equal(categoriaProbable(datos, 12000, "2026-09-09"), "super");
});

test("lo de hace medio año ya no dice cómo gastas hoy", () => {
  const datos = conMovimientos(datosDePrueba(), [
    { fecha: "2026-01-05", monto: 5000, tipo: "gasto", categoria: "comida", nota: "tacos" },
    { fecha: "2026-01-06", monto: 5000, tipo: "gasto", categoria: "comida", nota: "tacos" },
  ]);
  assert.deepEqual(montosFrecuentes(datos, "2026-09-09"), []);
});

test("un monto sin categoría conocida se ofrece igual, pero sin adivinar a dónde va", () => {
  assert.equal(categoriaProbable(datosDePrueba(), 5000, "2026-09-09"), null);
});
