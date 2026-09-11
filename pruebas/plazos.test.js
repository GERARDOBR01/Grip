// Plazos — que una compra a meses cuadre al centavo y termine cuando dice que termina.
//
// El caso que más importa aquí no es el bonito: es que 12 mensualidades de una compra que no
// se divide en redondo sumen EXACTAMENTE lo que costó. Un MSI que no cuadra al peso con el
// estado de cuenta no sirve para nada, porque ése es justo el número que se va a comparar.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mensualidadesDe, mensualidadEnMes, mensualidadesCargadas, cargadoHasta, mesesRestantes,
  saldoPlazo, porCargarDesde, sigueViva, ultimoMes, comprometidoAMeses, calendarioMSI,
} from "../motor/plazos.js";
import { normalizarPlazo } from "../motor/modelo.js";
import { ESTADOS } from "../motor/veredicto.js";
import { datosDePrueba } from "./ayuda.js";

const compra = (extra = {}) =>
  normalizarPlazo({
    tarjetaId: "t1", nombre: "Refri", montoTotal: 1200000, meses: 12, primerCargo: "2026-01",
    categoria: "casa", ...extra,
  });

test("las mensualidades suman EXACTAMENTE el total, se divida en redondo o no", () => {
  for (const [total, meses] of [[1200000, 12], [1000000, 7], [99999, 6], [1, 3], [333333, 18]]) {
    const partes = mensualidadesDe(compra({ montoTotal: total, meses }));
    assert.equal(partes.length, meses);
    assert.equal(partes.reduce((a, b) => a + b, 0), total, `${total} entre ${meses} no cuadra`);
  }
});

test("sin monto capturado no hay mensualidades que inventar", () => {
  assert.deepEqual(mensualidadesDe(compra({ montoTotal: null })), []);
  assert.equal(mensualidadEnMes(compra({ montoTotal: null }), "2026-03"), 0);
  assert.equal(saldoPlazo(compra({ montoTotal: null }), "2026-03"), null);
});

test("la mensualidad cae en su mes y en ninguno más", () => {
  const p = compra();
  assert.equal(mensualidadEnMes(p, "2025-12"), 0, "antes del primer cargo no cae nada");
  assert.equal(mensualidadEnMes(p, "2026-01"), 100000, "el primer mes");
  assert.equal(mensualidadEnMes(p, "2026-12"), 100000, "el último mes");
  assert.equal(mensualidadEnMes(p, "2027-01"), 0, "y después ya no");
  assert.equal(ultimoMes(p), "2026-12");
});

test("cuántas van, cuántas faltan y cuánto se debe", () => {
  const p = compra();
  assert.equal(mensualidadesCargadas(p, "2026-04"), 4);
  assert.equal(cargadoHasta(p, "2026-04"), 400000);
  assert.equal(mesesRestantes(p, "2026-04"), 8);
  assert.equal(saldoPlazo(p, "2026-04"), 800000, "lo que falta DESPUÉS de este corte");
  assert.equal(porCargarDesde(p, "2026-04"), 900000, "lo que falta CONTANDO el de este mes");
});

// El mes de la última mensualidad todavía te cobran una. Decir que ya terminaste ahí sería
// exactamente el cero falso que esta app no dice: el dinero aún no ha salido.
test("en el mes del último cargo la compra sigue viva", () => {
  const p = compra();
  const datos = { ...datosDePrueba(), plazos: [p] };

  assert.equal(sigueViva(p, "2026-12"), true);
  const ultimo = comprometidoAMeses(datos, "2026-12-05");
  assert.equal(ultimo.cuantos, 1);
  assert.equal(ultimo.alMes, 100000);
  assert.equal(ultimo.total, 100000, "todavía debes la mensualidad de este mes");

  assert.equal(sigueViva(p, "2027-01"), false);
  assert.equal(comprometidoAMeses(datos, "2027-01-05").cuantos, 0);
});

test("lo comprometido suma varias compras y dice hasta cuándo", () => {
  const datos = {
    ...datosDePrueba(),
    plazos: [
      compra({ id: "p1", montoTotal: 1200000, meses: 12, primerCargo: "2026-01" }),
      compra({ id: "p2", nombre: "Pantalla", montoTotal: 900000, meses: 18, primerCargo: "2026-03" }),
    ],
  };
  const r = comprometidoAMeses(datos, "2026-04-10");
  assert.equal(r.cuantos, 2);
  assert.equal(r.alMes, 100000 + 50000);
  assert.equal(r.hastaMes, "2027-08", "manda la que termina más tarde");
  // De abril de 2026 a agosto de 2027 van 17 meses contando el de este corte.
  assert.equal(r.veredicto.datos.mesesQueFaltan, 17);
  assert.match(r.veredicto.motivo, /durante 17 meses más/);
});

test("una compra sin monto se declara aparte, no se cuela con un cero", () => {
  const datos = { ...datosDePrueba(), plazos: [compra({ montoTotal: null })] };
  const r = comprometidoAMeses(datos, "2026-04-10");
  assert.equal(r.veredicto.estado, ESTADOS.SIN_DATOS);
  assert.deepEqual(r.sinMonto, ["Refri"]);
  assert.equal(r.alMes, 0);
});

test("el calendario baja conforme se acaban las compras, y no arrastra cola en cero", () => {
  const datos = {
    ...datosDePrueba(),
    plazos: [
      compra({ id: "p1", montoTotal: 600000, meses: 6, primerCargo: "2026-01" }),
      compra({ id: "p2", nombre: "Llantas", montoTotal: 300000, meses: 3, primerCargo: "2026-01" }),
    ],
  };
  const calendario = calendarioMSI(datos, "2026-01-15", 18);
  assert.equal(calendario[0].monto, 100000 + 100000, "enero: las dos");
  assert.equal(calendario[3].monto, 100000, "abril: ya solo una");
  assert.equal(calendario.length, 6, "se corta donde deja de haber algo que enseñar");
  assert.ok(calendario.every((c) => c.monto > 0));
});

test("sin compras a meses el veredicto lo dice, sin números raros", () => {
  const r = comprometidoAMeses(datosDePrueba(), "2026-04-10");
  assert.equal(r.cuantos, 0);
  assert.equal(r.alMes, 0);
  assert.equal(r.hastaMes, null);
  assert.equal(r.veredicto.estado, ESTADOS.VA_BIEN);
});

// --- Invariantes: lo que debe cumplirse para CUALQUIER compra ---
//
// Semilla fija, como en el resto de la casa: si una de éstas falla, falla con la misma entrada.

function dado(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test("para cualquier compra, las mensualidades cuadran y nunca se carga de más", () => {
  const azar = dado(20260911);
  for (let i = 0; i < 1500; i++) {
    const meses = 2 + Math.floor(azar() * 46);
    const montoTotal = 1 + Math.floor(azar() * 500000000);
    const p = compra({ montoTotal, meses, primerCargo: "2026-01" });

    const partes = mensualidadesDe(p);
    assert.equal(partes.reduce((a, b) => a + b, 0), montoTotal, "las partes suman el total");
    assert.ok(partes.every((x) => x >= 0), "ninguna mensualidad es negativa");
    // Ninguna parte se despega más de un centavo de otra: un reparto con un mes gigante y once
    // diminutos sumaría igual y sería basura.
    assert.ok(Math.max(...partes) - Math.min(...partes) <= 1, "el reparto es parejo");

    // Cargado + por cargar = el total, en cualquier punto de la vida de la compra.
    const corte = `2026-${String(1 + Math.floor(azar() * 12)).padStart(2, "0")}`;
    assert.equal(cargadoHasta(p, corte) + saldoPlazo(p, corte), montoTotal);
    assert.ok(cargadoHasta(p, corte) <= montoTotal, "nunca se carga más de lo que costó");
    assert.ok(mesesRestantes(p, corte) >= 0);
  }
});
