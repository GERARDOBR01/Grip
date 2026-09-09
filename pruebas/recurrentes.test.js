import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectarRecurrentes, porRegistrar, subieronDePrecio, fijoDesdeRecurrente,
  totalRecurrenteMensual, frecuenciaDeDias,
} from "../motor/recurrentes.js";
import {
  tendenciaPorCiclo, resumenTendencia, quincenasDeColchon, ciclosRecientes,
} from "../motor/tendencia.js";
import { TIPOS } from "../motor/modelo.js";
import { ESTADOS } from "../motor/veredicto.js";
import { datosDePrueba, conMovimientos } from "./ayuda.js";

const HOY = "2026-09-09";

function conNetflix(montos, extra = []) {
  return conMovimientos(datosDePrueba(), [
    ...montos.map((monto, i) => ({
      fecha: `2026-0${6 + i}-14`, monto, tipo: TIPOS.GASTO, categoria: "ocio", nota: "NETFLIX",
    })),
    ...extra,
  ]);
}

test("tres cargos iguales al mes son una suscripción", () => {
  const r = detectarRecurrentes(conNetflix([21900, 21900, 21900]), HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].frecuencia, 1);
  assert.equal(r[0].veces, 3);
  assert.equal(r[0].monto, 21900);
});

// Dos cargos son una casualidad. Proponer una suscripción con dos datos es adivinar.
test("dos cargos NO bastan", () => {
  assert.equal(detectarRecurrentes(conNetflix([21900, 21900]), HOY).length, 0);
});

test("compras sueltas en el mismo lugar no son una suscripción", () => {
  const datos = conMovimientos(datosDePrueba(), [
    { fecha: "2026-08-02", monto: 15000, tipo: TIPOS.GASTO, categoria: "super", nota: "OXXO 11" },
    { fecha: "2026-08-05", monto: 9000, tipo: TIPOS.GASTO, categoria: "super", nota: "OXXO 22" },
    { fecha: "2026-08-19", monto: 4000, tipo: TIPOS.GASTO, categoria: "super", nota: "OXXO 33" },
  ]);
  assert.equal(detectarRecurrentes(datos, HOY).length, 0, "el ritmo es irregular: no es un cobro fijo");
});

// El aviso que de verdad ahorra dinero.
test("avisa cuando una suscripción sube de precio, con las dos cifras", () => {
  const subidas = subieronDePrecio(conNetflix([21900, 21900, 26900]), HOY);
  assert.equal(subidas.length, 1);
  assert.equal(subidas[0].montoAnterior, 21900);
  assert.equal(subidas[0].monto, 26900);
  assert.match(subidas[0].veredicto.motivo, /\$219\.00 a \$269\.00/);
});

test("si el precio no cambió, no inventa una alarma", () => {
  assert.equal(subieronDePrecio(conNetflix([21900, 21900, 21900]), HOY).length, 0);
});

test("lo que ya es pago fijo deja de proponerse", () => {
  const base = conNetflix([21900, 21900, 21900]);
  const conFijo = { ...base, fijos: [...base.fijos, { id: "f_nx", nombre: "Netflix", monto: 21900, diaCorte: 14, frecuencia: 1, categoria: "ocio", activo: true }] };
  assert.equal(detectarRecurrentes(conFijo, HOY)[0].yaEsFijo, true);
  assert.equal(porRegistrar(conFijo, HOY).length, 0);
});

test("una recurrente se convierte en el pago fijo que la app ya sabe manejar", () => {
  const r = detectarRecurrentes(conNetflix([21900, 21900, 21900]), HOY)[0];
  const fijo = fijoDesdeRecurrente(r);
  assert.equal(fijo.monto, 21900);
  assert.equal(fijo.frecuencia, 1);
  assert.equal(fijo.diaCorte, 14);
});

test("un cargo anual se reconoce como anual, no como mensual", () => {
  assert.equal(frecuenciaDeDias(365), 12);
  assert.equal(frecuenciaDeDias(30), 1);
  assert.equal(frecuenciaDeDias(91), 3);
  assert.equal(frecuenciaDeDias(200), null, "un ritmo que no se parece a nada no se fuerza");
});

test("sin historial suficiente lo declara en vez de decir cero", () => {
  const t = totalRecurrenteMensual(datosDePrueba(), HOY);
  assert.equal(t.veredicto.estado, ESTADOS.SIN_DATOS);
  assert.ok(t.veredicto.datos.falta);
});

// --- Tendencia ---

function seisQuincenas(gastos) {
  const inicios = ["2026-06-16", "2026-07-01", "2026-07-16", "2026-08-01", "2026-08-16", "2026-09-01"];
  return conMovimientos(datosDePrueba(), inicios.flatMap((fecha, i) => ([
    { fecha, monto: 800000, tipo: TIPOS.INGRESO },
    { fecha, monto: gastos[i], tipo: TIPOS.GASTO, categoria: "super" },
  ])));
}

test("los seis ciclos vienen del más viejo al más nuevo y cada uno con su etiqueta", () => {
  const p = tendenciaPorCiclo(datosDePrueba(), HOY, 6);
  assert.equal(p.length, 6);
  assert.equal(new Set(p.map((x) => x.corta)).size, 6, "seis etiquetas distintas: si se repiten, la gráfica miente");
  assert.equal(p[5].completo, false, "el ciclo en curso no está cerrado");
});

test("el ciclo en curso no se compara con los cerrados: aún le faltan días", () => {
  const r = resumenTendencia(seisQuincenas([700000, 680000, 650000, 600000, 560000, 10000]), HOY, 6);
  assert.equal(r.veredicto.datos.ciclos, 5, "solo cuentan los cerrados");
});

test("dice que va mejorando cuando de verdad va mejorando", () => {
  const r = resumenTendencia(seisQuincenas([700000, 680000, 650000, 600000, 560000, 0]), HOY, 6);
  assert.equal(r.veredicto.estado, ESTADOS.VA_BIEN);
  assert.ok(r.cambio > 0);
});

test("y no lo maquilla cuando va peor", () => {
  const r = resumenTendencia(seisQuincenas([500000, 560000, 620000, 700000, 760000, 0]), HOY, 6);
  assert.equal(r.veredicto.estado, ESTADOS.AJUSTADO);
  assert.ok(r.cambio < 0);
  assert.match(r.veredicto.motivo, /menos por quincena/);
});

test("con pocos ciclos no adivina: dice cuántos faltan", () => {
  const r = resumenTendencia(datosDePrueba(), HOY, 6);
  assert.equal(r.veredicto.estado, ESTADOS.SIN_DATOS);
  assert.equal(r.cambio, null);
});

// --- Quincenas de colchón ---

test("dice cuántas quincenas duraría lo guardado, medido contra lo que de verdad gasta", () => {
  const base = seisQuincenas([600000, 600000, 600000, 600000, 600000, 0]);
  const datos = conMovimientos(base, [{ fecha: "2026-08-20", monto: 1200000, tipo: TIPOS.AHORRO }]);
  const q = quincenasDeColchon(datos, HOY, 6);
  assert.equal(q.gastoTipico, 600000);
  assert.equal(q.quincenas, 2);
  assert.equal(q.veredicto.estado, ESTADOS.AJUSTADO);
});

test("cuando no alcanza ni para una quincena, lo dice sin suavizarlo", () => {
  const base = seisQuincenas([600000, 600000, 600000, 600000, 600000, 0]);
  const datos = conMovimientos(base, [{ fecha: "2026-08-20", monto: 100000, tipo: TIPOS.AHORRO }]);
  const q = quincenasDeColchon(datos, HOY, 6);
  assert.equal(q.veredicto.estado, ESTADOS.NO_ALCANZA);
  assert.match(q.veredicto.motivo, /no cubre ni una quincena/);
});

test("sin saber cuánto gasta, no calcula un colchón imaginario", () => {
  const q = quincenasDeColchon(datosDePrueba(), HOY, 6);
  assert.equal(q.quincenas, null);
  assert.equal(q.veredicto.estado, ESTADOS.SIN_DATOS);
});

test("los ciclos recientes no se solapan ni dejan huecos", () => {
  const ciclos = ciclosRecientes(datosDePrueba(), HOY, 6);
  for (let i = 1; i < ciclos.length; i++) {
    const finAnterior = new Date(`${ciclos[i - 1].fin}T00:00:00Z`);
    const inicio = new Date(`${ciclos[i].inicio}T00:00:00Z`);
    assert.equal((inicio - finAnterior) / 86400000, 1, "cada ciclo empieza justo al día siguiente del anterior");
  }
});
