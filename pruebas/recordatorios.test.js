// Lo que merece interrumpirte, y sobre todo lo que no.
//
// Estas pruebas cuidan un umbral, no un cálculo: el día que alguien lo baje "para que avise
// más", esto falla y le recuerda que las notificaciones se apagan una vez y para siempre.

import { test } from "node:test";
import assert from "node:assert/strict";
import { recordatoriosDeHoy, avisoDeEntrada, barraDeHoy } from "../motor/recordatorios.js";
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

// ── La notificación como mesa de trabajo ───────────────────────────────────
//
// Aquí se cuida el permiso más delicado del proyecto: qué cargo lleva botón de «Aceptar» en la
// pantalla de bloqueo. Ese botón acepta dinero sin que nadie esté mirando la app, así que la
// regla de cuándo NO aparece importa más que la de cuándo sí.

function entrada(extra = {}) {
  return {
    id: "e1",
    estado: ESTADOS_BANDEJA.PENDIENTE,
    recibido: HOY,
    confianza: "alta",
    comercio: "OXXO CENTRO",
    movimiento: { id: "m1", tipo: TIPOS.GASTO, monto: 8900, fecha: HOY, categoria: "super", nota: "OXXO CENTRO" },
    ...extra,
  };
}

test("un cargo claro se acepta desde la sombra, con su monto y su categoría", () => {
  const aviso = avisoDeEntrada(datosDePrueba(), entrada());

  assert.equal(aviso.aceptable, true);
  assert.match(aviso.titulo, /OXXO CENTRO/);
  assert.match(aviso.titulo, /−\$89\.00/, "el signo dice si sale o entra dinero");
  assert.match(aviso.cuerpo, /Súper/);
  assert.ok(aviso.acuse, "un toque sin acuse se siente roto aunque haya funcionado");
});

test("un ingreso lleva el signo al revés", () => {
  const aviso = avisoDeEntrada(datosDePrueba(), entrada({
    movimiento: { id: "m1", tipo: TIPOS.INGRESO, monto: 800000, fecha: HOY, categoria: null, nota: "NOMINA" },
  }));
  assert.match(aviso.titulo, /\+\$8,000\.00/);
});

test("si el lector tuvo que suponer algo, NO hay botón de aceptar", () => {
  const aviso = avisoDeEntrada(datosDePrueba(), entrada({ confianza: "media" }));

  assert.equal(aviso.aceptable, false);
  assert.equal(aviso.acuse, null);
  assert.match(aviso.cuerpo, /suponer/, "un botón ausente sin motivo se lee como error de la app");
});

test("un posible traspaso entre tus cuentas tampoco: contarlo sería mentir hacia arriba", () => {
  const aviso = avisoDeEntrada(datosDePrueba(), entrada({ posibleTraspaso: true }));

  assert.equal(aviso.aceptable, false);
  assert.match(aviso.cuerpo, /entre tus cuentas/);
});

test("uno que puede ser el cargo final de otro tampoco: sumar o sustituir no lo decide una app", () => {
  const aviso = avisoDeEntrada(datosDePrueba(), entrada({ reemplaza: "m0" }));

  assert.equal(aviso.aceptable, false);
  assert.match(aviso.cuerpo, /cargo final/);
});

test("uno que no se supo leer avisa, pero no ofrece aceptar nada", () => {
  const aviso = avisoDeEntrada(datosDePrueba(), entrada({
    estado: ESTADOS_BANDEJA.PENDIENTE, movimiento: null, comercio: "Aviso de tu cuenta",
  }));

  assert.equal(aviso.aceptable, false);
  assert.match(aviso.cuerpo, /dime cuánto/);
});

test("lo ya resuelto no se anuncia", () => {
  assert.equal(avisoDeEntrada(datosDePrueba(), entrada({ estado: ESTADOS_BANDEJA.ACEPTADO })), null);
  assert.equal(avisoDeEntrada(datosDePrueba(), null), null);
});

test("la clave es la entrada: publicar dos veces reemplaza, no apila", () => {
  const uno = avisoDeEntrada(datosDePrueba(), entrada());
  const otro = avisoDeEntrada(datosDePrueba(), entrada());
  assert.equal(uno.clave, otro.clave);
  assert.equal(uno.clave, "entrada:e1");
});

// ── La barra que se queda en la sombra ─────────────────────────────────────

test("la barra lleva SIEMPRE su fecha, la lean cuando la lean", () => {
  const barra = barraDeHoy({ disponible: 234000, porDia: 18000, ciclo: { fin: "2026-09-15" } }, HOY);

  assert.match(barra.titulo, /Te quedan \$2,340\.00/);
  assert.match(barra.cuerpo, /\$180\.00 por día/);
  assert.match(barra.cuerpo, new RegExp(`al ${HOY}`),
    "el texto de una notificación se congela: sin fecha miente el día que no abras la app");
});

test("sin ingreso capturado no inventa un número en la pantalla de bloqueo", () => {
  const barra = barraDeHoy({ disponible: null, porDia: null, ciclo: { fin: "2026-09-15" } }, HOY);

  assert.equal(barra.titulo, "Grip");
  assert.doesNotMatch(barra.cuerpo, /\$0\.00/);
});

test("sin panel no hay barra", () => {
  assert.equal(barraDeHoy(null, HOY), null);
});
