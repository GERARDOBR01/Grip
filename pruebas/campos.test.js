// La estructura general de los avisos, probada como estructura y no banco por banco.
//
// La idea que sostiene motor/campos.js: lo que cambia de un banco a otro son las ETIQUETAS,
// no los campos. Las transferencias siguen el CEP del Banco de México (fecha, hora, monto,
// clave de rastreo, banco emisor, beneficiario, concepto, referencia) y las compras con
// tarjeta, sin norma, convergen en los mismos huecos. Si eso es cierto, un banco que nadie
// programó tiene que leerse bien con solo usar las etiquetas de siempre — y eso es lo que
// se prueba aquí.

import { test } from "node:test";
import assert from "node:assert/strict";
import { valorEtiquetado, CAMPOS } from "../motor/campos.js";
import { interpretar, huellaDe, posibleDuplicado } from "../motor/lectura.js";
import { datosDePrueba, conMovimientos } from "./ayuda.js";

test("saca la clave de rastreo de una transferencia", () => {
  const texto = "Transferencia enviada\nClave de rastreo: MBAN01002609070012345678\nMonto: $500.00";
  assert.equal(valorEtiquetado(texto, "claveRastreo"), "MBAN01002609070012345678");
});

test("una etiqueta sin valor útil devuelve null en vez de basura", () => {
  // "Clave de rastreo: pendiente" no es una clave; sin un solo dígito no lo es.
  assert.equal(valorEtiquetado("Clave de rastreo: pendiente", "claveRastreo"), null);
});

test("saca el folio de autorización con sus varios nombres", () => {
  for (const etiqueta of ["Folio de autorización", "Número de autorización", "Autorización", "Folio"]) {
    assert.equal(valorEtiquetado(`${etiqueta}: 483920`, "folio"), "483920", etiqueta);
  }
});

test("un campo que no está devuelve null, no inventa", () => {
  assert.equal(valorEtiquetado("Compra por $120.00 en OXXO", "claveRastreo"), null);
  assert.equal(valorEtiquetado("Compra por $120.00 en OXXO", "folio"), null);
});

// ————————————————————————————————————————————————————————————————————————————————
// Lo que de verdad justifica la tabla: un banco que NADIE programó.

test("un banco desconocido se lee bien si usa las etiquetas de siempre", () => {
  const texto = [
    "Banco Inventado del Norte",
    "Compra con tarjeta",
    "Establecimiento: FERRETERIA LOPEZ",
    "Monto: $1,250.50",
    "Fecha: 07/09/2026",
    "Terminación: 4821",
    "Folio de autorización: 778812",
  ].join("\n");

  const r = interpretar(texto, "avisos@bancoinventado.mx", "2026-09-09");
  assert.equal(r.banco, null, "no está en la tabla de bancos, y aun así:");
  assert.equal(r.movimiento.monto, 125050);
  assert.equal(r.movimiento.fecha, "2026-09-07");
  assert.equal(r.comercio, "FERRETERIA LOPEZ");
  assert.equal(r.ultimos4, "4821");
  assert.equal(r.folio, "778812");
});

// ————————————————————————————————————————————————————————————————————————————————
// La huella en tres niveles.

test("con clave de rastreo, la huella es la clave — no el parecido de monto y fecha", () => {
  const a = huellaDe({ banco: "nu", fecha: "2026-09-08", monto: 8000, claveRastreo: "ABC123XYZ456", tipo: "gasto" });
  const b = huellaDe({ banco: "santander", fecha: "2026-09-09", monto: 8000, claveRastreo: "abc123xyz456", tipo: "gasto" });
  assert.equal(a, b, "la misma operación desde dos bancos y con otra fecha sigue siendo una");
});

test("pero el SENTIDO va pegado: un traspaso entre tus cuentas no colapsa en un gasto", () => {
  // Esta es la trampa. Mandar de Nu a Santander genera dos avisos con la misma clave: uno de
  // salida y otro de entrada. Si se unieran, quedaría un gasto donde tu dinero no se movió.
  const sale = huellaDe({ claveRastreo: "ABC123XYZ456", tipo: "gasto" });
  const entra = huellaDe({ claveRastreo: "ABC123XYZ456", tipo: "ingreso" });
  assert.notEqual(sale, entra);
});

test("sin clave pero con folio y tarjeta, esos mandan", () => {
  const autorizado = huellaDe({ banco: "banamex", fecha: "2026-09-07", monto: 10000, ultimos4: "4821", folio: "778812", tipo: "gasto" });
  const liquidado = huellaDe({ banco: "banamex", fecha: "2026-09-09", monto: 4300, ultimos4: "4821", folio: "778812", tipo: "gasto" });
  assert.equal(autorizado, liquidado, "$100 de gasolina y su cargo real de $43 son una compra");
});

test("sin ningún identificador, la red de siempre sigue puesta", () => {
  const h = huellaDe({ banco: "banamex", fecha: "2026-09-07", monto: 10000, ultimos4: "4821", comercio: "OXXO" });
  assert.match(h, /^banamex\|2026-09-07\|10000\|4821\|oxxo$/);
});

// ————————————————————————————————————————————————————————————————————————————————
// Y lo que cambia para la persona: qué le dice la app.

const conRef = (ref, tipo, monto) =>
  conMovimientos(datosDePrueba(), [
    { fecha: "2026-09-07", monto, tipo, categoria: tipo === "gasto" ? "super" : null, nota: "GASOLINERA", ref },
  ]);

test("el mismo folio con otro monto se ofrece REEMPLAZAR, no sumar", () => {
  const datos = conRef("778812", "gasto", 10000);
  const lectura = {
    comercio: "GASOLINERA", huella: "folio|778812|4821",
    movimiento: { fecha: "2026-09-09", monto: 4300, tipo: "gasto", ref: "778812" },
  };
  const v = posibleDuplicado(datos, lectura);
  assert.equal(v.datos.motivo, "liquidacion");
  assert.equal(v.datos.montoPrevio, 10000);
});

test("el mismo identificador al revés se reconoce como traspaso, no como gasto nuevo", () => {
  const datos = conRef("ABC123XYZ456", "gasto", 50000);
  const lectura = {
    comercio: "Santander", huella: "rastreo|abc123xyz456|ingreso",
    movimiento: { fecha: "2026-09-07", monto: 50000, tipo: "ingreso", ref: "ABC123XYZ456" },
  };
  const v = posibleDuplicado(datos, lectura);
  assert.equal(v.datos.motivo, "traspaso");
  assert.match(v.motivo, /no cambia de total/i);
});

test("el mismo identificador y el mismo monto es el mismo movimiento, ya registrado", () => {
  const datos = conRef("778812", "gasto", 10000);
  const lectura = {
    comercio: "GASOLINERA", huella: "folio|778812|4821",
    movimiento: { fecha: "2026-09-07", monto: 10000, tipo: "gasto", ref: "778812" },
  };
  assert.equal(posibleDuplicado(datos, lectura).datos.motivo, "huella");
});

test("la tabla no tiene etiquetas vacías: un sinónimo en blanco casaría con todo", () => {
  for (const [nombre, campo] of Object.entries(CAMPOS)) {
    for (const etiqueta of [...(campo.etiquetas || []), ...(campo.etiquetasDebiles || [])]) {
      assert.ok(etiqueta && etiqueta.trim().length >= 4, `${nombre}: "${etiqueta}" es demasiado corta`);
    }
  }
});
