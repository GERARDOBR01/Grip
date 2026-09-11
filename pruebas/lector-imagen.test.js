// La aritmética del lector de capturas.
//
// Se prueba aquí y no en el navegador a propósito: es una división, y comprobarla arrancando
// cuatro megas de motor de OCR sería tardar treinta segundos en saber lo que se sabe al
// instante. Lo que sí necesita un navegador —que pegar una captura la lea de verdad— vive en
// herramientas/humo.mjs, que es donde tiene que estar.
//
// Este archivo importa de interfaz/ y no de motor/ porque el lector es un ADAPTADOR opcional:
// vive fuera del motor a propósito, para poder borrarlo. Pero su cuenta de escala no toca el
// DOM, así que se puede probar como cualquier otra cosa.

import { test } from "node:test";
import assert from "node:assert/strict";
import { escalaPara } from "../interfaz/lector-imagen.js";

/** Lo que costaría el lienzo, en millones de píxeles. Es lo que revienta un teléfono. */
function millones(ancho, alto, escala) {
  return (ancho * escala * alto * escala) / 1e6;
}

test("una captura de celular normal no se toca", () => {
  assert.equal(escalaPara(1080, 2400), 1);
});

test("un recorte chico se amplía: sin eso el texto sale borroso", () => {
  const escala = escalaPara(400, 180);
  assert.ok(escala > 1, `esperaba ampliación y salió x${escala}`);
  assert.equal(Math.round(400 * escala), 1000, "hasta el ancho mínimo, ni más ni menos");
});

test("una foto de cámara se REDUCE — antes no se reducía nunca", () => {
  // El fallo concreto: la cuenta anterior era un min/max que siempre daba 1 para lo ancho, así
  // que `ANCHO_MAXIMO` estaba escrito y no se aplicaba jamás. Una foto de 4000 px se procesaba
  // entera: varios segundos de espera y ni una letra de más.
  const escala = escalaPara(4000, 3000);
  assert.ok(escala < 1, `una foto de 4000 px tiene que reducirse, y salió x${escala}`);
  assert.equal(Math.round(4000 * escala), 2200);
});

test("ninguna imagen aceptada pide un lienzo más grande del que da un teléfono", () => {
  // Éste es el invariante que importa. Safari en móvil no da lienzos de más de 16.7 millones
  // de píxeles y falla sin decir por qué; el tope propio va bastante por debajo.
  const formas = [
    [1080, 2400], [1440, 3200], [4000, 3000], [1080, 12000], [1200, 26000],
    [720, 1600], [3000, 8000], [2200, 4000], [400, 180], [100, 6000],
  ];
  for (const [ancho, alto] of formas) {
    const escala = escalaPara(ancho, alto);
    if (escala === null) continue; // rechazada: tampoco pide lienzo
    assert.ok(millones(ancho, alto, escala) <= 8.001,
      `${ancho}x${alto} pediría ${millones(ancho, alto, escala).toFixed(1)}M px`);
  }
});

test("la captura deslizada de Android —el caso que más se rompía— sí cabe", () => {
  // Angosta y altísima: pasaba el filtro de ancho sin despeinarse y pedía casi 13 millones.
  const escala = escalaPara(1080, 12000);
  assert.ok(escala !== null, "no se rechaza: se reduce y se lee");
  assert.ok(millones(1080, 12000, escala) <= 8.001);
});

test("cuando encoger tanto dejaría el texto ilegible, se dice que no en vez de inventar", () => {
  assert.equal(escalaPara(1200, 50000), null);
  assert.equal(escalaPara(4000, 40000), null);
});

test("una imagen sin tamaño no es una imagen", () => {
  for (const [a, b] of [[0, 100], [100, 0], [-5, 100], [NaN, 100]]) {
    assert.equal(escalaPara(a, b), null, `${a}x${b} debería rechazarse`);
  }
});
