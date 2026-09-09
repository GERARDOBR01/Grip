// Las pruebas del lector. Los textos de aquí están inventados imitando la forma de un aviso
// bancario: montos, comercios y tarjetas falsos. Los correos reales no entran al repositorio.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  interpretar, limpiarAviso, montoDelAviso, fechaDelAviso, comercioDelAviso,
  tarjetaDelAviso, normalizarComercio, huellaDe, posibleDuplicado, CONFIANZAS,
} from "../motor/lectura.js";
import { ESTADOS } from "../motor/veredicto.js";
import { TIPOS } from "../motor/modelo.js";
import { datosDePrueba, conMovimientos } from "./ayuda.js";

const HOY = "2026-09-09";

test("lee un aviso completo: monto, fecha, comercio, tarjeta y tipo", () => {
  const r = interpretar(
    "Compra por $1,234.56 MXN en STARBUCKS REFORMA con tu tarjeta terminación 4821 el 09/09/2026.",
    "alertas@banorte.com", HOY,
  );
  assert.equal(r.movimiento.monto, 123456);
  assert.equal(r.movimiento.fecha, "2026-09-09");
  assert.equal(r.movimiento.tipo, TIPOS.GASTO);
  assert.equal(r.comercio, "STARBUCKS REFORMA");
  assert.equal(r.ultimos4, "4821");
  assert.equal(r.banco, "banorte");
  assert.equal(r.confianza, CONFIANZAS.ALTA);
});

// El error que arruinaría las cuentas en silencio: casi todo aviso trae el saldo, y el saldo
// es siempre más grande que la compra. Confundirlos infla el gasto del día entero.
test("el saldo NO se confunde con el monto de la compra", () => {
  const r = interpretar(
    "Cargo por $89.00 en OXXO. Saldo disponible: $8,000.00 MXN",
    "alertas@banorte.com", HOY,
  );
  assert.equal(r.movimiento.monto, 8900);
});

test("un ingreso se reconoce como ingreso, no como gasto", () => {
  const r = interpretar("Recibiste una transferencia SPEI por $8,000.00 MXN el 15/09/2026", "x@banamex.com", HOY);
  assert.equal(r.movimiento.tipo, TIPOS.INGRESO);
  assert.equal(r.movimiento.monto, 800000);
  assert.equal(r.movimiento.fecha, "2026-09-15");
});

test("una devolución es ingreso: si contara como gasto, castigaría dos veces", () => {
  const r = interpretar("Devolución por $450.00 MXN de AMAZON MX el 03/09/2026", "x@banamex.com", HOY);
  assert.equal(r.movimiento.tipo, TIPOS.INGRESO);
});

test("las fechas se leen a la mexicana: 03/09 es 3 de septiembre, no 9 de marzo", () => {
  assert.equal(fechaDelAviso("operación del 03/09/2026").iso, "2026-09-03");
  assert.equal(fechaDelAviso("operación del 3 de septiembre de 2026").iso, "2026-09-03");
  assert.equal(fechaDelAviso("operación 2026-09-03").iso, "2026-09-03");
  assert.equal(fechaDelAviso("03-SEP-2026").iso, "2026-09-03");
});

test("una fecha imposible no se cuela: 31/02 no existe", () => {
  const f = fechaDelAviso("cargo del 31/02/2026", HOY);
  assert.equal(f.iso, HOY);
  assert.equal(f.explicita, false, "y se declara que la fecha se supuso");
});

test("sin monto no hay movimiento: declara qué falta en vez de inventar un cero", () => {
  const r = interpretar("Tu estado de cuenta ya está disponible.", "x@banorte.com", HOY);
  assert.equal(r.movimiento, null);
  assert.equal(r.veredicto.estado, ESTADOS.SIN_DATOS);
  assert.ok(r.veredicto.datos.falta);
});

test("un banco desconocido igual se lee, solo que con menos confianza", () => {
  const r = interpretar("Compra por $250.00 en CAFE LA ESQUINA el 08/09/2026", "quien@sabe.com", HOY);
  assert.equal(r.movimiento.monto, 25000);
  assert.equal(r.banco, null);
  assert.notEqual(r.confianza, CONFIANZAS.ALTA);
});

test("cuando algo se supuso, el veredicto lo dice — no se presenta como leído", () => {
  const r = interpretar("$500.00", "", HOY);
  assert.ok(r.veredicto.datos.razones.length > 0);
  assert.match(r.veredicto.motivo, /fecha/i);
  assert.equal(r.confianza, CONFIANZAS.BAJA);
});

test("el HTML del correo se limpia antes de leer", () => {
  const html = "<html><style>p{color:red}</style><body><p>Compra por <b>$99.00</b> en TIENDA</p></body></html>";
  const limpio = limpiarAviso(html);
  assert.ok(!limpio.includes("<"));
  assert.ok(!limpio.includes("color:red"));
  assert.equal(montoDelAviso(limpio).centavos, 9900);
});

test("un nombre de comercio con preposiciones no se corta a la mitad", () => {
  assert.equal(comercioDelAviso("Compra en EL PALACIO DE HIERRO POLANCO. Monto: $2,450.00"), "EL PALACIO DE HIERRO POLANCO");
  assert.equal(comercioDelAviso("Cargo por $89.00 en OXXO el 08/09/2026"), "OXXO");
});

test("el mismo comercio se reconoce aunque cambie la sucursal", () => {
  assert.equal(normalizarComercio("OXXO GASOLINERA 4412 MEX"), normalizarComercio("OXXO GASOLINERA 7781"));
  assert.equal(normalizarComercio("Café  Élite, S.A. de C.V."), "cafe elite");
});

test("de la tarjeta solo se guardan los últimos 4, nunca más", () => {
  assert.equal(tarjetaDelAviso("tarjeta terminación 4821"), "4821");
  assert.equal(tarjetaDelAviso("tarjeta ****1234"), "1234");
  assert.equal(tarjetaDelAviso("sin tarjeta"), null);
});

// El bug clásico: el banco manda "compra aprobada" y luego "cargo aplicado". Son un solo
// gasto. Contarlos dos veces hace que la app mienta hacia arriba, que es la peor dirección.
test("la autorización y el cargo de la misma compra comparten huella", () => {
  const a = interpretar("Compra aprobada por $340.00 en CINEPOLIS con tarjeta terminación 4821 el 08/09/2026", "x@banorte.com", HOY);
  const b = interpretar("Cargo aplicado por $340.00 en CINEPOLIS con tarjeta terminación 4821 el 08/09/2026", "x@banorte.com", HOY);
  assert.equal(a.huella, b.huella);
});

test("dos compras distintas NO comparten huella", () => {
  const a = interpretar("Compra por $340.00 en CINEPOLIS el 08/09/2026", "x@banorte.com", HOY);
  const b = interpretar("Compra por $341.00 en CINEPOLIS el 08/09/2026", "x@banorte.com", HOY);
  assert.notEqual(a.huella, b.huella);
});

test("avisa si ya hay un movimiento igual en los mismos días", () => {
  const datos = conMovimientos(datosDePrueba(), [
    { fecha: "2026-09-08", monto: 34000, tipo: TIPOS.GASTO, categoria: "ocio", nota: "CINEPOLIS" },
  ]);
  const r = interpretar("Compra por $340.00 en CINEPOLIS el 08/09/2026", "x@banorte.com", HOY);
  const dup = posibleDuplicado(datos, r);
  assert.ok(dup, "un cargo idéntico el mismo día tiene que levantar la mano");
  assert.match(dup.motivo, /mismo cargo/i);
});

test("un movimiento distinto no se marca como duplicado", () => {
  const datos = conMovimientos(datosDePrueba(), [
    { fecha: "2026-09-08", monto: 34000, tipo: TIPOS.GASTO, categoria: "ocio", nota: "CINEPOLIS" },
  ]);
  const r = interpretar("Compra por $120.00 en FARMACIA el 08/09/2026", "x@banorte.com", HOY);
  assert.equal(posibleDuplicado(datos, r), null);
});

test("un traspaso entre cuentas propias se marca: no es un gasto", () => {
  const r = interpretar("Traspaso por $2,000.00 entre tus cuentas el 08/09/2026", "x@banorte.com", HOY);
  assert.equal(r.posibleTraspaso, true);
});

test("la huella no depende de cómo venía escrito el comercio", () => {
  const a = huellaDe({ banco: "banorte", fecha: "2026-09-08", monto: 34000, ultimos4: "4821", comercio: "OXXO 4412" });
  const b = huellaDe({ banco: "banorte", fecha: "2026-09-08", monto: 34000, ultimos4: "4821", comercio: "oxxo, 7781" });
  assert.equal(a, b);
});

test("nunca lanza, pase lo que pase", () => {
  for (const basura of [null, undefined, "", 12345, {}, "<<<>>>", "$"]) {
    assert.doesNotThrow(() => interpretar(basura, "", HOY));
  }
});
