// Invariantes — lo que debe ser cierto para CUALQUIER entrada, no solo para las que se me
// ocurrieron.
//
// Las pruebas de ejemplo comprueban que el comportamiento sigue siendo el de ayer; no que sea
// correcto. Contra un lector —que come texto de cualquier forma— eso no basta: los casos que
// rompen son justo los que nadie escribió a mano. Aquí se generan miles y se afirma lo que
// nunca puede dejar de cumplirse.
//
// El generador lleva SEMILLA FIJA a propósito: si algún día una de estas falla, falla con la
// misma entrada, y se puede reproducir y arreglar. Un generador con azar de verdad daría
// fallos que desaparecen al volver a correr.

import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretar, canonizar, limpiarAviso, fechaDelAviso, CONFIANZAS } from "../motor/lectura.js";
import { esISO, diasEnMes } from "../motor/ciclo.js";
import { ESTADOS } from "../motor/veredicto.js";

const HOY = "2026-09-09";
const VUELTAS = 2000;

/** Azar reproducible: mismo número de vuelta, misma entrada. Sin dependencias. */
function dado(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PIEZAS = [
  "Compra por", "Cargo de", "$", "MXN", "M.N.", "pesos", "en", "de", "el", "OXXO", "STARBUCKS",
  "LA GRAN PLAZA 2", "terminación", "****1234", "••••5678", "Saldo disponible:", "Fecha:",
  "07/09/2026", "08/SEP/2026", "31/02/2026", "2026-09-07", "13:45 hrs", "Concepto:", "Nombre:",
  "recibiste", "se envió", "abono", "\n", "  ", "“", "”", "—", "=\n", "​", " ",
  "1,234.56", "0.00", "-45.00", "999999999", "<b>", "</p>", "&nbsp;", "&#36;", "%", "|", "\\",
];

function textoAlAzar(azar) {
  const cuantas = 1 + Math.floor(azar() * 24);
  let salida = "";
  for (let i = 0; i < cuantas; i++) salida += PIEZAS[Math.floor(azar() * PIEZAS.length)] + " ";
  return salida;
}

/** Recorre el dominio y devuelve la primera entrada que rompa `comprobar`. */
function buscarContraejemplo(comprobar) {
  for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
    const azar = dado(vuelta + 1);
    const texto = textoAlAzar(azar);
    let problema = null;
    try {
      problema = comprobar(texto);
    } catch (e) {
      problema = `lanzó: ${e.message}`;
    }
    if (problema) return `vuelta ${vuelta} · ${problema}\n   entrada: ${JSON.stringify(texto)}`;
  }
  return null;
}

test("nunca lanza, con cualquier texto", () => {
  assert.equal(buscarContraejemplo((t) => { interpretar(t, "x@banorte.com", HOY); return null; }), null);
});

// El invariante más importante de todos: la app no puede inventarse dinero.
test("nunca inventa dinero: el monto que devuelve está en el texto", () => {
  assert.equal(buscarContraejemplo((texto) => {
    const r = interpretar(texto, "x@banorte.com", HOY);
    if (!r.movimiento) return null;
    const centavos = r.movimiento.monto;
    const conPunto = (centavos / 100).toFixed(2);
    const limpio = canonizar(texto).replace(/,/g, "");
    // El monto debe aparecer tal cual, o sin sus centavos cuando venían implícitos.
    if (limpio.includes(conPunto) || limpio.includes(String(Math.trunc(centavos / 100)))) return null;
    return `devolvió ${conPunto} y no está en el texto`;
  }), null);
});

test("el monto nunca es cero ni negativo", () => {
  assert.equal(buscarContraejemplo((texto) => {
    const r = interpretar(texto, "x@banorte.com", HOY);
    if (!r.movimiento) return null;
    return r.movimiento.monto > 0 ? null : `monto ${r.movimiento.monto}`;
  }), null);
});

// Una fecha que no existe descuadra la quincena entera.
test("la fecha siempre es una fecha de calendario que existe", () => {
  assert.equal(buscarContraejemplo((texto) => {
    const { iso } = fechaDelAviso(texto, HOY);
    if (!esISO(iso)) return `no es AAAA-MM-DD: ${iso}`;
    const [a, m, d] = iso.split("-").map(Number);
    if (m < 1 || m > 12) return `mes ${m}`;
    if (d < 1 || d > diasEnMes(a, m)) return `día ${d} en ${a}-${m}`;
    return null;
  }), null);
});

test("canonizar es idempotente: hacerlo dos veces da lo mismo que una", () => {
  assert.equal(buscarContraejemplo((t) => (canonizar(canonizar(t)) === canonizar(t) ? null : "cambió en la segunda pasada")), null);
  assert.equal(buscarContraejemplo((t) => (limpiarAviso(limpiarAviso(t)) === limpiarAviso(t) ? null : "limpiarAviso cambió en la segunda")), null);
});

test("misma entrada, mismo resultado: leer es reproducible", () => {
  assert.equal(buscarContraejemplo((texto) => {
    const a = interpretar(texto, "x@banorte.com", HOY);
    const b = interpretar(texto, "x@banorte.com", HOY);
    return a.huella === b.huella && a.confianza === b.confianza ? null : "dos lecturas distintas del mismo texto";
  }), null);
});

// La coherencia que ya se rompió una vez: la insignia decía "lo leí completo" y el motivo
// "revísalo". Ahora se exige sobre todo el dominio, no sobre tres ejemplos.
test("confianza ALTA significa que no quedó NADA que revisar", () => {
  assert.equal(buscarContraejemplo((texto) => {
    const r = interpretar(texto, "x@banorte.com", HOY);
    if (r.confianza !== CONFIANZAS.ALTA) return null;
    const razones = (r.veredicto.datos && r.veredicto.datos.razones) || [];
    if (razones.length) return `alta con pendientes: ${razones.join("; ")}`;
    return r.comercio ? null : "alta sin comercio identificado";
  }), null);
});

test("sin movimiento SIEMPRE hay un veredicto que dice qué falta", () => {
  assert.equal(buscarContraejemplo((texto) => {
    const r = interpretar(texto, "x@banorte.com", HOY);
    if (r.movimiento) return null;
    if (r.veredicto.estado !== ESTADOS.SIN_DATOS) return `estado ${r.veredicto.estado}`;
    return r.veredicto.datos.falta ? null : "no dice qué falta";
  }), null);
});

// Los topes de los cuantificadores son lo que evita el backtracking catastrófico. Sin esta
// prueba, aflojar uno pasaría inadvertido hasta que la app se congele en un teléfono.
test("leer no se dispara con entrada patológica", () => {
  const venenos = [
    "Compra " + "de ".repeat(4000) + "!",
    "Compra por $1.00 en " + "A".repeat(60000),
    "$".repeat(20000),
    ("Fecha: " + "1".repeat(200) + " ").repeat(200),
  ];
  for (const veneno of venenos) {
    const t0 = Date.now();
    interpretar(veneno, "x@banorte.com", HOY);
    const ms = Date.now() - t0;
    assert.ok(ms < 50, `tardó ${ms} ms con una entrada de ${veneno.length} caracteres`);
  }
});
