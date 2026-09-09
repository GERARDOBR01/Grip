import { test } from "node:test";
import assert from "node:assert/strict";
import { recibirAviso, ilegibles, aceptarEntrada, pendientes, resumenBandeja, purgarBandeja } from "../motor/bandeja.js";
import { ORIGENES, ESTADOS_BANDEJA } from "../motor/modelo.js";
import { reglasAprendidas } from "../motor/aprendizaje.js";
import { datosDePrueba } from "./ayuda.js";

// Un banco cuyo formato nadie ha visto, que no dice el monto de forma reconocible.
const RARO = "Aviso de tu cuenta\nSe aplico un movimiento a tu plastico terminacion 4821.\nConsulta el detalle en la app.";

test("un correo que no se entiende NO se tira: espera en la bandeja", () => {
  const { datos, entrada } = recibirAviso(datosDePrueba(), RARO, "avisos@raro.mx", ORIGENES.CORREO, "2026-09-09");
  assert.ok(entrada, "antes esto devolvía null y el correo se perdía para siempre");
  assert.equal(entrada.estado, ESTADOS_BANDEJA.ILEGIBLE);
  assert.equal(ilegibles(datos).length, 1);
  assert.equal(resumenBandeja(datos).ilegibles, 1);
});

test("guarda la primera línea para reconocerlo, no el correo", () => {
  const { datos } = recibirAviso(datosDePrueba(), RARO, "avisos@raro.mx", ORIGENES.CORREO, "2026-09-09");
  const entrada = ilegibles(datos)[0];
  assert.equal(entrada.resumen, "Aviso de tu cuenta");
  assert.ok(!entrada.resumen.includes("plastico"), "el cuerpo del aviso no se guarda");
});

test("pegado a mano SÍ devuelve el error en pantalla, sin ensuciar la bandeja", () => {
  const { datos, entrada, error } = recibirAviso(datosDePrueba(), RARO, "", ORIGENES.PEGADO, "2026-09-09");
  assert.equal(entrada, null, "la persona está mirando: se le dice y ya");
  assert.ok(error);
  assert.equal((datos.bandeja || []).length, 0);
});

test("completarlo a mano crea el movimiento Y aprende la marca", () => {
  const paso = recibirAviso(datosDePrueba(), RARO, "avisos@raro.mx", ORIGENES.CORREO, "2026-09-09");
  const id = paso.entrada.id;

  const { datos, movimiento, error } = aceptarEntrada(
    paso.datos, id, { monto: 24500, nota: "FERRETERIA LOPEZ", categoria: "hogar" }, "2026-09-09");

  assert.ok(!error, `no debería fallar: ${error}`);
  assert.equal(movimiento.monto, 24500);
  assert.equal(movimiento.fecha, "2026-09-09", "sin fecha en el aviso, la del día que llegó");
  assert.equal(ilegibles(datos).length, 0, "ya no espera nada");

  const aprendido = reglasAprendidas(datos).map((r) => r.clave);
  assert.ok(aprendido.includes("ferreteria"), `aprendió del nombre que se escribió: ${aprendido}`);
});

test("una ilegible vieja NO se purga: es trabajo sin hacer, no basura", () => {
  const paso = recibirAviso(datosDePrueba(), RARO, "avisos@raro.mx", ORIGENES.CORREO, "2026-01-01");
  const purgado = purgarBandeja(paso.datos, "2026-09-01");
  assert.equal(ilegibles(purgado).length, 1, "'no pendiente' no quiere decir 'resuelta'");
});

test("no se cuela entre las pendientes normales, que sí traen movimiento", () => {
  const { datos } = recibirAviso(datosDePrueba(), RARO, "avisos@raro.mx", ORIGENES.CORREO, "2026-09-09");
  assert.equal(pendientes(datos).length, 0, "la pantalla de siempre no puede recibir una entrada sin monto");
});
