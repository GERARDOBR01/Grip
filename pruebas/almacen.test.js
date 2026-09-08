import { test } from "node:test";
import assert from "node:assert/strict";
import { exportar, importar, nombreDeRespaldo } from "../almacen/archivo.js";
import { masReciente } from "../almacen/almacen.js";
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

test("gana la copia con el sello más reciente", () => {
  const viejo = { actualizado: "2026-09-01T10:00:00.000Z", marca: "viejo" };
  const nuevo = { actualizado: "2026-09-08T10:00:00.000Z", marca: "nuevo" };
  assert.equal(masReciente(viejo, nuevo).marca, "nuevo");
  assert.equal(masReciente(nuevo, viejo).marca, "nuevo");
  assert.equal(masReciente(null, nuevo).marca, "nuevo");
  assert.equal(masReciente(viejo, null).marca, "viejo");
  assert.equal(masReciente(null, null), null);
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
import { enMemoria } from "../almacen/local.js";
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
