import { test } from "node:test";
import assert from "node:assert/strict";
import { exportar, importar, nombreDeRespaldo } from "../almacen/archivo.js";
import { VERSION_DATOS } from "../motor/modelo.js";
import { datosDePrueba, conMovimientos } from "./ayuda.js";

test("exportar e importar devuelve exactamente lo mismo", () => {
  const datos = conMovimientos(datosDePrueba(), [
    { fecha: "2026-09-03", monto: 120000, tipo: "gasto", categoria: "super", nota: "despensa" },
  ]);
  const resultado = importar(exportar(datos));

  assert.equal(resultado.ok, true);
  assert.deepEqual(resultado.datos.movimientos, datos.movimientos);
  assert.deepEqual(resultado.datos.perfil, datos.perfil);
  assert.deepEqual(resultado.datos.fijos, datos.fijos);
});

test("un archivo que no es JSON se rechaza con motivo, no con una pantalla rota", () => {
  const r = importar("{esto no es json");
  assert.equal(r.ok, false);
  assert.match(r.motivo, /JSON válido/);
});

test("un respaldo de una versión más nueva no se abre a medias", () => {
  const r = importar(JSON.stringify({ ...datosDePrueba(), version: VERSION_DATOS + 3 }));
  assert.equal(r.ok, false);
  assert.match(r.motivo, /más nueva/);
});

test("el nombre del respaldo lleva la fecha", () => {
  assert.equal(nombreDeRespaldo("2026-09-08"), "finanzas-2026-09-08.json");
});

// --- Que nunca falle en silencio ---
//
// El almacén se prueba con un local de mentira: así se pueden provocar los fallos que en un
// navegador real solo aparecen en modo privado, en un iframe restringido o tras actualizar
// la app en otro dispositivo.

import { abrirAlmacen, MODOS } from "../almacen/almacen.js";
import { enMemoria, pedirPersistencia } from "../almacen/local.js";
import { datosVacios } from "../motor/modelo.js";

function localFalso({ guardado = null, alGuardar = null, duradero = true, tipo = "falso" } = {}) {
  let contenido = guardado;
  return {
    tipo,
    duradero,
    motivo: duradero ? null : "de mentira: no guarda nada",
    async cargar() { return contenido; },
    async guardar(datos) {
      if (alGuardar) alGuardar(datos);
      contenido = datos;
    },
    async borrar() { contenido = null; },
    leer: () => contenido,
  };
}

test("abrir el almacén no lanza aunque el navegador no deje guardar nada", async () => {
  const almacen = await abrirAlmacen({ local: enMemoria("sin almacenamiento") });
  assert.equal(almacen.estado().modo, MODOS.EFIMERO, "se declara efímero en vez de fingir que guarda");
  assert.match(almacen.estado().motivo, /sin almacenamiento/);

  const { datos } = await almacen.cargar();
  assert.equal(datos.perfil.ingresoQuincenal, null, "la app arranca utilizable igual");
});

test("si el almacén truena al guardar, el error SALE — no se pierde en la consola", async () => {
  const almacen = await abrirAlmacen({
    local: localFalso({ alGuardar: () => { throw new Error("cuota llena"); } }),
  });
  await assert.rejects(() => almacen.guardar(datosVacios("2026-09-08")), /cuota llena/);
});

test("con datos de una versión más nueva, el almacén se NIEGA a escribir encima", async () => {
  const delFuturo = { ...datosVacios("2026-09-08"), version: 99, marca: "no se toca" };
  const local = localFalso({ guardado: delFuturo });
  const almacen = await abrirAlmacen({ local });

  const carga = await almacen.cargar();
  assert.equal(carga.bloqueado, true);
  assert.equal(almacen.estado().bloqueado, true);

  await assert.rejects(() => almacen.guardar(datosVacios("2026-09-08")), /no sabe abrir/i);
  assert.equal(local.leer().marca, "no se toca", "los datos originales siguen intactos");
});

test("borrar todo es una decisión explícita: destraba la escritura", async () => {
  const local = localFalso({ guardado: { ...datosVacios("2026-09-08"), version: 99 } });
  const almacen = await abrirAlmacen({ local });
  await almacen.cargar();

  await almacen.borrarTodo();
  assert.equal(almacen.estado().bloqueado, false);

  const sello = await almacen.guardar(datosVacios("2026-09-08"));
  assert.ok(sello.actualizado, "y ahora sí guarda, con su sello de tiempo");
});

test("un espejo caído no impide guardar en local: baja el modo y lo dice", async () => {
  const local = localFalso();
  const almacen = await abrirAlmacen({
    local,
    proveedorSincronizacion: async () => ({
      tipo: "sincronizado",
      async cargar() { return null; },
      async guardar() { throw new Error("sin red"); },
    }),
  });
  assert.equal(almacen.estado().modo, MODOS.SINCRONIZADO);

  await almacen.guardar(datosVacios("2026-09-08"));
  assert.equal(almacen.estado().modo, MODOS.LOCAL, "baja de modo en vez de mentir");
  assert.match(almacen.estado().motivo, /no se pudo sincronizar/i);
  assert.ok(local.leer(), "y el dato quedó a salvo en este dispositivo");
});

// ————————————————————————————————————————————————————————————————————————————————
// La prueba que faltaba y que costó caro: hasta hoy, sincronizar DESCARTABA un documento
// entero. `motor/fusion.js` existía y estaba probado por su cuenta, pero nadie lo llamaba,
// así que el fallo seguía vivo con las pruebas en verde. Esto lo ejerce por el camino real
// —el que usa la app— en vez de por la función suelta.

/** Un espejo de mentira con contenido propio, como el otro dispositivo. */
function espejoFalso(guardado = null) {
  let contenido = guardado;
  return {
    proveedor: async () => ({
      tipo: "sincronizado",
      async cargar() { return contenido; },
      async guardar(datos) { contenido = datos; },
    }),
    leer: () => contenido,
  };
}

const notasDe = (datos) =>
  Object.values(datos.movimientos).flat().map((m) => m.nota).sort();

test("dos dispositivos capturando distinto: al abrir sobreviven LOS DOS", async () => {
  const enElCelular = conMovimientos(datosDePrueba(), [
    { fecha: "2026-09-07", monto: 45000, tipo: "gasto", categoria: "super", nota: "DESPENSA" },
  ]);
  const enLaPC = conMovimientos(datosDePrueba(), [
    { fecha: "2026-09-08", monto: 18000, tipo: "gasto", categoria: "super", nota: "CINE" },
  ]);
  enElCelular.actualizado = "2026-09-08T18:00:00.000Z";
  enLaPC.actualizado = "2026-09-08T19:00:00.000Z"; // la PC sincronizó después

  const local = localFalso({ guardado: enElCelular });
  const espejo = espejoFalso(enLaPC);
  const almacen = await abrirAlmacen({ local, proveedorSincronizacion: espejo.proveedor });

  const { datos } = await almacen.cargar();
  assert.deepEqual(notasDe(datos), ["CINE", "DESPENSA"], "la captura del celular NO desaparece");

  // Y los dos lados quedan al día, para que la próxima apertura no tenga nada que reconciliar.
  assert.deepEqual(notasDe(local.leer()), ["CINE", "DESPENSA"]);
  assert.deepEqual(notasDe(espejo.leer()), ["CINE", "DESPENSA"]);
});

test("lo borrado a propósito NO resucita al unirse con una copia vieja", async () => {
  const conGasto = conMovimientos(datosDePrueba(), [
    { fecha: "2026-09-07", monto: 45000, tipo: "gasto", categoria: "super", nota: "DESPENSA" },
  ]);
  const id = Object.values(conGasto.movimientos).flat()[0].id;

  // El celular lo borró: queda la lápida y el movimiento se va.
  const yaBorrado = { ...conGasto, movimientos: {}, borrados: [{ id, cuando: "2026-09-08" }] };
  yaBorrado.actualizado = "2026-09-08T19:00:00.000Z";
  conGasto.actualizado = "2026-09-08T18:00:00.000Z"; // la PC todavía lo tiene

  const local = localFalso({ guardado: yaBorrado });
  const almacen = await abrirAlmacen({
    local,
    proveedorSincronizacion: espejoFalso(conGasto).proveedor,
  });

  const { datos } = await almacen.cargar();
  assert.deepEqual(notasDe(datos), [], "la lápida gana sobre la copia que todavía lo tenía");
});

test("si un lado trae una versión que no se sabe abrir, no se fusiona NADA", async () => {
  // Fusionar contra un documento que no se entiende sería inventar. Se traba y se explica.
  const local = localFalso({ guardado: datosDePrueba() });
  const almacen = await abrirAlmacen({
    local,
    proveedorSincronizacion: espejoFalso({ ...datosVacios("2026-09-08"), version: 99 }).proveedor,
  });

  const { bloqueado, aviso } = await almacen.cargar();
  assert.equal(bloqueado, true);
  assert.match(aviso, /versión más nueva/i);
  await assert.rejects(() => almacen.guardar(datosDePrueba()), /no se guarda nada/i);
});

// ————————————————————————————————————————————————————————————————————————————————
// Permanencia. Antes este archivo declaraba `duradero: true` sin haber pedido nada, y la app
// le decía a la persona "todo se guarda en este dispositivo". Safari borra el almacenamiento
// de scripts a los 7 días sin interacción: esa frase podía costar un historial entero.

/** Pone un `navigator` de mentira, corre algo, y lo deja como estaba pase lo que pase. */
async function conNavigator(falso, hacer) {
  const previo = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: falso, configurable: true, writable: true });
  try {
    return await hacer();
  } finally {
    if (previo) Object.defineProperty(globalThis, "navigator", previo);
    else delete globalThis.navigator;
  }
}

test("si el navegador concede permanencia, se reporta concedida", async () => {
  const concedido = await conNavigator(
    { storage: { persisted: async () => false, persist: async () => true } },
    () => pedirPersistencia(),
  );
  assert.equal(concedido, true);
});

test("si la niega, se reporta negada — no se supone que sí", async () => {
  const concedido = await conNavigator(
    { storage: { persisted: async () => false, persist: async () => false } },
    () => pedirPersistencia(),
  );
  assert.equal(concedido, false, "suponer que sí es justo la mentira que se está quitando");
});

test("si ya estaba concedida, no se vuelve a preguntar", async () => {
  let veces = 0;
  const concedido = await conNavigator(
    { storage: { persisted: async () => true, persist: async () => { veces++; return true; } } },
    () => pedirPersistencia(),
  );
  assert.equal(concedido, true);
  assert.equal(veces, 0, "en Firefox preguntar es una ventana al usuario: no se gasta dos veces");
});

test("un navegador sin StorageManager no truena: simplemente no hay permanencia", async () => {
  assert.equal(await conNavigator({}, () => pedirPersistencia()), false);
  assert.equal(await conNavigator(undefined, () => pedirPersistencia()), false);
});

test("si persist() se cuelga, no deja la app colgada", async () => {
  const concedido = await conNavigator(
    { storage: { persisted: async () => false, persist: () => new Promise(() => {}) } },
    () => pedirPersistencia(),
  );
  assert.equal(concedido, false, "a los 3 segundos se rinde y sigue");
});

test("si persist() lanza, se trata como negada en vez de tumbar el arranque", async () => {
  const concedido = await conNavigator(
    { storage: { persisted: async () => { throw new Error("bloqueado"); }, persist: async () => true } },
    () => pedirPersistencia(),
  );
  assert.equal(concedido, false);
});
