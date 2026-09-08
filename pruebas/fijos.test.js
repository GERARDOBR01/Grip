import { test } from "node:test";
import assert from "node:assert/strict";
import {
  proximosVencimientos, totalFijosMensual, saldoDeuda, totalDeudas, pagoDeFijo, movimientoDeFijo,
  venceEnMes, montoMensualizado,
} from "../motor/fijos.js";
import { ESTADOS } from "../motor/veredicto.js";
import { datosDePrueba, conMovimientos } from "./ayuda.js";

const HOY = "2026-09-08";

test("lo vencido y no pagado sigue apareciendo: es justo lo que no hay que olvidar", () => {
  const v = proximosVencimientos(datosDePrueba(), HOY, 15);
  assert.equal(v.length, 2);
  assert.equal(v[0].fijo.nombre, "Renta");
  assert.equal(v[0].dias, -3);
  assert.equal(v[0].vencido, true);
  assert.equal(v[1].fijo.nombre, "Internet");
  assert.equal(v[1].dias, 2);
});

test("un fijo ya pagado este mes desaparece de la lista", () => {
  const datos = conMovimientos(datosDePrueba(), [
    { fecha: "2026-09-05", monto: 500000, tipo: "gasto", categoria: "casa", fijoId: "f_renta" },
  ]);
  const v = proximosVencimientos(datos, HOY, 15);
  assert.equal(v.length, 1);
  assert.equal(v[0].fijo.nombre, "Internet");
  assert.ok(pagoDeFijo(datos, "f_renta", "2026-09"));
});

test("la ventana de días se respeta", () => {
  assert.equal(proximosVencimientos(datosDePrueba(), HOY, 1).length, 1, "solo la renta vencida");
  assert.ok(proximosVencimientos(datosDePrueba(), HOY, 40).length >= 3, "con más ventana entra el mes siguiente");
});

test("el total de fijos nombra los que no pudo sumar", () => {
  const t = totalFijosMensual(datosDePrueba({
    fijos: [
      { id: "f1", nombre: "Renta", monto: 500000, diaCorte: 5 },
      { id: "f2", nombre: "Gimnasio", monto: null, diaCorte: 3 },
    ],
  }));
  assert.equal(t.total, 500000);
  assert.deepEqual(t.desconocidos, ["Gimnasio"]);
  assert.match(t.veredicto.datos.falta, /Gimnasio/);
});

test("sin tasa capturada NO se proyecta interés: se declara", () => {
  const deuda = { id: "d1", nombre: "Tarjeta", montoOriginal: 1000000, tasaAnual: null, diaCorte: 20, activa: true };
  const datos = conMovimientos({ ...datosDePrueba(), deudas: [deuda] }, [
    { fecha: "2026-09-03", monto: 200000, tipo: "gasto", categoria: "deuda", deudaId: "d1" },
  ]);

  const s = saldoDeuda(datos, deuda);
  assert.equal(s.pagado, 200000);
  assert.equal(s.saldo, 800000);
  assert.match(s.veredicto.motivo, /sin intereses/);
  assert.equal(s.veredicto.datos.tasaAnual, null);
  assert.equal(totalDeudas(datos).conIntereses, false, "quien lea el total sabe que es sin intereses");
});

test("una deuda sin monto original no tiene saldo que inventar", () => {
  const deuda = { id: "d2", nombre: "Préstamo", montoOriginal: null, tasaAnual: null, diaCorte: 1, activa: true };
  const s = saldoDeuda({ ...datosDePrueba(), deudas: [deuda] }, deuda);
  assert.equal(s.saldo, null);
  assert.equal(s.veredicto.estado, ESTADOS.SIN_DATOS);
});

test("marcar un fijo como pagado produce el movimiento que lo comprueba", () => {
  const fijo = datosDePrueba().fijos[0];
  const mov = movimientoDeFijo(fijo, HOY);
  assert.equal(mov.monto, 500000);
  assert.equal(mov.fijoId, fijo.id);
  assert.equal(mov.tipo, "gasto");
});

// --- Pagos que no son mensuales ---
//
// Antes todo fijo se sumaba como si fuera mensual. Un seguro anual de 12,000 aparecía como
// 12,000 al mes y se comía la capacidad de ahorro de todas las quincenas del año.

test("un fijo anual solo vence en su mes", () => {
  const seguro = { id: "f_seg", nombre: "Seguro del coche", monto: 1200000, diaCorte: 10, frecuencia: 12, mesAncla: "2026-03" };
  assert.equal(venceEnMes(seguro, "2026-03"), true);
  assert.equal(venceEnMes(seguro, "2026-09"), false);
  assert.equal(venceEnMes(seguro, "2027-03"), true, "y vuelve al año siguiente");
  assert.equal(venceEnMes(seguro, "2025-03"), true, "también hacia atrás");
});

test("uno bimestral cae mes sí, mes no", () => {
  const agua = { id: "f_agua", nombre: "Agua", monto: 60000, diaCorte: 15, frecuencia: 2, mesAncla: "2026-09" };
  assert.deepEqual(
    ["2026-09", "2026-10", "2026-11", "2026-12"].map((m) => venceEnMes(agua, m)),
    [true, false, true, false],
  );
});

test("sin frecuencia, un fijo es mensual como siempre", () => {
  assert.equal(venceEnMes({ frecuencia: 1 }, "2026-09"), true);
  assert.equal(venceEnMes({}, "2026-09"), true);
});

test("el total separa el promedio mensual de lo que se paga este mes", () => {
  const datos = datosDePrueba({
    fijos: [
      { id: "f1", nombre: "Renta", monto: 500000, diaCorte: 5 },
      { id: "f2", nombre: "Seguro", monto: 1200000, diaCorte: 10, frecuencia: 12, mesAncla: "2026-03" },
    ],
  });

  const enSeptiembre = totalFijosMensual(datos, "2026-09-08");
  assert.equal(enSeptiembre.mensualizado, 600000, "renta 5,000 + seguro 12,000/12 = 6,000 al mes");
  assert.equal(enSeptiembre.esteMes, 500000, "pero en septiembre solo se paga la renta");

  const enMarzo = totalFijosMensual(datos, "2026-03-08");
  assert.equal(enMarzo.esteMes, 1700000, "en marzo sí sale el seguro completo");
  assert.equal(enMarzo.mensualizado, 600000, "el promedio no cambia");
});

test("el seguro anual no aparece en los vencimientos de un mes que no le toca", () => {
  const datos = datosDePrueba({
    fijos: [{ id: "f2", nombre: "Seguro", monto: 1200000, diaCorte: 10, frecuencia: 12, mesAncla: "2026-03" }],
  });
  assert.equal(proximosVencimientos(datos, "2026-09-08", 15).length, 0);
  assert.equal(proximosVencimientos(datos, "2026-03-08", 15).length, 1);
});

// --- Un fijo que abona a su deuda ---

test("marcar pagado un fijo ligado a una deuda la abona: un solo registro, no dos", () => {
  const deuda = { id: "d1", nombre: "Coche", montoOriginal: 6000000, tasaAnual: null, diaCorte: 5, activa: true };
  const fijo = { id: "f_coche", nombre: "Mensualidad del coche", monto: 500000, diaCorte: 5, categoria: "deuda", deudaId: "d1" };
  const base = datosDePrueba({ fijos: [fijo], deudas: [deuda] });

  const movimiento = movimientoDeFijo(base.fijos[0], "2026-09-05");
  assert.equal(movimiento.deudaId, "d1");

  const datos = conMovimientos(base, [movimiento]);
  const s = saldoDeuda(datos, base.deudas[0]);
  assert.equal(s.pagado, 500000);
  assert.equal(s.saldo, 5500000, "el saldo bajó con el mismo movimiento que pagó el fijo");
  assert.ok(pagoDeFijo(datos, "f_coche", "2026-09"), "y el fijo cuenta como pagado");
});
