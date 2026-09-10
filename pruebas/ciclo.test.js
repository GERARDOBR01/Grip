import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cicloDe, ciclosHasta, proximoPago, vencimientoEnMes, sumarDias, sumarMeses, diasEntre, mesDe, cicloSiguiente,
} from "../motor/ciclo.js";

test("la primera quincena va del 1 al 15", () => {
  const c = cicloDe("2026-09-08");
  assert.equal(c.inicio, "2026-09-01");
  assert.equal(c.fin, "2026-09-15");
  assert.equal(c.dias, 15);
  assert.equal(c.diasTranscurridos, 8);
  assert.equal(c.diasRestantes, 8, "hoy todavía cuenta: aún puedes gastar hoy");
});

test("la segunda quincena termina el último día del mes, sea cual sea", () => {
  assert.equal(cicloDe("2026-09-20").fin, "2026-09-30");
  assert.equal(cicloDe("2026-02-20").fin, "2026-02-28");
  assert.equal(cicloDe("2024-02-20").fin, "2024-02-29", "año bisiesto");
  assert.equal(cicloDe("2026-01-31").fin, "2026-01-31");
});

test("el último día del ciclo deja 1 día restante, no 0", () => {
  assert.equal(cicloDe("2026-09-15").diasRestantes, 1);
  assert.equal(cicloDe("2026-09-30").diasRestantes, 1);
});

test("sin cortes el ciclo es mensual", () => {
  const c = cicloDe("2026-09-20", []);
  assert.equal(c.inicio, "2026-09-01");
  assert.equal(c.fin, "2026-09-30");
  assert.equal(c.etiqueta, "mes");
});

test("los cortes son configurables — otro patrón de pago no rompe nada", () => {
  const c = cicloDe("2026-09-20", [10, 25]);
  assert.equal(c.inicio, "2026-09-11");
  assert.equal(c.fin, "2026-09-25");
  assert.equal(c.total, 3);
});

test("ciclosHasta cuenta las quincenas que de verdad cierran antes de la fecha", () => {
  // 15 y 30 de sep, 15 y 31 de oct, 15 y 30 de nov, 15 y 31 de dic = 8
  assert.equal(ciclosHasta("2026-09-08", "2026-12-31"), 8);
  assert.equal(ciclosHasta("2026-09-08", "2026-09-15"), 1);
  assert.equal(ciclosHasta("2026-09-08", "2026-09-14"), 0, "si no cierra ninguna, son cero");
  assert.equal(ciclosHasta("2026-09-08", "2026-01-01"), 0, "fecha pasada");
});

test("las fechas se mueven sin zonas horarias de por medio", () => {
  assert.equal(sumarDias("2026-02-28", 1), "2026-03-01");
  assert.equal(sumarDias("2026-01-01", -1), "2025-12-31");
  assert.equal(sumarMeses("2026-01-31", 1), "2026-02-28", "el 31 de enero + 1 mes es el 28 de febrero");
  assert.equal(sumarMeses("2026-12-15", 1), "2027-01-15");
  assert.equal(diasEntre("2026-09-08", "2026-09-15"), 7);
  assert.equal(mesDe("2026-09-08"), "2026-09");
});

test("un cargo el día 31 cae el último día de los meses cortos", () => {
  assert.equal(vencimientoEnMes("2026-02", 31), "2026-02-28");
  assert.equal(vencimientoEnMes("2026-09", 5), "2026-09-05");
});

test("proximoPago y cicloSiguiente", () => {
  assert.deepEqual(proximoPago("2026-09-08"), { fecha: "2026-09-15", dias: 7 });
  assert.equal(cicloSiguiente("2026-09-08").inicio, "2026-09-16");
  assert.equal(cicloSiguiente("2026-09-20").inicio, "2026-10-01");
});

test("el ciclo nunca reporta más días transcurridos de los que tiene, ni días negativos", () => {
  // Cinturón además del tirante: `esISO` ya no deja pasar un 31 de febrero, pero de lo que
  // sale de aquí se divide el número que la app enseña en grande, y ahí no puede haber restas
  // que mientan aunque la fecha llegue armada al vuelo desde otro lado.
  for (const iso of ["2026-02-31", "2026-01-40", "2026-06-00"]) {
    const c = cicloDe(iso, [15]);
    assert.ok(c.diasRestantes >= 1 && c.diasRestantes <= c.dias, `${iso}: restantes ${c.diasRestantes} de ${c.dias}`);
    assert.ok(c.diasTranscurridos >= 1 && c.diasTranscurridos <= c.dias, `${iso}: van ${c.diasTranscurridos} de ${c.dias}`);
  }
});
