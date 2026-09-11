// Tarjetas — que las dos fechas caigan donde deben, y que nada se cuente dos veces.
//
// Lo que más se prueba aquí es el calendario, porque de él cuelga todo lo demás: si el corte
// cae un día tarde, el estado de cuenta entero cambia de mes y la cifra grande de la pantalla
// —lo que hay que pagar para no generar intereses— deja de ser verdad.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  periodoDeCorte, periodoAnterior, saldoTarjeta, estadoDeCorte, cargosDelPeriodo, creditoUsado,
  siSoloPagas, interesDeNoPagar, historialDeCortes, tarjetasPorUrgencia, proximosLimites,
  calendarioDelMes, resumenTarjetas,
} from "../motor/tarjetas.js";
import { normalizarTarjeta, normalizarPlazo, TIPOS } from "../motor/modelo.js";
import { panelHoy } from "../motor/ahorro.js";
import { recordatoriosDeHoy } from "../motor/recordatorios.js";
import { esISO, diasEntre, sumarDias } from "../motor/ciclo.js";
import { ESTADOS } from "../motor/veredicto.js";
import { datosDePrueba, conMovimientos } from "./ayuda.js";

const tarjeta = (extra = {}) =>
  normalizarTarjeta({
    id: "t1", nombre: "Nu", ultimos4: "4574", limite: 3000000, diaCorte: 5, diaLimite: 25,
    tasaAnual: null, saldoInicial: 0, saldoInicialDesde: "2026-02-05", activa: true, ...extra,
  });

const conTarjeta = (t, extra = {}) => ({ ...datosDePrueba(), tarjetas: [t], plazos: [], ...extra });

const cargo = (fecha, monto, extra = {}) =>
  ({ fecha, monto, tipo: TIPOS.GASTO, categoria: "super", tarjetaId: "t1", ...extra });
const pago = (fecha, monto, extra = {}) =>
  ({ fecha, monto, tipo: TIPOS.PAGO, tarjetaId: "t1", ...extra });

// --- El calendario: corte y fecha límite ---

test("corte 5 y límite 25: el periodo va del 6 al 5 y se paga ese mismo mes", () => {
  const t = tarjeta();
  const p = periodoDeCorte(t, "2026-03-01");
  assert.equal(p.inicio, "2026-02-06");
  assert.equal(p.corte, "2026-03-05");
  assert.equal(p.limite, "2026-03-25");

  // El día del corte todavía pertenece al periodo que cierra; el siguiente ya no.
  assert.equal(periodoDeCorte(t, "2026-03-05").corte, "2026-03-05");
  assert.equal(periodoDeCorte(t, "2026-03-06").corte, "2026-04-05");
});

test("corte 28 y límite 17: la fecha límite se va sola al mes siguiente", () => {
  // Sin preguntarle a nadie cuál de los dos casos es: el límite es su primera aparición
  // POSTERIOR al corte, y con eso los dos patrones salen de la misma regla.
  const t = tarjeta({ diaCorte: 28, diaLimite: 17 });
  const p = periodoDeCorte(t, "2026-01-15");
  assert.equal(p.corte, "2026-01-28");
  assert.equal(p.limite, "2026-02-17");
  assert.ok(p.limite > p.corte);
});

test("un corte el 31 cae el 28 en febrero, y no deja hueco con marzo", () => {
  const t = tarjeta({ diaCorte: 31, diaLimite: 20 });
  const feb = periodoDeCorte(t, "2026-02-10");
  assert.equal(feb.corte, "2026-02-28");
  assert.equal(feb.limite, "2026-03-20");

  const mar = periodoDeCorte(t, "2026-03-01");
  assert.equal(mar.inicio, "2026-03-01", "el periodo siguiente empieza justo al día siguiente");
  assert.equal(mar.corte, "2026-03-31");
});

test("el periodo anterior es el que ya cerró: el que hay que pagar", () => {
  const t = tarjeta();
  const abierto = periodoDeCorte(t, "2026-03-10");
  const cerrado = periodoAnterior(t, abierto);
  assert.equal(abierto.inicio, "2026-03-06");
  assert.equal(cerrado.corte, "2026-03-05");
  assert.equal(sumarDias(cerrado.corte, 1), abierto.inicio, "ni hueco ni traslape");
});

// --- El saldo y el corte ---

test("lo comprado antes del corte se cobra; lo de después espera al siguiente", () => {
  const datos = conMovimientos(conTarjeta(tarjeta()), [
    cargo("2026-02-20", 150000),
    cargo("2026-03-03", 100000),
    cargo("2026-03-08", 50000), // después del corte del 5
  ]);
  const e = estadoDeCorte(datos, datos.tarjetas[0], "2026-03-10");

  assert.equal(e.corte, "2026-03-05");
  assert.equal(e.saldoAlCorte, 250000, "solo lo de antes del corte");
  assert.equal(e.porPagar, 250000);
  assert.equal(e.desdeElCorte, 50000, "esto no se cobra todavía");
  assert.equal(e.proximoCorte, "2026-04-05");
  assert.equal(e.saldo, 300000, "el saldo SÍ lo incluye — por eso no es la cifra que se paga");
  assert.equal(e.fechaLimite, "2026-03-25");
  assert.equal(e.diasParaPagar, 15);
  assert.equal(e.vencido, false);
});

test("una compra el día del corte entra; la del día siguiente, no", () => {
  const dentro = conMovimientos(conTarjeta(tarjeta()), [cargo("2026-03-05", 10000)]);
  const fuera = conMovimientos(conTarjeta(tarjeta()), [cargo("2026-03-06", 10000)]);
  assert.equal(estadoDeCorte(dentro, dentro.tarjetas[0], "2026-03-10").porPagar, 10000);
  assert.equal(estadoDeCorte(fuera, fuera.tarjetas[0], "2026-03-10").porPagar, 0);
  assert.equal(estadoDeCorte(fuera, fuera.tarjetas[0], "2026-03-10").desdeElCorte, 10000);
});

test("un pago después del corte baja lo que falta por pagar, no el corte", () => {
  const datos = conMovimientos(conTarjeta(tarjeta()), [
    cargo("2026-03-03", 250000),
    pago("2026-03-15", 200000),
  ]);
  const e = estadoDeCorte(datos, datos.tarjetas[0], "2026-03-16");
  assert.equal(e.saldoAlCorte, 250000, "el corte ya cerró: no se reescribe");
  assert.equal(e.abonado, 200000);
  assert.equal(e.porPagar, 50000);
  assert.equal(e.saldo, 50000);
});

test("pagado completo lo dice, y no queda un número negativo suelto", () => {
  const datos = conMovimientos(conTarjeta(tarjeta()), [
    cargo("2026-03-03", 250000),
    pago("2026-03-15", 300000), // pagó de más
  ]);
  const e = estadoDeCorte(datos, datos.tarjetas[0], "2026-03-16");
  assert.equal(e.porPagar, 0, "nunca negativo");
  assert.equal(e.veredicto.estado, ESTADOS.VA_BIEN);
  assert.match(e.veredicto.motivo, /no vas a generar intereses/);
});

test("pasada la fecha límite con saldo, se declara vencida", () => {
  const datos = conMovimientos(conTarjeta(tarjeta()), [cargo("2026-03-03", 250000)]);
  const e = estadoDeCorte(datos, datos.tarjetas[0], "2026-03-28");
  assert.equal(e.vencido, true);
  assert.equal(e.veredicto.estado, ESTADOS.NO_ALCANZA);
  assert.match(e.veredicto.motivo, /se pasó hace 3 días/);
});

// --- Declarar la ignorancia ---

test("sin saldo inicial no hay saldo: se declara, nunca sale $0.00", () => {
  const t = tarjeta({ saldoInicial: null });
  const datos = conMovimientos(conTarjeta(t), [cargo("2026-03-03", 250000)]);
  const s = saldoTarjeta(datos, t, "2026-03-10");
  assert.equal(s.saldo, null, "null es 'no hay dato', que no es cero");
  assert.equal(s.veredicto.estado, ESTADOS.SIN_DATOS);

  const e = estadoDeCorte(datos, t, "2026-03-10");
  assert.equal(e.porPagar, null);
  assert.equal(e.saldoAlCorte, null);
  assert.equal(e.vencido, false, "sin saldo no se puede declarar vencida");
});

test("sin fecha del saldo inicial tampoco, porque no se sabe qué ya estaba contado", () => {
  const t = tarjeta({ saldoInicial: 500000, saldoInicialDesde: null });
  assert.equal(saldoTarjeta(conTarjeta(t), t, "2026-03-10").saldo, null);
});

test("sin límite capturado no hay porcentaje de utilización", () => {
  const t = tarjeta({ limite: null });
  const c = creditoUsado(conTarjeta(t), t, "2026-03-10");
  assert.equal(c.utilizacion, null);
  assert.equal(c.disponible, null);
  assert.equal(c.veredicto.estado, ESTADOS.SIN_DATOS);
});

test("sin tasa capturada NO se proyecta ni un peso de interés", () => {
  const t = tarjeta({ tasaAnual: null });
  const datos = conMovimientos(conTarjeta(t), [cargo("2026-03-03", 250000)]);
  assert.equal(interesDeNoPagar(datos, t, "2026-03-10"), null);
  const r = siSoloPagas(datos, t, 50000, "2026-03-10");
  assert.equal(r.meses, null);
  assert.equal(r.intereses, null);
  assert.equal(r.veredicto.estado, ESTADOS.SIN_DATOS);
  assert.match(r.veredicto.motivo, /no hay tasa capturada/);
});

test("con tasa, dice lo que cuesta revolver — y el caso en que nunca baja", () => {
  const t = tarjeta({ tasaAnual: 60 });
  const datos = conMovimientos(conTarjeta(t), [cargo("2026-03-03", 1000000)]);

  const razonable = siSoloPagas(datos, t, 200000, "2026-03-10");
  assert.ok(razonable.meses > 0);
  assert.ok(razonable.intereses > 0, "los intereses nunca salen negativos");
  assert.match(razonable.veredicto.motivo, /sobre TODO el saldo/);

  const miseria = siSoloPagas(datos, t, 10000, "2026-03-10");
  assert.equal(miseria.meses, null);
  assert.match(miseria.veredicto.motivo, /NUNCA baja/);
  assert.equal(miseria.veredicto.estado, ESTADOS.NO_ALCANZA);
});

test("la utilización se juzga contra el límite, y el sobregiro se dice", () => {
  const t = tarjeta({ limite: 1000000 });
  const poco = conMovimientos(conTarjeta(t), [cargo("2026-03-03", 200000)]);
  assert.equal(creditoUsado(poco, t, "2026-03-10").utilizacion, 20);
  assert.equal(creditoUsado(poco, t, "2026-03-10").veredicto.estado, ESTADOS.VA_BIEN);

  const mucho = conMovimientos(conTarjeta(t), [cargo("2026-03-03", 500000)]);
  assert.equal(creditoUsado(mucho, t, "2026-03-10").veredicto.estado, ESTADOS.AJUSTADO);
  assert.match(creditoUsado(mucho, t, "2026-03-10").veredicto.motivo, /historial de crédito/);

  const pasado = conMovimientos(conTarjeta(t), [cargo("2026-03-03", 1200000)]);
  assert.match(creditoUsado(pasado, t, "2026-03-10").veredicto.motivo, /pasaste tu límite/);
});

// --- Un pago no es un gasto ---

test("un pago a la tarjeta NO toca el disponible de la quincena", () => {
  // El gasto fue cuando compraste y ya se descontó de aquel ciclo. Contarlo otra vez al pagar
  // dejaba la quincena del pago en rojo sin haber gastado un peso de más.
  const base = conMovimientos(conTarjeta(tarjeta()), [cargo("2026-03-03", 100000)]);
  const conPago = conMovimientos(base, [pago("2026-03-10", 100000)]);

  const antes = panelHoy(base, "2026-03-12");
  const despues = panelHoy(conPago, "2026-03-12");
  assert.equal(antes.disponible, despues.disponible, "el pago no vuelve a descontar");
  assert.equal(despues.gasto.total, antes.gasto.total);
});

test("un pago no lleva categoría, así que no ensucia el presupuesto", () => {
  const datos = conMovimientos(conTarjeta(tarjeta()), [pago("2026-03-10", 100000, { categoria: "super" })]);
  const m = datos.movimientos["2026-03"][0];
  assert.equal(m.tipo, TIPOS.PAGO);
  assert.equal(m.categoria, null, "aunque se la manden, se tira");
});

// --- Compras a meses en el estado de cuenta ---

test("la mensualidad de un MSI cae en el corte y sube el saldo", () => {
  const datos = {
    ...conTarjeta(tarjeta({ saldoInicialDesde: "2025-12-31" })),
    plazos: [normalizarPlazo({
      id: "p1", tarjetaId: "t1", nombre: "Refri", montoTotal: 1200000, meses: 12,
      primerCargo: "2026-01", categoria: "casa",
    })],
  };
  // A marzo van tres cortes (ene, feb, mar), o sea tres mensualidades de $1,000.
  const e = estadoDeCorte(datos, datos.tarjetas[0], "2026-03-10");
  assert.equal(e.saldoAlCorte, 300000);
  assert.equal(e.porPagar, 300000);
});

test("la anualidad cae en su mes, una vez al año y ni una más", () => {
  const t = tarjeta({ saldoInicialDesde: "2025-12-31", anualidad: 90000, mesAnualidad: 6 });
  const datos = conTarjeta(t);
  assert.equal(saldoTarjeta(datos, t, "2026-05-31").saldo, 0, "antes de junio, nada");
  assert.equal(saldoTarjeta(datos, t, "2026-06-30").saldo, 90000);
  assert.equal(saldoTarjeta(datos, t, "2026-12-31").saldo, 90000, "no se cobra dos veces el mismo año");
  assert.equal(saldoTarjeta(datos, t, "2027-06-30").saldo, 180000, "y al año siguiente otra vez");
});

// --- Cómo vas pagando ---

test("el historial de cortes dice cuántos se pagaron completos, sin regañar", () => {
  const datos = conMovimientos(conTarjeta(tarjeta({ saldoInicialDesde: "2025-12-31" })), [
    cargo("2026-01-03", 100000), pago("2026-01-20", 100000), // completo
    cargo("2026-02-03", 100000),                              // sin pagar
    cargo("2026-03-03", 100000), pago("2026-03-20", 200000),  // se puso al día
  ]);
  const h = historialDeCortes(datos, datos.tarjetas[0], "2026-04-10", 6);
  const juzgados = h.cortes.filter((c) => !c.enCurso);
  assert.ok(juzgados.length >= 3);
  assert.equal(h.revisables, juzgados.length);
  assert.match(h.veredicto.motivo, /pagaste completo/);
});

test("sin cortes cerrados todavía, se dice en vez de inventar una racha", () => {
  const t = tarjeta({ saldoInicialDesde: "2026-03-01" });
  const h = historialDeCortes(conTarjeta(t), t, "2026-03-10", 6);
  assert.equal(h.revisables, 0);
  assert.equal(h.veredicto.estado, ESTADOS.SIN_DATOS);
});

// --- Las vistas de conjunto ---

test("las tarjetas se ordenan por urgencia: lo vencido primero", () => {
  const alDia = normalizarTarjeta({ id: "t2", nombre: "Al día", diaCorte: 5, diaLimite: 25,
    saldoInicial: 0, saldoInicialDesde: "2026-02-05", activa: true });
  const datos = conMovimientos(
    { ...datosDePrueba(), tarjetas: [alDia, tarjeta()], plazos: [] },
    [cargo("2026-03-03", 250000)],
  );
  const orden = tarjetasPorUrgencia(datos, "2026-03-28");
  assert.equal(orden[0].tarjeta.id, "t1", "la vencida va arriba");
  assert.equal(orden[0].corte.vencido, true);
});

test("próximos límites solo trae lo que de verdad hay que pagar", () => {
  const sinDeuda = conTarjeta(tarjeta());
  assert.equal(proximosLimites(sinDeuda, "2026-03-24", 7).length, 0, "al corriente no es pendiente");

  const conDeuda = conMovimientos(conTarjeta(tarjeta()), [cargo("2026-03-03", 250000)]);
  const proximos = proximosLimites(conDeuda, "2026-03-24", 7);
  assert.equal(proximos.length, 1);
  assert.equal(proximos[0].monto, 250000);
  assert.equal(proximos[0].dias, 1);
});

test("el calendario del mes ordena cortes y pagos de todas las tarjetas", () => {
  const otra = normalizarTarjeta({ id: "t2", nombre: "Banorte", diaCorte: 28, diaLimite: 17,
    saldoInicial: 0, saldoInicialDesde: "2026-01-01", activa: true });
  const datos = { ...datosDePrueba(), tarjetas: [tarjeta(), otra], plazos: [] };
  const eventos = calendarioDelMes(datos, "2026-03-01", 45);

  assert.ok(eventos.length >= 3);
  for (let i = 1; i < eventos.length; i++) {
    assert.ok(eventos[i - 1].fecha <= eventos[i].fecha, "van en orden de fecha");
  }
  assert.ok(eventos.every((e) => e.fecha >= "2026-03-01" && esISO(e.fecha)));
});

test("el resumen declara las tarjetas sin saldo en vez de sumarlas como cero", () => {
  const muda = normalizarTarjeta({ id: "t2", nombre: "Sin capturar", diaCorte: 5, diaLimite: 25,
    saldoInicial: null, activa: true });
  const datos = conMovimientos(
    { ...datosDePrueba(), tarjetas: [tarjeta(), muda], plazos: [] },
    [cargo("2026-03-03", 250000)],
  );
  const r = resumenTarjetas(datos, "2026-03-10");
  assert.equal(r.deuda, 250000, "solo lo que se puede contar");
  assert.deepEqual(r.sinSaldo, ["Sin capturar"]);
  assert.equal(r.veredicto.estado, ESTADOS.SIN_DATOS);
});

test("sin ninguna tarjeta, el resumen lo dice y no enseña ceros", () => {
  const r = resumenTarjetas(datosDePrueba(), "2026-03-10");
  assert.equal(r.cuantas, 0);
  assert.equal(r.proximo, null);
  assert.equal(r.veredicto.estado, ESTADOS.SIN_DATOS);
});

// --- El recordatorio ---

test("la fecha límite avisa el día antes, y solo si queda algo por pagar", () => {
  const conDeuda = conMovimientos(conTarjeta(tarjeta()), [cargo("2026-03-03", 250000)]);
  const avisos = recordatoriosDeHoy(conDeuda, "2026-03-24");
  const suyo = avisos.find((a) => a.clave.startsWith("tarjeta:"));
  assert.ok(suyo, "avisa la víspera");
  assert.match(suyo.titulo, /Mañana vence tu Nu/);
  assert.match(suyo.cuerpo, /para no generar intereses/);

  const pagada = conMovimientos(conDeuda, [pago("2026-03-20", 250000)]);
  assert.equal(recordatoriosDeHoy(pagada, "2026-03-24").filter((a) => a.clave.startsWith("tarjeta:")).length, 0,
    "una tarjeta al corriente no interrumpe a nadie");
});

// --- Invariantes ---

function dado(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test("para cualquier corte y cualquier fecha, el periodo es válido y único", () => {
  const azar = dado(20260911);
  for (let i = 0; i < 2000; i++) {
    const t = tarjeta({
      diaCorte: 1 + Math.floor(azar() * 31),
      diaLimite: 1 + Math.floor(azar() * 31),
    });
    const anio = 2026 + Math.floor(azar() * 3);
    const mes = 1 + Math.floor(azar() * 12);
    const dia = 1 + Math.floor(azar() * 28);
    const iso = `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

    const p = periodoDeCorte(t, iso);
    assert.ok(esISO(p.inicio) && esISO(p.corte) && esISO(p.limite), `fechas de calendario en ${iso}`);
    assert.ok(p.limite > p.corte, `la fecha límite SIEMPRE va después del corte (${iso})`);
    assert.ok(p.inicio <= iso && iso <= p.corte, `${iso} cae dentro de su propio periodo`);
    assert.ok(p.dias >= 27 && p.dias <= 32, `un periodo dura un mes, no ${p.dias} días`);

    // Ni hueco ni traslape: el periodo siguiente empieza justo al día después del corte.
    const siguiente = periodoDeCorte(t, sumarDias(p.corte, 1));
    assert.equal(siguiente.inicio, sumarDias(p.corte, 1), `hueco o traslape en ${iso}`);
    // Y el anterior cierra justo el día antes de que empiece éste.
    assert.equal(sumarDias(periodoAnterior(t, p).corte, 1), p.inicio, `el anterior no pega en ${iso}`);
  }
});

test("nunca se proyecta un interés sin tasa, ni un saldo sin saldo inicial", () => {
  const azar = dado(777);
  for (let i = 0; i < 500; i++) {
    const conTasa = azar() > 0.5;
    const conSaldo = azar() > 0.5;
    const t = tarjeta({
      tasaAnual: conTasa ? 1 + azar() * 120 : null,
      saldoInicial: conSaldo ? Math.floor(azar() * 5000000) : null,
      diaCorte: 1 + Math.floor(azar() * 28),
      diaLimite: 1 + Math.floor(azar() * 28),
    });
    const datos = conMovimientos(conTarjeta(t), [cargo("2026-03-03", 1 + Math.floor(azar() * 900000))]);
    const e = estadoDeCorte(datos, t, "2026-03-20");

    if (!conSaldo) {
      assert.equal(e.saldo, null, "sin saldo inicial no hay saldo");
      assert.equal(e.porPagar, null);
      assert.equal(interesDeNoPagar(datos, t, "2026-03-20"), null);
    } else {
      assert.ok(e.porPagar >= 0, "lo que falta por pagar nunca es negativo");
      assert.ok(e.desdeElCorte >= 0);
    }
    if (!conTasa) assert.equal(interesDeNoPagar(datos, t, "2026-03-20"), null, "sin tasa, ni un peso");

    const r = siSoloPagas(datos, t, 50000, "2026-03-20");
    if (r && r.intereses !== null) assert.ok(r.intereses >= 0, "los intereses nunca son negativos");
  }
});
