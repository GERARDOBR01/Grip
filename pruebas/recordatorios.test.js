// Lo que merece interrumpirte, y sobre todo lo que no.
//
// Estas pruebas cuidan un umbral, no un cálculo: el día que alguien lo baje "para que avise
// más", esto falla y le recuerda que las notificaciones se apagan una vez y para siempre.

import { test } from "node:test";
import assert from "node:assert/strict";
import { recordatoriosDeHoy } from "../motor/recordatorios.js";
import { TIPOS, ESTADOS_BANDEJA } from "../motor/modelo.js";
import { datosDePrueba } from "./ayuda.js";

const HOY = "2026-09-09";

// `datosDePrueba` ya trae dos fijos suyos, y uno de ellos vence cerca de HOY. Aquí se ponen
// los fijos a mano en TODOS los casos: si no, cada prueba estaría midiendo también la renta.
function sinFijos() {
  return { ...datosDePrueba(), fijos: [] };
}

function conFijo(diaCorte) {
  return {
    ...sinFijos(),
    fijos: [{ id: "f_luz", nombre: "Luz", monto: 78000, diaCorte, categoria: "casa", activo: true, frecuencia: 1 }],
  };
}

function conPendientes(cuantos, recibido) {
  const base = sinFijos();
  const bandeja = [];
  for (let i = 0; i < cuantos; i++) {
    bandeja.push({
      id: `e${i}`, estado: ESTADOS_BANDEJA.PENDIENTE, recibido, confianza: "alta",
      movimiento: { id: `mm${i}`, tipo: TIPOS.GASTO, monto: 5000, fecha: recibido, categoria: "super", nota: "TIENDA" },
    });
  }
  return { ...base, bandeja };
}

test("un fijo que vence mañana sí merece un aviso, con su monto", () => {
  const recordatorios = recordatoriosDeHoy(conFijo(10), HOY);
  const luz = recordatorios.find((r) => r.clave.startsWith("fijo:f_luz"));

  assert.ok(luz, "debería recordar la luz");
  assert.match(luz.titulo, /Mañana vence Luz/);
  assert.match(luz.cuerpo, /780\.00/);
});

test("uno que vence en diez días NO: eso es una lista, no un recordatorio", () => {
  assert.equal(recordatoriosDeHoy(conFijo(19), HOY).length, 0);
});

test("uno que ya se pasó lo dice sin suavizarlo", () => {
  const luz = recordatoriosDeHoy(conFijo(5), HOY).find((r) => r.clave.startsWith("fijo:"));
  assert.ok(luz);
  assert.match(luz.titulo, /se pasó de fecha/);
});

test("dos avisos de ayer no son una urgencia", () => {
  assert.equal(recordatoriosDeHoy(conPendientes(2, "2026-09-08"), HOY).length, 0);
  assert.equal(recordatoriosDeHoy(conPendientes(6, "2026-09-08"), HOY).length, 0,
    "muchos, pero de ayer: todavía no");
});

test("seis de la semana pasada sí, una vez al día", () => {
  const recordatorios = recordatoriosDeHoy(conPendientes(6, "2026-09-02"), HOY);
  assert.equal(recordatorios.length, 1);
  assert.match(recordatorios[0].titulo, /6 avisos/);
  assert.equal(recordatorios[0].clave, `bandeja:${HOY}`,
    "la clave lleva el día: si mañana siguen, se vuelve a decir — pero solo una vez");
});

test("una app sin nada que decir no dice nada", () => {
  assert.deepEqual(recordatoriosDeHoy(sinFijos(), HOY), []);
});

test("las claves son estables: el mismo recordatorio no se manda dos veces", () => {
  const unos = recordatoriosDeHoy(conFijo(10), HOY).map((r) => r.clave);
  const otros = recordatoriosDeHoy(conFijo(10), HOY).map((r) => r.clave);
  assert.deepEqual(unos, otros);
});
