import { test } from "node:test";
import assert from "node:assert/strict";
import { planDeMeta, resumenMetas, exigenciaTotal, fechaTrasCiclos } from "../motor/metas.js";
import { ESTADOS } from "../motor/veredicto.js";
import { datosDePrueba, conMovimientos } from "./ayuda.js";

const HOY = "2026-09-08";
const META = { id: "meta_1", nombre: "Fondo de emergencia", objetivo: 2000000, fechaLimite: "2026-12-31", prioridad: 1, lograda: false };

function conMeta(meta = META, extra = {}) {
  return { ...datosDePrueba(), metas: [meta], ...extra };
}

test("una meta es una división: falta entre quincenas que quedan", () => {
  const plan = planDeMeta(conMeta(), META, HOY, 280000);
  assert.equal(plan.falta, 2000000);
  assert.equal(plan.ciclos, 8, "quedan 8 quincenas hasta el 31 de diciembre");
  assert.equal(plan.requerido, 250000, "2,000,000 entre 8");
});

test("si el requerido casi se come la capacidad, la meta va AJUSTADA, no verde", () => {
  const plan = planDeMeta(conMeta(), META, HOY, 280000);
  assert.equal(plan.veredicto.estado, ESTADOS.AJUSTADO, "250,000 de 280,000 no deja holgura");
  assert.equal(plan.veredicto.datos.requerido, 250000);
  assert.equal(plan.veredicto.datos.capacidad, 280000);
});

test("con holgura de sobra la meta va bien", () => {
  assert.equal(planDeMeta(conMeta(), META, HOY, 600000).veredicto.estado, ESTADOS.VA_BIEN);
});

test("si no cabe lo dice, con los dos números y una alternativa calculada", () => {
  const plan = planDeMeta(conMeta(), META, HOY, 150000);
  const v = plan.veredicto;

  assert.equal(v.estado, ESTADOS.NO_ALCANZA);
  assert.equal(v.fuente, "CODIGO");
  assert.match(v.motivo, /requiere \$2,500.00 por quincena, capacidad estimada \$1,500.00/);
  assert.equal(v.datos.alternativa.tipo, "mover-fecha");
  assert.equal(v.datos.alternativa.aportacionPosible, 150000);
  assert.equal(v.datos.alternativa.ciclosNecesarios, 14);
  assert.equal(v.datos.alternativa.fechaRealista, "2027-03-31", "la fecha que sí es posible");
});

test("sin capacidad de ahorro conocida, el requerido igual se calcula y el veredicto se declara", () => {
  const plan = planDeMeta(conMeta(), META, HOY, null);
  assert.equal(plan.requerido, 250000, "esto sí se puede saber");
  assert.equal(plan.veredicto.estado, ESTADOS.SIN_DATOS, "si cabe o no, todavía no");
});

test("una meta sin fecha o sin monto no se inventa el plan", () => {
  const sinFecha = { ...META, fechaLimite: null };
  assert.equal(planDeMeta(conMeta(sinFecha), sinFecha, HOY, 280000).veredicto.estado, ESTADOS.SIN_DATOS);

  const sinMonto = { ...META, objetivo: null };
  assert.equal(planDeMeta(conMeta(sinMonto), sinMonto, HOY, 280000).veredicto.estado, ESTADOS.SIN_DATOS);
});

test("una fecha que ya pasó es NO_ALCANZA, no un plan imposible", () => {
  const vencida = { ...META, fechaLimite: "2026-09-07" };
  const plan = planDeMeta(conMeta(vencida), vencida, HOY, 280000);
  assert.equal(plan.veredicto.estado, ESTADOS.NO_ALCANZA);
  assert.equal(plan.ciclos, 0);
});

test("lo ya apartado cuenta, y al llegar al objetivo la meta se cierra", () => {
  const datos = conMovimientos(conMeta(), [
    { fecha: "2026-09-02", monto: 500000, tipo: "ahorro", metaId: "meta_1" },
    { fecha: "2026-09-02", monto: 400000, tipo: "ahorro", metaId: "otra" },
  ]);
  const plan = planDeMeta(datos, META, HOY, 280000);
  assert.equal(plan.ahorrado, 500000, "lo de otra meta no se cuenta aquí");
  assert.equal(plan.falta, 1500000);

  const completa = conMovimientos(conMeta(), [{ fecha: "2026-09-02", monto: 2000000, tipo: "ahorro", metaId: "meta_1" }]);
  assert.equal(planDeMeta(completa, META, HOY, 280000).veredicto.estado, ESTADOS.VA_BIEN);
});

test("sin capacidad (o con capacidad negativa) ninguna meta se pinta de verde", () => {
  const plan = planDeMeta(conMeta(), META, HOY, -5000);
  assert.equal(plan.veredicto.estado, ESTADOS.NO_ALCANZA);
  assert.equal(plan.veredicto.datos.alternativa.tipo, "sin-capacidad");
});

test("el resumen pone primero las metas que no cierran", () => {
  const imposible = { ...META, id: "meta_2", nombre: "Coche", objetivo: 30000000 };
  const datos = { ...datosDePrueba(), metas: [META, imposible] };
  const filas = resumenMetas(datos, HOY, 280000);
  assert.equal(filas[0].meta.id, "meta_2");
});

test("exigenciaTotal compara TODAS las metas juntas contra la capacidad", () => {
  const otra = { ...META, id: "meta_2", nombre: "Viaje", objetivo: 800000 };
  const datos = { ...datosDePrueba(), metas: [META, otra] };
  const planes = resumenMetas(datos, HOY, 280000);
  const total = exigenciaTotal(planes, 280000);

  assert.equal(total.requerido, 350000, "250,000 + 100,000");
  assert.equal(total.veredicto.estado, ESTADOS.NO_ALCANZA, "cada meta puede caber sola y no caber junta");
});

test("fechaTrasCiclos cae siempre en un cierre de quincena", () => {
  assert.equal(fechaTrasCiclos(HOY, 1), "2026-09-15");
  assert.equal(fechaTrasCiclos(HOY, 2), "2026-09-30");
  assert.equal(fechaTrasCiclos(HOY, 8), "2026-12-31");
});
