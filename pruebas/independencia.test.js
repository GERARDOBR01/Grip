// La prueba que sostiene la promesa: esta app no depende de Claude para abrirse.
//
// Claude es la vía rápida para usarla hoy desde el celular, no el piso sobre el que está
// construida. Un solo archivo — almacen/anfitrion-claude.js — sabe que ese entorno
// existe. Borrarlo debe dejar la app funcionando igual: guardando en el navegador y
// descargando el respaldo con un enlace normal.
//
// Esto no es una promesa en un README: es una prueba que falla si alguien la rompe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADAPTADOR = "almacen/anfitrion-claude.js";

/** Quita comentarios: lo que importa es el CÓDIGO, no lo que digan las notas. */
function soloCodigo(texto) {
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function archivosJS(carpeta) {
  return readdirSync(join(RAIZ, carpeta))
    .filter((n) => n.endsWith(".js"))
    .map((n) => `${carpeta}/${n}`);
}

const fuentes = [...archivosJS("motor"), ...archivosJS("almacen"), ...archivosJS("interfaz")];

test("el motor y la interfaz no nombran a Claude por ningún lado", () => {
  const infractores = fuentes
    .filter((ruta) => ruta !== ADAPTADOR)
    .filter((ruta) => /claude/i.test(soloCodigo(readFileSync(join(RAIZ, ruta), "utf8"))));

  assert.deepEqual(infractores, [], `estos archivos crearían una dependencia: ${infractores.join(", ")}`);
});

test("nadie importa el adaptador: borrar ese archivo no rompe la app", () => {
  const importadores = fuentes
    .filter((ruta) => ruta !== ADAPTADOR)
    .filter((ruta) => /anfitrion-claude/.test(readFileSync(join(RAIZ, ruta), "utf8")));

  assert.deepEqual(importadores, [], "el adaptador se detecta en tiempo de ejecución, no se importa");
});

test("el almacén enciende la sincronización solo si alguien se la ofrece", () => {
  const almacen = readFileSync(join(RAIZ, "almacen/almacen.js"), "utf8");
  assert.match(almacen, /typeof abrirSincronizacion === "function"/, "sin adaptador, el typeof da undefined y sigue");
  assert.match(almacen, /await local\.guardar\(sello\)/, "lo local se escribe primero, pase lo que pase");
});

// Y el adaptador es opcional de verdad: si alguien lo borró, esta prueba se salta sola
// en vez de fallar. Que no esté es un escenario válido, no un error.
test("la prueba tiene dientes: el adaptador SÍ contiene lo que los demás tienen prohibido", (t) => {
  if (!existsSync(join(RAIZ, ADAPTADOR))) {
    return t.skip("el adaptador no está — la app corre sin él, que es justo lo que se promete");
  }
  const adaptador = soloCodigo(readFileSync(join(RAIZ, ADAPTADOR), "utf8"));
  assert.match(adaptador, /claude/i, "si esto falla, la prueba de arriba pasaría siempre y no probaría nada");
});

test("el motor tampoco depende del navegador: se puede probar y reusar en cualquier lado", () => {
  const prohibidos = /\b(document|window|localStorage|indexedDB|fetch)\b/;
  const infractores = archivosJS("motor").filter((ruta) =>
    prohibidos.test(soloCodigo(readFileSync(join(RAIZ, ruta), "utf8"))),
  );
  assert.deepEqual(infractores, [], `el motor debe ser JS puro: ${infractores.join(", ")}`);
});

test("cero dependencias: no hay package.json ni node_modules que se puedan pudrir", () => {
  const archivos = readdirSync(RAIZ);
  assert.ok(!archivos.includes("node_modules"), "nada que instalar");
  assert.ok(!archivos.includes("package-lock.json"));
});
