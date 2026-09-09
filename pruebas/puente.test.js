// El puente, probado de verdad — no leyendo su código, sino EJECUTÁNDOLO.
//
// puente/Codigo.gs no es un módulo: es un archivo que se pega en Apps Script y que ninguna
// prueba tocaba. Y ahí vive la función más delicada del proyecto, `limpiar`, que decide qué
// sale de Gmail y qué no. Aquí se saca la función del archivo y se corre.
//
// Lo que tiene que cumplir a la vez, y son dos cosas en tensión:
//   · que un número de tarjeta o de cuenta NO salga de Gmail, ni por accidente;
//   · que los identificadores de la operación SÍ salgan, porque son lo que permite saber que
//     dos avisos son el mismo movimiento. Sin ellos la app vuelve a adivinar por monto y
//     fecha, que es de donde venimos.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUENTE = readFileSync(join(RAIZ, "puente/Codigo.gs"), "utf8");

/** Saca `limpiar` del script y la vuelve una función de verdad, con sus constantes. */
function limpiarDelPuente() {
  const maximo = FUENTE.match(/var MAXIMO_CARACTERES = (\d+);/);
  const cuerpo = FUENTE.match(/function limpiar\(crudo\) \{[\s\S]*?\n\}/);
  assert.ok(cuerpo, "no encontré limpiar() en puente/Codigo.gs");
  // eslint-disable-next-line no-new-func
  return new Function(`var MAXIMO_CARACTERES = ${maximo ? maximo[1] : 1200}; ${cuerpo[0]}; return limpiar;`)();
}

const limpiar = limpiarDelPuente();

test("un número de tarjeta completo NO sale de Gmail", () => {
  const salida = limpiar("Compra con tu tarjeta 4152313412344574 en OXXO");
  assert.ok(!salida.includes("4152313412344574"), salida);
  assert.match(salida, /\*{4}4574/, "se deja lo que sirve para identificarla, nada más");
});

test("una CLABE tampoco", () => {
  const salida = limpiar("Cuenta destino 012180001234567895");
  assert.ok(!salida.includes("012180001234567895"), salida);
});

test("pero la clave de rastreo SÍ, porque es lo que evita contar dos veces", () => {
  const salida = limpiar("Transferencia enviada\nClave de rastreo: MBAN01002609070012345678\nMonto $500.00");
  assert.ok(salida.includes("MBAN01002609070012345678"), salida);
});

test("y el folio de autorización también, aunque sea largo", () => {
  const salida = limpiar("Folio de autorización: 483920456789");
  assert.ok(salida.includes("483920456789"), salida);
});

test("un número largo suelto, sin etiqueta que lo identifique, se tapa igual", () => {
  // Sin etiqueta no hay forma de saber que no es una cuenta. Ante la duda, se tapa.
  const salida = limpiar("Referencia 998877665544");
  assert.ok(!salida.includes("998877665544"), salida);
});

test("los dos a la vez: la tarjeta tapada y el folio intacto en el mismo aviso", () => {
  const salida = limpiar("Compra tarjeta 4152313412344574. Folio de autorización: 483920. Monto $120.00");
  assert.ok(!salida.includes("4152313412344574"), "la tarjeta se fue");
  assert.ok(salida.includes("483920"), "el folio se quedó");
});

test("el HTML se va y el texto queda legible", () => {
  const salida = limpiar("<div><b>Compra</b><br>por $120.00 en OXXO</div>");
  assert.ok(!salida.includes("<"), salida);
  assert.match(salida, /Compra/);
});

test("no devuelve el correo entero: hay tope de caracteres", () => {
  const salida = limpiar("A".repeat(50000));
  assert.ok(salida.length <= 1200, `${salida.length} caracteres`);
});

test("y lo que sale de aquí lo entiende el lector de la app", async () => {
  const { interpretar } = await import("../motor/lectura.js");
  const salida = limpiar(
    "<p>Compra por $1,250.50 MXN en FERRETERIA LOPEZ el 07/09/2026</p>" +
    "<p>Tarjeta terminación 4821 · Folio de autorización: 778812</p>",
  );
  const leido = interpretar(salida, "avisos@banorte.com", "2026-09-09");
  assert.equal(leido.movimiento.monto, 125050);
  assert.equal(leido.comercio, "FERRETERIA LOPEZ");
  assert.equal(leido.folio, "778812", "el identificador llegó entero hasta el lector");
});
