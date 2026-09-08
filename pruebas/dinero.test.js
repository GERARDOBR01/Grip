import { test } from "node:test";
import assert from "node:assert/strict";
import { aCentavos, formatear, formatearCorto, repartir, prorratear, porcentaje } from "../motor/dinero.js";

test("aCentavos entiende lo que escribe una persona", () => {
  assert.equal(aCentavos("1234.56"), 123456);
  assert.equal(aCentavos("$1,234.56"), 123456);
  assert.equal(aCentavos(" 1234 "), 123400);
  assert.equal(aCentavos("0.5"), 50);
  assert.equal(aCentavos(".99"), 99);
  assert.equal(aCentavos("-20"), -2000);
  assert.equal(aCentavos(12.34), 1234);
});

test("aCentavos redondea el tercer decimal en vez de tirarlo", () => {
  assert.equal(aCentavos("1.005"), 101);
  assert.equal(aCentavos("1.004"), 100);
});

test("aCentavos devuelve null cuando no hay monto — null no es cero", () => {
  assert.equal(aCentavos(""), null);
  assert.equal(aCentavos("abc"), null);
  assert.equal(aCentavos(null), null);
  assert.equal(aCentavos(undefined), null);
  assert.equal(aCentavos(NaN), null);
  assert.equal(aCentavos("1.2.3"), null);
});

test("no hay error de coma flotante: 0.1 + 0.2 son exactamente 30 centavos", () => {
  assert.equal(aCentavos("0.1") + aCentavos("0.2"), 30);
  let acumulado = 0;
  for (let i = 0; i < 1000; i++) acumulado += aCentavos("0.07");
  assert.equal(acumulado, 7000); // con floats esto daría 70.00000000000041
});

test("formatear escribe igual en cualquier dispositivo", () => {
  assert.equal(formatear(123456), "$1,234.56");
  assert.equal(formatear(0), "$0.00");
  assert.equal(formatear(-50), "−$0.50");
  assert.equal(formatear(100000000), "$1,000,000.00");
  assert.equal(formatear(1500, { signo: true }), "+$15.00");
  assert.equal(formatearCorto(123456), "$1,235");
});

test("repartir no pierde ni un centavo", () => {
  assert.deepEqual(repartir(1000, 3), [334, 333, 333]);
  assert.equal(repartir(1000, 3).reduce((a, b) => a + b, 0), 1000);
  assert.equal(repartir(99999, 7).reduce((a, b) => a + b, 0), 99999);
  assert.deepEqual(repartir(100, 0), []);
});

test("prorratear y porcentaje", () => {
  assert.equal(prorratear(300000, 1, 2), 150000);
  assert.equal(porcentaje(50, 200), 25);
  assert.equal(porcentaje(50, 0), null, "sin total no hay porcentaje");
});
