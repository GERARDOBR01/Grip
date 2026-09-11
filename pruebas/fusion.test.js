// Fusionar dos dispositivos sin perder nada.
//
// Esta prueba existe por un fallo medido: capturar un gasto en el celular y otro en la PC la
// misma tarde hacía desaparecer uno de los dos, en silencio, porque sincronizar elegía un
// documento entero y descartaba el otro. Perder una captura sin avisar es lo peor que puede
// hacer una app de finanzas.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fusionar, unirPorId, unirBandeja, unirReglas, difieren, claveDeTope } from "../motor/fusion.js";
import { agregarMovimiento, eliminarMovimiento, marcarBorrado, purgarBorrados, normalizar, datosVacios, ESTADOS_BANDEJA, TIPOS } from "../motor/modelo.js";
import { datosDePrueba } from "./ayuda.js";

function enDispositivo(base, nota, monto, sello) {
  const { datos } = agregarMovimiento(base, { fecha: "2026-09-09", monto, tipo: TIPOS.GASTO, categoria: "super", nota });
  return { ...datos, actualizado: sello };
}

const notasDe = (d) => Object.values(d.movimientos).flat().map((m) => m.nota).sort();

test("lo capturado en dos dispositivos se conserva completo", () => {
  const base = datosDePrueba();
  const celular = enDispositivo(base, "DESPENSA", 25000, "2026-09-09T18:00:00Z");
  const pc = enDispositivo(base, "CINE", 48000, "2026-09-09T18:05:00Z");

  assert.deepEqual(notasDe(fusionar(celular, pc)), ["CINE", "DESPENSA"]);
  assert.deepEqual(notasDe(fusionar(pc, celular)), ["CINE", "DESPENSA"], "y da igual el orden");
});

test("fusionar es idempotente: volver a fusionar no cambia nada", () => {
  const base = datosDePrueba();
  const a = enDispositivo(base, "UNO", 100, "2026-09-09T18:00:00Z");
  const b = enDispositivo(base, "DOS", 200, "2026-09-09T18:05:00Z");
  const una = fusionar(a, b);
  assert.deepEqual(notasDe(fusionar(una, una)), notasDe(una));
  assert.deepEqual(notasDe(fusionar(una, b)), notasDe(una));
});

// Sin lápidas, la unión resucitaría lo borrado: el otro dispositivo todavía lo tiene.
test("lo borrado a propósito NO vuelve a la vida al sincronizar", () => {
  const base = datosDePrueba();
  const conGasto = enDispositivo(base, "ERROR", 9999, "2026-09-09T18:00:00Z");
  const id = Object.values(conGasto.movimientos).flat()[0].id;

  const celular = { ...eliminarMovimiento(conGasto, id, "2026-09-09T19:00:00Z"), actualizado: "2026-09-09T19:00:00Z" };
  const pc = { ...conGasto, actualizado: "2026-09-09T18:30:00Z" }; // la PC todavía lo tiene

  assert.deepEqual(notasDe(fusionar(pc, celular)), [], "la lápida gana sobre la copia vieja");
  assert.deepEqual(notasDe(fusionar(celular, pc)), [], "y también al revés");
});

test("borrar deja lápida, y borrar algo que no existe no inventa una", () => {
  const base = datosDePrueba();
  const conGasto = enDispositivo(base, "X", 100, "2026-09-09T18:00:00Z");
  const id = Object.values(conGasto.movimientos).flat()[0].id;
  assert.equal(eliminarMovimiento(conGasto, id).borrados.length, 1);
  assert.equal(eliminarMovimiento(conGasto, "no-existe").borrados.length, 0);
});

test("las lápidas viejas se tiran: ya nadie tiene una copia que pueda resucitar nada", () => {
  const datos = { ...datosDePrueba(), borrados: [{ id: "viejo", cuando: "2025-01-01T00:00:00Z" }, { id: "nuevo", cuando: "2026-09-01T00:00:00Z" }] };
  const limpio = purgarBorrados(datos, "2026-06-01T00:00:00Z");
  assert.deepEqual(limpio.borrados.map((t) => t.id), ["nuevo"]);
});

test("un fijo creado en el otro dispositivo tampoco se pierde", () => {
  const base = datosDePrueba();
  const celular = { ...base, fijos: [...base.fijos, { id: "f_gym", nombre: "Gimnasio", monto: 60000, diaCorte: 3, frecuencia: 1, categoria: "salud", activo: true }], actualizado: "2026-09-09T18:00:00Z" };
  const pc = { ...base, metas: [{ id: "m_viaje", nombre: "Viaje", objetivo: 2000000, fechaLimite: "2027-01-01", prioridad: 1, lograda: false }], actualizado: "2026-09-09T18:05:00Z" };

  const unido = fusionar(celular, pc);
  assert.ok(unido.fijos.some((f) => f.id === "f_gym"), "el fijo del celular sigue ahí");
  assert.ok(unido.metas.some((m) => m.id === "m_viaje"), "y la meta de la PC también");
});

test("un fijo borrado a propósito tampoco resucita", () => {
  const base = datosDePrueba();
  const id = base.fijos[0].id;
  const celular = { ...marcarBorrado({ ...base, fijos: base.fijos.filter((f) => f.id !== id) }, id, "2026-09-09T19:00:00Z"), actualizado: "2026-09-09T19:00:00Z" };
  const pc = { ...base, actualizado: "2026-09-09T18:00:00Z" };
  assert.equal(fusionar(pc, celular).fijos.some((f) => f.id === id), false);
});

// Aceptar un aviso en un dispositivo no debe devolverlo a la bandeja del otro.
test("una entrada ya resuelta gana sobre la que sigue pendiente", () => {
  const pendiente = { id: "e1", estado: ESTADOS_BANDEJA.PENDIENTE, recibido: "2026-09-09" };
  const aceptada = { id: "e1", estado: ESTADOS_BANDEJA.ACEPTADO, recibido: "2026-09-09", movimientoId: "m1" };
  assert.equal(unirBandeja([pendiente], [aceptada])[0].estado, ESTADOS_BANDEJA.ACEPTADO);
  assert.equal(unirBandeja([aceptada], [pendiente])[0].estado, ESTADOS_BANDEJA.ACEPTADO, "y da igual el orden");
});

test("ante la misma regla aprendida gana la más reciente", () => {
  const vieja = { clave: "oxxo", categoriaId: "super", veces: 3, ultima: "2026-08-01" };
  const nueva = { clave: "oxxo", categoriaId: "comida-fuera", veces: 1, ultima: "2026-09-01" };
  assert.equal(unirReglas([vieja], [nueva])[0].categoriaId, "comida-fuera");
  assert.equal(unirReglas([nueva], [vieja])[0].categoriaId, "comida-fuera");
  assert.equal(unirReglas([vieja], [nueva]).length, 1, "y no quedan dos peleando");
});

test("unirPorId aguanta listas vacías, nulas y registros sin id", () => {
  assert.deepEqual(unirPorId(null, undefined), []);
  assert.deepEqual(unirPorId([{ sinId: 1 }], [{ id: "a" }]).map((r) => r.id), ["a"]);
});

test("fusionar con un solo lado devuelve ese lado", () => {
  const d = datosDePrueba();
  assert.equal(fusionar(d, null), d);
  assert.equal(fusionar(null, d), d);
  assert.equal(fusionar(null, null), null);
});

test("difieren reconoce cuándo NO hay que reescribir nada", () => {
  const d = datosDePrueba();
  assert.equal(difieren(d, JSON.parse(JSON.stringify(d))), false);
  assert.equal(difieren(d, { ...d, actualizado: "otro" }), true);
});

// --- El catálogo y los topes, que se quedaron fuera de la unión más tiempo del que debieron ---
//
// Estas cuatro pruebas nacen de una sonda, no de una sospecha: crear una categoría en un
// aparato y guardar en el otro un minuto después la borraba, y con ella se llevaba el sentido
// de todos los movimientos que la usaban.

test("una categoría creada en un dispositivo sobrevive a que el otro guarde después", () => {
  const base = normalizar(datosVacios("2026-09-01"));

  const celular = normalizar({
    ...base,
    categorias: [...base.categorias, { id: "gym", nombre: "Gimnasio", emoji: "🏋️", clase: "fija", tope: 50000 }],
    actualizado: "2026-09-09T10:00:00Z",
  });
  const pc = normalizar({ ...base, actualizado: "2026-09-09T10:01:00Z" });

  const unido = fusionar(celular, pc);
  assert.ok(unido.categorias.some((c) => c.id === "gym"), "la categoría del celular tiene que seguir ahí");
  assert.equal(unido.categorias.length, base.categorias.length + 1);
});

test("dos topes puestos el mismo mes en categorías distintas caben los dos", () => {
  const base = normalizar(datosVacios("2026-09-01"));
  const celular = normalizar({ ...base, presupuestos: { "2026-09": { super: 300000 } }, actualizado: "2026-09-09T10:00:00Z" });
  const pc = normalizar({ ...base, presupuestos: { "2026-09": { transporte: 80000 } }, actualizado: "2026-09-09T10:01:00Z" });

  const unido = fusionar(celular, pc);
  assert.deepEqual(unido.presupuestos["2026-09"], { super: 300000, transporte: 80000 });
});

test("ante el mismo tope en las dos copias gana el del documento más reciente", () => {
  const base = normalizar(datosVacios("2026-09-01"));
  const celular = normalizar({ ...base, presupuestos: { "2026-09": { super: 300000 } }, actualizado: "2026-09-09T10:00:00Z" });
  const pc = normalizar({ ...base, presupuestos: { "2026-09": { super: 450000 } }, actualizado: "2026-09-09T10:01:00Z" });

  assert.equal(fusionar(celular, pc).presupuestos["2026-09"].super, 450000);
});

test("un tope quitado a propósito no vuelve desde el otro dispositivo", () => {
  const base = normalizar(datosVacios("2026-09-01"));
  const conTope = normalizar({ ...base, presupuestos: { "2026-09": { super: 300000 } }, actualizado: "2026-09-09T10:00:00Z" });

  // En el celular se quita: desaparece la casilla Y queda su lápida. Sin la lápida, la copia
  // de la PC —que todavía lo tiene— lo devolvería a la vida al unir.
  const celular = {
    ...marcarBorrado({ ...conTope, presupuestos: { "2026-09": {} } }, claveDeTope("2026-09", "super"), "2026-09-09T11:00:00Z"),
    actualizado: "2026-09-09T11:00:00Z",
  };

  const unido = fusionar(conTope, celular);
  assert.equal((unido.presupuestos["2026-09"] || {}).super, undefined, "el tope quitado no debe volver");
});
