import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recibirAviso, pendientes, aceptarEntrada, descartarEntrada, deshacerEntrada,
  resumenBandeja, purgarBandeja, impactoPendiente,
  absorberAvisos, ventanaDeAvisos, tocaTraer, DIAS_POR_DEFECTO, HORAS_ENTRE_TRAIDAS,
  sinNadaQueRevisar, deConfianzaAlta,
} from "../motor/bandeja.js";
import { sugerirCategoria, recordar, olvidar, categoriaMasUsada, reglasAprendidas } from "../motor/aprendizaje.js";
import { ESTADOS_BANDEJA, TIPOS, ORIGENES, normalizarTarjeta } from "../motor/modelo.js";
import { migrar } from "../motor/migraciones.js";
import { ESTADOS } from "../motor/veredicto.js";
import { datosDePrueba, conMovimientos } from "./ayuda.js";

const HOY = "2026-09-09";
const AVISO = "Compra por $89.00 MXN en OXXO GASOLINERA 4412 con tarjeta terminación 4821 el 08/09/2026";

test("un aviso leído espera en la bandeja y no toca ningún número todavía", () => {
  const { datos, entrada } = recibirAviso(datosDePrueba(), AVISO, "alertas@banorte.com", "pegado", HOY);
  assert.equal(entrada.estado, ESTADOS_BANDEJA.PENDIENTE);
  assert.equal(resumenBandeja(datos).pendientes, 1);
  assert.equal(Object.keys(datos.movimientos).length, 0, "nada entra a las cuentas sin confirmar");
});

test("el mismo aviso dos veces no se duplica", () => {
  const paso1 = recibirAviso(datosDePrueba(), AVISO, "alertas@banorte.com", "pegado", HOY);
  const paso2 = recibirAviso(paso1.datos, AVISO, "alertas@banorte.com", "pegado", HOY);
  assert.equal(paso2.entrada, null);
  assert.ok(paso2.duplicado);
  assert.equal(resumenBandeja(paso2.datos).pendientes, 1);
});

test("un texto sin monto no ensucia la bandeja: se rechaza diciendo qué falta", () => {
  const r = recibirAviso(datosDePrueba(), "Tu estado de cuenta está listo", "x@banorte.com", "pegado", HOY);
  assert.equal(r.entrada, null);
  assert.equal(r.error.estado, ESTADOS.SIN_DATOS);
  assert.equal(resumenBandeja(r.datos).pendientes, 0);
});

test("aceptar crea el movimiento de verdad y vacía la bandeja", () => {
  const { datos, entrada } = recibirAviso(datosDePrueba(), AVISO, "alertas@banorte.com", "pegado", HOY);
  const r = aceptarEntrada(datos, entrada.id, { categoria: "super" }, HOY);
  assert.equal(r.error, null);
  assert.equal(r.movimiento.monto, 8900);
  assert.equal(r.movimiento.categoria, "super");
  assert.equal(r.datos.movimientos["2026-09"].length, 1);
  assert.equal(resumenBandeja(r.datos).pendientes, 0);
});

// Lo que separa esta app de las que la gente abandona: no preguntar dos veces lo mismo.
test("al aceptar, aprende la categoría y el siguiente cargo ya llega puesto", () => {
  const uno = recibirAviso(datosDePrueba(), AVISO, "alertas@banorte.com", "pegado", HOY);
  const aceptado = aceptarEntrada(uno.datos, uno.entrada.id, { categoria: "super" }, HOY);

  const otro = recibirAviso(aceptado.datos, "Compra por $45.00 en OXXO GASOLINERA 9911 el 09/09/2026", "alertas@banorte.com", "pegado", HOY);
  assert.equal(otro.entrada.movimiento.categoria, "super", "misma tienda, otra sucursal: ya la conoce");
});

// El caso que se me escapó y que solo apareció manejando la app: las sucursales no siempre
// se distinguen por un número. "STARBUCKS REFORMA" y "STARBUCKS POLANCO" son la misma marca,
// y si la app no lo ve, vuelve a preguntar por algo que ya le enseñaste.
test("aprende por marca, no por sucursal: REFORMA enseña a POLANCO", () => {
  const uno = recibirAviso(datosDePrueba(), "Compra por $189.50 en STARBUCKS REFORMA el 08/09/2026", "x@banorte.com", "pegado", HOY);
  const aceptado = aceptarEntrada(uno.datos, uno.entrada.id, { categoria: "comida-fuera" }, HOY);

  const otro = recibirAviso(aceptado.datos, "Compra por $75.00 en STARBUCKS POLANCO el 09/09/2026", "x@banorte.com", "pegado", HOY);
  assert.equal(otro.entrada.movimiento.categoria, "comida-fuera");
});

// Y el lado contrario, que es igual de importante: generalizar de más juntaría dos compras
// distintas en una sola y la app perdería un gasto.
test("pero dos sucursales siguen siendo dos compras distintas", () => {
  const uno = recibirAviso(datosDePrueba(), "Compra por $100.00 en STARBUCKS REFORMA el 08/09/2026", "x@banorte.com", "pegado", HOY);
  const dos = recibirAviso(uno.datos, "Compra por $100.00 en STARBUCKS POLANCO el 08/09/2026", "x@banorte.com", "pegado", HOY);
  assert.ok(dos.entrada, "no se descarta como duplicado");
  assert.equal(resumenBandeja(dos.datos).pendientes, 2);
});

test("descartar no registra nada y no vuelve a preguntar", () => {
  const { datos, entrada } = recibirAviso(datosDePrueba(), AVISO, "alertas@banorte.com", "pegado", HOY);
  const d = descartarEntrada(datos, entrada.id);
  assert.equal(resumenBandeja(d).pendientes, 0);
  assert.equal(Object.keys(d.movimientos).length, 0);
});

test("deshacer una aceptación borra el movimiento y la deja esperando otra vez", () => {
  const { datos, entrada } = recibirAviso(datosDePrueba(), AVISO, "alertas@banorte.com", "pegado", HOY);
  const aceptado = aceptarEntrada(datos, entrada.id, { categoria: "super" }, HOY);
  const d = deshacerEntrada(aceptado.datos, entrada.id);
  assert.equal(resumenBandeja(d).pendientes, 1);
  assert.equal((d.movimientos["2026-09"] || []).length, 0, "el movimiento se va con ella");
});

test("no se puede aceptar dos veces la misma entrada", () => {
  const { datos, entrada } = recibirAviso(datosDePrueba(), AVISO, "alertas@banorte.com", "pegado", HOY);
  const una = aceptarEntrada(datos, entrada.id, {}, HOY);
  const otra = aceptarEntrada(una.datos, entrada.id, {}, HOY);
  assert.ok(otra.error);
  assert.equal(una.datos.movimientos["2026-09"].length, 1);
});

test("un traspaso entre cuentas propias llega marcado para poder descartarlo", () => {
  const { entrada } = recibirAviso(datosDePrueba(), "Traspaso por $2,000.00 entre tus cuentas el 08/09/2026", "x@banorte.com", "pegado", HOY);
  assert.equal(entrada.posibleTraspaso, true);
});

test("purgar tira lo resuelto viejo pero NUNCA lo que sigue esperando", () => {
  const uno = recibirAviso(datosDePrueba(), AVISO, "alertas@banorte.com", "pegado", "2026-01-05");
  const descartado = descartarEntrada(uno.datos, uno.entrada.id);
  const dos = recibirAviso(descartado, "Compra por $10.00 en TIENDA el 04/01/2026", "x@banorte.com", "pegado", "2026-01-06");
  const d = purgarBandeja(dos.datos, "2026-06-01");
  assert.equal(d.bandeja.length, 1);
  assert.equal(d.bandeja[0].estado, ESTADOS_BANDEJA.PENDIENTE);
});

test("dice cuánto suma lo que está esperando, para no aceptar a ciegas", () => {
  const uno = recibirAviso(datosDePrueba(), AVISO, "alertas@banorte.com", "pegado", HOY);
  const dos = recibirAviso(uno.datos, "Recibiste $8,000.00 MXN el 09/09/2026", "x@banorte.com", "pegado", HOY);
  const i = impactoPendiente(dos.datos);
  assert.equal(i.gasto, 8900);
  assert.equal(i.ingreso, 800000);
  assert.match(i.veredicto.motivo, /2 movimientos esperan/);
});

test("sin nada esperando, lo dice sin drama", () => {
  assert.match(impactoPendiente(datosDePrueba()).veredicto.motivo, /nada esperando/i);
});

// --- Aprendizaje ---

test("sin reglas ni historial no inventa una categoría", () => {
  assert.equal(sugerirCategoria(datosDePrueba(), "TIENDA NUEVA"), null);
});

test("deduce del historial propio antes de que exista una regla", () => {
  const datos = conMovimientos(datosDePrueba(), [
    { fecha: "2026-08-01", monto: 5000, tipo: TIPOS.GASTO, categoria: "super", nota: "OXXO 11" },
    { fecha: "2026-08-09", monto: 7000, tipo: TIPOS.GASTO, categoria: "super", nota: "OXXO 22" },
  ]);
  const s = sugerirCategoria(datos, "OXXO 33");
  assert.equal(s.categoriaId, "super");
  assert.equal(s.veredicto.datos.fuente, "historial");
});

test("un solo movimiento no basta para deducir: uno es una casualidad", () => {
  const datos = conMovimientos(datosDePrueba(), [
    { fecha: "2026-08-01", monto: 5000, tipo: TIPOS.GASTO, categoria: "super", nota: "OXXO 11" },
  ]);
  assert.equal(categoriaMasUsada(datos, "oxxo"), null);
});

test("lo que la persona dijo le gana a lo que la persona hizo", () => {
  const datos = conMovimientos(datosDePrueba(), [
    { fecha: "2026-08-01", monto: 5000, tipo: TIPOS.GASTO, categoria: "super", nota: "OXXO 11" },
    { fecha: "2026-08-09", monto: 7000, tipo: TIPOS.GASTO, categoria: "super", nota: "OXXO 22" },
  ]);
  const s = sugerirCategoria(recordar(datos, "OXXO", "comida-fuera", HOY), "OXXO 33");
  assert.equal(s.categoriaId, "comida-fuera");
  assert.equal(s.veredicto.datos.fuente, "regla");
});

test("cambiar de opinión sobre un comercio no deja dos reglas peleando", () => {
  let d = recordar(datosDePrueba(), "OXXO", "super", HOY);
  d = recordar(d, "OXXO", "comida-fuera", HOY);
  assert.equal(reglasAprendidas(d).length, 1);
  assert.equal(sugerirCategoria(d, "OXXO").categoriaId, "comida-fuera");
});

test("una regla se puede borrar igual de fácil que se creó", () => {
  const d = recordar(datosDePrueba(), "OXXO", "super", HOY);
  assert.equal(sugerirCategoria(olvidar(d, "oxxo"), "OXXO"), null);
});

// --- La liga con la tarjeta ---
//
// El lector ya sacaba los últimos 4 del aviso y nadie los usaba para nada. Con una tarjeta
// capturada que termine igual, el cargo nace ligado a ella sin teclear nada: es la liga más
// barata que hay en toda la app, porque el dato ya venía en el correo.

const tarjetaTerminada = (ultimos4, extra = {}) =>
  normalizarTarjeta({
    id: `t_${ultimos4}`, nombre: `Tarjeta ${ultimos4}`, ultimos4, diaCorte: 5, diaLimite: 25,
    saldoInicial: 0, saldoInicialDesde: "2026-09-01", activa: true, ...extra,
  });

test("un cargo cuyos últimos 4 coinciden con una tarjeta nace ligado a ella", () => {
  const base = { ...datosDePrueba(), tarjetas: [tarjetaTerminada("4821")] };
  const { datos, entrada } = recibirAviso(base, AVISO, "alertas@banorte.com", "correo", HOY);
  assert.equal(entrada.ultimos4, "4821");

  const { movimiento } = aceptarEntrada(datos, entrada.id, {}, HOY);
  assert.equal(movimiento.tarjetaId, "t_4821");
});

test("con dos tarjetas terminadas igual NO se adivina: se deja suelto", () => {
  // Cargarle el gasto a la equivocada descuadra dos estados de cuenta en vez de uno.
  const base = {
    ...datosDePrueba(),
    tarjetas: [tarjetaTerminada("4821"), tarjetaTerminada("4821", { id: "otra", nombre: "Otra" })],
  };
  const { datos, entrada } = recibirAviso(base, AVISO, "alertas@banorte.com", "correo", HOY);
  const { movimiento } = aceptarEntrada(datos, entrada.id, {}, HOY);
  assert.equal(movimiento.tarjetaId, null);
});

test("sin tarjeta que coincida, el cargo entra suelto y sin estorbar", () => {
  const base = { ...datosDePrueba(), tarjetas: [tarjetaTerminada("9999")] };
  const { datos, entrada } = recibirAviso(base, AVISO, "alertas@banorte.com", "correo", HOY);
  const { movimiento } = aceptarEntrada(datos, entrada.id, {}, HOY);
  assert.equal(movimiento.tarjetaId, null);
});

test("lo que elija la persona manda sobre la liga automática", () => {
  const base = { ...datosDePrueba(), tarjetas: [tarjetaTerminada("4821")] };
  const { datos, entrada } = recibirAviso(base, AVISO, "alertas@banorte.com", "correo", HOY);
  const { movimiento } = aceptarEntrada(datos, entrada.id, { tarjetaId: "a-mano" }, HOY);
  assert.equal(movimiento.tarjetaId, "a-mano");
});

// --- Migración ---

test("un documento v1 de verdad se abre en la versión actual sin perder un movimiento", () => {
  const v1 = {
    version: 1,
    perfil: { ingresoQuincenal: 800000, cortes: [15] },
    movimientos: { "2026-09": [{ id: "m1", fecha: "2026-09-05", monto: 12345, tipo: "gasto", categoria: "super" }] },
    fijos: [{ id: "f1", nombre: "Renta", monto: 500000, diaCorte: 5 }],
    deudas: [], metas: [],
  };
  const r = migrar(v1);
  assert.equal(r.ok, true);
  assert.deepEqual(r.aplicadas, ["v1→v2", "v2→v3", "v3→v4", "v4→v5"], "la cadena se aplica entera, en orden");
  assert.equal(r.datos.movimientos["2026-09"][0].monto, 12345);
  assert.equal(r.datos.fijos[0].nombre, "Renta");
  assert.deepEqual(r.datos.bandeja, []);
  assert.deepEqual(r.datos.reglas, []);
  assert.deepEqual(r.datos.borrados, [], "y las lápidas nacen vacías: no sabemos qué se borró antes");
  assert.deepEqual(r.datos.tarjetas, [], "y las tarjetas también: un documento v1 no tenía ninguna");
  assert.deepEqual(r.datos.plazos, []);
});

test("un documento de una versión más nueva sigue sin abrirse", () => {
  assert.equal(migrar({ version: 99 }).ok, false);
});

// --- Preautorización y cargo final ---
//
// Un cargo pendiente y su cargo final NO traen el mismo monto: la gasolinera retiene $100 y
// cobra $43; el restaurante autoriza sin propina y cobra con ella. La huella incluye el monto,
// así que sin esto los dos entraban como gastos distintos y la app mentía hacia arriba.

test("el cargo final de una preautorización se reconoce, no se suma a ciegas", () => {
  const base = conMovimientos(datosDePrueba(), [
    { fecha: "2026-09-07", monto: 10000, tipo: TIPOS.GASTO, categoria: "transporte", nota: "GASOLINERA SHELL" },
  ]);
  const { entrada } = recibirAviso(base, "Cargo por $43.00 MXN en GASOLINERA SHELL el 09/09/2026", "x@banorte.com", "correo", HOY);
  assert.ok(entrada.reemplaza, "queda apuntando al cargo que va a sustituir");
});

test("reemplazar deja UN solo movimiento, con el monto final", () => {
  const base = conMovimientos(datosDePrueba(), [
    { fecha: "2026-09-07", monto: 10000, tipo: TIPOS.GASTO, categoria: "transporte", nota: "GASOLINERA SHELL" },
  ]);
  const { datos, entrada } = recibirAviso(base, "Cargo por $43.00 MXN en GASOLINERA SHELL el 09/09/2026", "x@banorte.com", "correo", HOY);
  const r = aceptarEntrada(datos, entrada.id, { reemplazar: true }, HOY);

  const movimientos = Object.values(r.datos.movimientos).flat();
  assert.equal(movimientos.length, 1);
  assert.equal(movimientos[0].monto, 4300);
  assert.equal(r.datos.borrados.length, 1, "y el reemplazado deja lápida, para que no resucite");
});

test("si NO es el mismo consumo, se puede sumar aparte", () => {
  const base = conMovimientos(datosDePrueba(), [
    { fecha: "2026-09-07", monto: 10000, tipo: TIPOS.GASTO, categoria: "transporte", nota: "GASOLINERA SHELL" },
  ]);
  const { datos, entrada } = recibirAviso(base, "Cargo por $43.00 MXN en GASOLINERA SHELL el 09/09/2026", "x@banorte.com", "correo", HOY);
  const r = aceptarEntrada(datos, entrada.id, {}, HOY);
  assert.equal(Object.values(r.datos.movimientos).flat().length, 2, "quedan los dos");
});

test("un comercio distinto o una fecha lejana NO se confunden con una liquidación", () => {
  const base = conMovimientos(datosDePrueba(), [
    { fecha: "2026-09-07", monto: 10000, tipo: TIPOS.GASTO, categoria: "transporte", nota: "GASOLINERA SHELL" },
  ]);
  for (const texto of [
    "Cargo por $43.00 MXN en FARMACIA GDL el 09/09/2026",
    "Cargo por $43.00 MXN en GASOLINERA SHELL el 27/09/2026",
    "Cargo por $2,500.00 MXN en GASOLINERA SHELL el 09/09/2026",
  ]) {
    const { entrada } = recibirAviso(base, texto, "x@banorte.com", "correo", HOY);
    assert.equal(entrada.reemplaza, null, `no debería proponer reemplazo: ${texto}`);
  }
});

// ── Traer del correo, sin que nadie lo pida ────────────────────────────────
//
// Lo que se prueba aquí no es que el correo llegue —eso vive del otro lado, en Apps Script—
// sino las dos decisiones que hacen que traerlo solo ayude en vez de estorbar: cuánto correo
// pedir para no perderse nada, y cuándo abstenerse de preguntar.

const HORA = 3600000;

test("nunca traído: se piden los días de siempre, no medio año", () => {
  assert.equal(ventanaDeAvisos("", HOY), DIAS_POR_DEFECTO);
  assert.equal(ventanaDeAvisos(null, HOY), DIAS_POR_DEFECTO);
});

test("volver de vacaciones no deja correo afuera", () => {
  // Nueve días fuera: se piden diez, con el día de traslape. Pedir tres —lo que pedía el
  // botón— habría perdido seis días de avisos sin decir nada.
  assert.equal(ventanaDeAvisos("2026-08-31", HOY), 10);
});

test("aunque hayas abierto la app hace un rato, se piden los días mínimos", () => {
  // Traído hoy mismo: pedir 1 día dejaría fuera un aviso de anoche que ya estaba cuando se
  // trajo. El mínimo cuesta unos cuantos repetidos, y los repetidos no cuestan nada.
  assert.equal(ventanaDeAvisos(HOY, HOY), DIAS_POR_DEFECTO);
});

test("un hueco enorme se topa: pedirle a Gmail seis meses no trae seis meses", () => {
  assert.equal(ventanaDeAvisos("2024-01-01", HOY), 30);
  assert.equal(ventanaDeAvisos("2024-01-01", HOY, 15), 15);
});

test("una fecha del futuro no produce una ventana negativa", () => {
  assert.equal(ventanaDeAvisos("2027-01-01", HOY), DIAS_POR_DEFECTO);
});

test("no se le pregunta al correo veinte veces al día", () => {
  const ahora = Date.now();
  assert.equal(tocaTraer(0, ahora), true, "nunca traído: adelante");
  assert.equal(tocaTraer(ahora - HORA, ahora), false, "hace una hora: todavía no");
  assert.equal(tocaTraer(ahora - HORAS_ENTRE_TRAIDAS * HORA, ahora), true);
  assert.equal(tocaTraer(ahora - 48 * HORA, ahora), true);
});

test("un reloj adelantado no congela la traída", () => {
  const ahora = Date.now();
  assert.equal(tocaTraer(ahora + 72 * HORA, ahora), true);
});

test("absorber avisos los mete todos y devuelve la cuenta de cada cosa", () => {
  const avisos = [
    { asunto: "Compra", texto: AVISO, remitente: "alertas@banco.com" },
    { asunto: "Compra", texto: AVISO, remitente: "alertas@banco.com" }, // el mismo, otra vez
    { asunto: "Promoción", texto: "Aprovecha nuestra promoción de fin de mes", remitente: "promos@banco.com" },
  ];
  const { datos, nuevos, repetidos } = absorberAvisos(datosDePrueba(), avisos, HOY);

  assert.equal(nuevos, 1, "el mismo aviso dos veces es un solo movimiento");
  assert.equal(repetidos, 1);
  assert.equal(pendientes(datos).length, 1, "una promoción no produce un movimiento");
});

test("absorber no muta lo que recibe", () => {
  const antes = datosDePrueba();
  const copia = JSON.stringify(antes);
  absorberAvisos(antes, [{ texto: AVISO, remitente: "alertas@banco.com" }], HOY);
  assert.equal(JSON.stringify(antes), copia);
});

test("absorber sin avisos no rompe ni inventa nada", () => {
  const datos = datosDePrueba();
  for (const vacio of [[], null, undefined]) {
    const paso = absorberAvisos(datos, vacio, HOY);
    assert.equal(paso.nuevos, 0);
    assert.equal(paso.datos, datos);
  }
});

// ── Lo que salió de una captura de pantalla ────────────────────────────────
//
// Un OCR puede leer $89.00 donde decía $8,900.00. Ese error no se nota al aceptarlo: se nota a
// fin de quincena, cuando ya no sabes de dónde salió. Por eso una entrada que viene de una
// imagen no se acepta sin mirarla, y estas pruebas son lo que impide que alguien lo "mejore".

test("una entrada de imagen NUNCA se acepta sin mirarla, por limpia que se vea", () => {
  const deImagen = {
    id: "img1", estado: ESTADOS_BANDEJA.PENDIENTE, recibido: HOY,
    confianza: "alta", origen: ORIGENES.IMAGEN,
    movimiento: { id: "m1", tipo: TIPOS.GASTO, monto: 8900, fecha: HOY, categoria: "super", nota: "OXXO" },
  };
  assert.equal(sinNadaQueRevisar(deImagen), false);

  // Y el mismo aviso pegado a mano sí, para que quede claro que lo que decide es el origen.
  assert.equal(sinNadaQueRevisar({ ...deImagen, origen: ORIGENES.PEGADO }), true);
});

test("y por lo tanto no entra al «aceptar todo» de la bandeja", () => {
  const datos = { ...datosDePrueba(), bandeja: [{
    id: "img1", estado: ESTADOS_BANDEJA.PENDIENTE, recibido: HOY,
    confianza: "alta", origen: ORIGENES.IMAGEN,
    movimiento: { id: "m1", tipo: TIPOS.GASTO, monto: 8900, fecha: HOY, categoria: "super", nota: "OXXO" },
  }] };

  assert.equal(pendientes(datos).length, 1, "sigue esperando, que es lo que debe hacer");
  assert.equal(deConfianzaAlta(datos).length, 0, "pero no se acepta en lote");
});
