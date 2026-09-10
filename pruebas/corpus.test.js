// El corpus — la cobertura crece con datos, no con código.
//
// Es el patrón de los parsers que aguantan decenas de bancos: un archivo por aviso y UNA
// prueba que los recorre. Añadir un banco es añadir dos archivos.
//
// Estas fixtures reproducen la ESTRUCTURA de correos reales con valores inventados. Los datos
// de verdad no entran al repositorio; ver pruebas/correos/LEEME.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { interpretar } from "../motor/lectura.js";

const CARPETA = join(dirname(fileURLToPath(import.meta.url)), "correos");
const HOY = "2026-09-09";

// El .json NO se lee aquí. Se lee dentro de la prueba de cada caso, a propósito: un `.txt` sin
// su `.json` reventaba este `.map()` antes de que corriera una sola prueba —incluida la guarda
// de corpus vacío de aquí abajo, que existe justo para eso— y el archivo entero se caía con un
// ENOENT que no decía qué caso faltaba. Que falte una expectativa tiene que fallar ruidosamente
// y con nombre y apellido, como falla el armado.
const casos = readdirSync(CARPETA)
  .filter((n) => n.endsWith(".txt"))
  .map((n) => {
    const crudo = readFileSync(join(CARPETA, n), "utf8");
    const [primera, ...resto] = crudo.split("\n");
    const remitente = primera.startsWith("De:") ? primera.slice(3).trim() : "";
    return {
      nombre: n.replace(".txt", ""),
      remitente,
      texto: remitente ? resto.join("\n") : crudo,
      archivoEspera: join(CARPETA, n.replace(".txt", ".json")),
    };
  });

/** Lo que el lector DEBE sacar de este aviso, o un error que dice qué archivo falta. */
function expectativaDe(caso) {
  try {
    return JSON.parse(readFileSync(caso.archivoEspera, "utf8"));
  } catch (e) {
    assert.fail(
      `${caso.nombre}: no pude leer su expectativa (${caso.archivoEspera}) — ${e.message}\n` +
      "Cada aviso son DOS archivos: el .txt y el .json con lo que debe salir de él.\n" +
      "Si el .json existe en tu disco pero no en un clon limpio, míralo con `git check-ignore -v`: " +
      "el `*.json` del .gitignore se lo puede estar tragando.",
    );
  }
}

test("el corpus no está vacío: si lo estuviera, estas pruebas pasarían sin probar nada", () => {
  assert.ok(casos.length >= 3, `solo ${casos.length} avisos en el corpus`);
});

for (const caso of casos) {
  test(`corpus · ${caso.nombre}`, () => {
    const leido = interpretar(caso.texto, caso.remitente, HOY);
    assert.ok(leido.movimiento, "debería producir un movimiento");

    const obtenido = {
      banco: leido.banco,
      tipo: leido.movimiento.tipo,
      monto: leido.movimiento.monto,
      fecha: leido.movimiento.fecha,
      comercio: leido.comercio,
      ultimos4: leido.ultimos4,
      confianza: leido.confianza,
    };

    for (const [campo, esperado] of Object.entries(expectativaDe(caso))) {
      assert.equal(obtenido[campo], esperado,
        `${campo}: esperaba ${JSON.stringify(esperado)} y salió ${JSON.stringify(obtenido[campo])}` +
        (campo === "confianza" ? ` — motivo: ${leido.veredicto.motivo}` : ""));
    }
  });
}

// La regla del proyecto, comprobada y no solo escrita.
test("el corpus no lleva datos reales de nadie", () => {
  const sospechoso = /clabe|@gmail|@hotmail|@outlook|\b\d{16}\b|\b\d{18}\b/i;
  for (const caso of casos) {
    assert.doesNotMatch(caso.texto, sospechoso, `${caso.nombre} trae algo que parece un dato real`);
  }
});
