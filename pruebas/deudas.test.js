import { test } from "node:test";
import assert from "node:assert/strict";
import { planDeDeuda, pagoMensualDe, siPagarasMas } from "../motor/deudas.js";
import { ESTADOS } from "../motor/veredicto.js";
import { datosDePrueba, conMovimientos } from "./ayuda.js";

const DEUDA = { id: "d1", nombre: "Tarjeta", montoOriginal: 3000000, tasaAnual: 60, diaCorte: 20, activa: true };

function conDeuda(deuda = DEUDA, fijos = []) {
  return datosDePrueba({ deudas: [deuda], fijos });
}

test("sin tasa capturada no se proyecta ningún interés: se declara", () => {
  const sinTasa = { ...DEUDA, tasaAnual: null };
  const plan = planDeDeuda(conDeuda(sinTasa), sinTasa);
  assert.equal(plan.veredicto.estado, ESTADOS.SIN_DATOS);
  assert.match(plan.veredicto.motivo, /sin intereses/);
  assert.equal(plan.meses, null, "ni meses, ni intereses inventados");
});

test("con tasa pero sin saber cuánto pagas al mes, tampoco se proyecta", () => {
  const plan = planDeDeuda(conDeuda(), DEUDA);
  assert.equal(plan.veredicto.estado, ESTADOS.SIN_DATOS);
  assert.match(plan.veredicto.datos.falta, /liga un pago fijo/);
});

test("el pago mensual sale del fijo ligado a la deuda", () => {
  const fijo = { id: "f1", nombre: "Pago tarjeta", monto: 150000, diaCorte: 20, deudaId: "d1" };
  const pago = pagoMensualDe(conDeuda(DEUDA, [fijo]), DEUDA);
  assert.equal(pago.monto, 150000);
  assert.equal(pago.origen, "fijo");
});

test("si el pago no cubre ni el interés del mes, lo dice sin rodeos", () => {
  // 30,000 al 60% anual generan 1,500 de interés al mes. Pagando 1,000, la deuda crece.
  const fijo = { id: "f1", nombre: "Pago mínimo", monto: 100000, diaCorte: 20, deudaId: "d1" };
  const plan = planDeDeuda(conDeuda(DEUDA, [fijo]), DEUDA);

  assert.equal(plan.veredicto.estado, ESTADOS.NO_ALCANZA);
  assert.equal(plan.interesDelMes, 150000);
  assert.match(plan.veredicto.motivo, /NUNCA baja/);
});

test("con un pago que sí alcanza, proyecta meses e intereses y declara su supuesto", () => {
  const fijo = { id: "f1", nombre: "Pago tarjeta", monto: 300000, diaCorte: 20, deudaId: "d1" };
  const plan = planDeDeuda(conDeuda(DEUDA, [fijo]), DEUDA);

  assert.ok(plan.meses > 0 && plan.meses < 24, `liquidada en ${plan.meses} meses`);
  assert.ok(plan.intereses > 0);
  assert.match(plan.veredicto.motivo, /sin comisiones ni IVA/, "la proyección dice sobre qué se sostiene");
  assert.equal(plan.veredicto.datos.tasaAnual, 60);
});

test("los pagos ya hechos bajan el saldo antes de proyectar", () => {
  const fijo = { id: "f1", nombre: "Pago tarjeta", monto: 300000, diaCorte: 20, deudaId: "d1" };
  const base = conDeuda(DEUDA, [fijo]);
  const conPagos = conMovimientos(base, [
    { fecha: "2026-08-20", monto: 300000, tipo: "gasto", categoria: "deuda", deudaId: "d1" },
    { fecha: "2026-09-20", monto: 300000, tipo: "gasto", categoria: "deuda", deudaId: "d1" },
  ]);

  const antes = planDeDeuda(base, DEUDA);
  const despues = planDeDeuda(conPagos, DEUDA);
  assert.equal(despues.saldo, 2400000);
  assert.ok(despues.meses < antes.meses, "y quedan menos meses");
});

test("pagar de más acorta la deuda, y dice cuánto", () => {
  const fijo = { id: "f1", nombre: "Pago tarjeta", monto: 300000, diaCorte: 20, deudaId: "d1" };
  const mejora = siPagarasMas(conDeuda(DEUDA, [fijo]), DEUDA, 100000);
  assert.ok(mejora.mesesMenos > 0);
  assert.ok(mejora.interesesMenos > 0);
});

test("una deuda liquidada no proyecta nada", () => {
  const fijo = { id: "f1", nombre: "Pago tarjeta", monto: 300000, diaCorte: 20, deudaId: "d1" };
  const datos = conMovimientos(conDeuda(DEUDA, [fijo]), [
    { fecha: "2026-09-01", monto: 3000000, tipo: "gasto", categoria: "deuda", deudaId: "d1" },
  ]);
  const plan = planDeDeuda(datos, DEUDA);
  assert.equal(plan.saldo, 0);
  assert.equal(plan.veredicto.estado, ESTADOS.VA_BIEN);
});
