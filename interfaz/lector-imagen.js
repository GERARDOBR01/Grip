// Lector de capturas de pantalla — OPCIONAL Y BORRABLE.
//
// El texto de una notificación del banco no se puede seleccionar. Una captura de pantalla se
// hace con dos botones. Así que esto lee la captura.
//
// Lo que hace es UNA cosa: convertir píxeles en texto. El monto, la fecha y el comercio los
// saca después `interpretar()` de motor/lectura.js, con las mismas reglas deterministas que
// leen un correo pegado — así que el lector hereda gratis todo lo que el motor ya sabe
// (reconocer bancos, ver duplicados, fusionar preautorizaciones, aprender categorías) y ningún
// modelo decide un peso. La regla 1 del proyecto queda en pie.
//
// Corre dentro del dispositivo, en un Web Worker. La imagen no sale de aquí: no hay a dónde
// mandarla, y por eso el motor está commiteado en ocr/ en vez de bajarse de un CDN.
//
// Igual que el puente y el anfitrión: nadie lo importa. La app pregunta en tiempo de ejecución
// si `leerImagen` existe, y si no, la puerta no se pinta. Bórralo, arma, y queda igual.

const CARPETA_OCR = "./ocr/";

/** Debajo de esto el texto de una captura recortada sale borroso al ampliarlo. */
const ANCHO_MINIMO = 1000;

/** Y arriba de esto no se gana precisión, solo segundos de espera. */
const ANCHO_MAXIMO = 2200;

/**
 * El techo de PÍXELES, que es el que de verdad protege.
 *
 * Un lienzo se reserva entero en memoria —cuatro bytes por píxel— y los navegadores tienen su
 * propio tope: Safari en móvil no da lienzos de más de 16.7 millones de píxeles y falla sin
 * decir por qué. El ancho solo no basta para quedarse por debajo: una captura larga de Android
 * —de esas que se hacen deslizando, 1080 de ancho por 12000 de alto— es angosta y aun así pide
 * casi 13 millones. O sea que el caso que más se rompía era justo el más común.
 */
const AREA_MAXIMA = 8_000_000;

/**
 * Por debajo de esta reducción, el texto de la captura ya no se lee — ni el OCR ni nadie.
 * Llegado ese punto no se entrega una lectura mala haciéndola pasar por buena: se dice que la
 * imagen es demasiado grande y qué hacer al respecto.
 */
const ESCALA_MINIMA_UTIL = 0.45;

/**
 * Lo que se espera antes de dar por colgado el motor.
 *
 * Sin plazo, un worker que se traba deja «leyendo…» para siempre y la única salida es cerrar
 * la app. Es de sobra para la primera vez, que es la lenta: son 4 MB de motor que arrancar.
 */
const PLAZO_MS = 60000;

// El motor pesa 4 MB y tarda en arrancar: se carga UNA vez y se queda para las siguientes.
let motorEnCurso = null;

/**
 * Arranca el motor de OCR, o devuelve el que ya estaba.
 *
 * El `import()` va con `await` y asignado a propósito: el armado concatena todo en un solo
 * ámbito y tumba cualquier línea que EMPIECE por `import`. Ésta empieza por `const`.
 */
async function arrancarMotor() {
  if (motorEnCurso) return motorEnCurso;

  motorEnCurso = (async () => {
    const modulo = await import(`${CARPETA_OCR}lib.js`);
    const cliente = new modulo.OCRClient({ workerURL: `${CARPETA_OCR}tesseract-worker.js` });
    // El modelo se le pasa como dirección: lo baja él, de este mismo origen. Así este archivo
    // no toca la red, y la guarda de independencia.test.js sigue diciendo la verdad.
    await cliente.loadModel(`${CARPETA_OCR}spa.traineddata`);
    return cliente;
  })();

  try {
    return await motorEnCurso;
  } catch (e) {
    motorEnCurso = null; // que un arranque fallido no deje el lector muerto para siempre
    throw e;
  }
}

/**
 * El umbral que mejor separa la tinta del fondo, por el método de Otsu.
 *
 * Es el paso que más precisión da, y en una captura de pantalla es casi trivial: el texto es
 * renderizado, de alto contraste y sin sombras — el mejor caso posible del OCR. Se busca el
 * corte que deja los dos grupos de píxeles lo más separados que se pueda entre sí.
 */
function umbralDeOtsu(histograma, total) {
  let sumaTotal = 0;
  for (let i = 0; i < 256; i++) sumaTotal += i * histograma[i];

  let sumaFondo = 0;
  let pesoFondo = 0;
  let mejorVarianza = -1;
  let mejorUmbral = 128;

  for (let u = 0; u < 256; u++) {
    pesoFondo += histograma[u];
    if (pesoFondo === 0) continue;
    const pesoFrente = total - pesoFondo;
    if (pesoFrente === 0) break;

    sumaFondo += u * histograma[u];
    const mediaFondo = sumaFondo / pesoFondo;
    const mediaFrente = (sumaTotal - sumaFondo) / pesoFrente;
    const varianza = pesoFondo * pesoFrente * (mediaFondo - mediaFrente) ** 2;

    if (varianza > mejorVarianza) {
      mejorVarianza = varianza;
      mejorUmbral = u;
    }
  }
  return mejorUmbral;
}

/**
 * Cuánto hay que escalar esta imagen antes de leerla, o `null` si no hay escala que sirva.
 *
 * Va aparte porque es aritmética y punto: así se prueba exacta y al instante, sin arrancar
 * cuatro megas de motor para comprobar una división. Dos reglas, y la segunda manda:
 *
 *   1. Por ANCHO: se amplía lo angosto —una captura recortada sale borrosa si no— y se reduce
 *      lo enorme. La versión anterior de esta cuenta solo sabía ampliar: `ANCHO_MAXIMO` estaba
 *      escrito pero no se aplicaba nunca, así que una foto de 4000 px se procesaba entera,
 *      lenta y sin ganar una letra.
 *   2. Por ÁREA, que es la que de verdad protege. Una captura de las que se hacen deslizando
 *      —1080 de ancho, 12000 de alto— pasa el filtro de ancho sin despeinarse y aun así pide
 *      casi 13 millones de píxeles, por encima de lo que da un lienzo en Safari móvil.
 *
 * Y si para caber hubiera que encoger tanto que las letras dejen de leerse, devuelve `null`
 * en vez de una escala inservible: más vale pedir que recorte la captura que entregarle una
 * lectura inventada. Es la regla 2 del proyecto aplicada a los píxeles.
 */
export function escalaPara(ancho, alto) {
  if (!(ancho > 0) || !(alto > 0)) return null;

  let escala = 1;
  if (ancho < ANCHO_MINIMO) escala = ANCHO_MINIMO / ancho;
  else if (ancho > ANCHO_MAXIMO) escala = ANCHO_MAXIMO / ancho;

  const area = ancho * alto * escala * escala;
  if (area > AREA_MAXIMA) escala *= Math.sqrt(AREA_MAXIMA / area);

  return escala < ESCALA_MINIMA_UTIL ? null : escala;
}

/**
 * Deja la imagen como al OCR le gusta: gris, del tamaño adecuado y en blanco y negro.
 *
 * Y siempre con la tinta oscura sobre fondo claro. Media México trae el teléfono en modo
 * oscuro, y una notificación blanca sobre negro se lee bastante peor: si el fondo salió
 * oscuro, se invierte.
 */
async function prepararImagen(archivo) {
  const mapa = await createImageBitmap(archivo);

  const escala = escalaPara(mapa.width, mapa.height);
  if (escala === null) {
    mapa.close();
    throw new Error(
      "esa captura es demasiado grande para leerla entera. Recórtala a la parte del aviso " +
      "—el monto y el comercio— y vuelve a intentarlo.",
    );
  }

  const ancho = Math.round(mapa.width * escala);
  const alto = Math.round(mapa.height * escala);

  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const pincel = lienzo.getContext("2d", { willReadFrequently: true });
  pincel.imageSmoothingQuality = "high";
  pincel.drawImage(mapa, 0, 0, ancho, alto);
  mapa.close();

  const datos = pincel.getImageData(0, 0, ancho, alto);
  const pixeles = datos.data;
  const histograma = new Uint32Array(256);
  const grises = new Uint8ClampedArray(pixeles.length / 4);

  for (let i = 0, g = 0; i < pixeles.length; i += 4, g++) {
    // Los coeficientes de luminancia de siempre: el ojo no pesa igual los tres canales.
    const gris = (pixeles[i] * 0.299 + pixeles[i + 1] * 0.587 + pixeles[i + 2] * 0.114) | 0;
    grises[g] = gris;
    histograma[gris]++;
  }

  const umbral = umbralDeOtsu(histograma, grises.length);

  let oscuros = 0;
  for (let g = 0; g < grises.length; g++) if (grises[g] <= umbral) oscuros++;
  const fondoOscuro = oscuros > grises.length / 2;

  for (let i = 0, g = 0; i < pixeles.length; i += 4, g++) {
    const claro = grises[g] > umbral;
    const valor = (fondoOscuro ? !claro : claro) ? 255 : 0;
    pixeles[i] = pixeles[i + 1] = pixeles[i + 2] = valor;
    pixeles[i + 3] = 255;
  }

  return datos;
}

/** ¿Este navegador puede? Se pregunta antes de ofrecer el botón, no después de fallar. */
export function puedeLeerImagenes() {
  return typeof createImageBitmap === "function" &&
    typeof document !== "undefined" &&
    typeof WebAssembly === "object";
}

/**
 * Lee una captura de pantalla y devuelve `{ texto, error }`. NUNCA lanza.
 *
 * La imagen no se guarda en ningún lado: se lee y se tira. Un álbum de capturas de tus gastos
 * es exactamente lo que este proyecto no quiere tener.
 */
export async function leerImagen(archivo, alAvanzar = () => {}) {
  if (!archivo || !puedeLeerImagenes()) {
    return { texto: "", error: "Este navegador no puede leer imágenes." };
  }

  let cliente = null;
  let seColgo = false;

  try {
    const trabajo = (async () => {
      alAvanzar("preparando");
      const imagen = await prepararImagen(archivo);

      alAvanzar("arrancando");
      cliente = await arrancarMotor();

      alAvanzar("leyendo");
      await cliente.loadImage(imagen);
      return await cliente.getText();
    })();

    // El plazo corre contra TODO el trabajo, no contra un paso. Un worker de wasm que se traba
    // no lanza ni contesta: se queda callado, y sin esto la pantalla se queda en «leyendo…»
    // hasta que alguien cierra la app. Un botón que no vuelve nunca es peor que uno que falla.
    const texto = await Promise.race([
      trabajo,
      new Promise((_, romper) => setTimeout(() => {
        seColgo = true;
        romper(new Error("el lector tardó demasiado y se canceló"));
      }, PLAZO_MS)),
    ]);

    // Se suelta la imagen del motor en cuanto se leyó: el wasm no devuelve memoria al sistema
    // y una captura de 2200px no es poca cosa.
    await cliente.clearImage();

    return { texto: String(texto || "").trim(), error: null };
  } catch (e) {
    await soltarMotor(cliente, seColgo);
    return { texto: "", error: `No pude leer la imagen: ${e.message}` };
  }
}

/**
 * Deja el motor en un estado del que se pueda volver a intentar.
 *
 * Si solo falló la lectura, basta con soltar la imagen: el motor sigue bueno y arrancarlo otra
 * vez cuesta 4 MB y varios segundos. Si se COLGÓ, no: ese worker ya no contesta y guardarlo
 * significa que el siguiente intento también se cuelgue. Se tira y el próximo arranca limpio.
 */
async function soltarMotor(cliente, seColgo) {
  if (!cliente) return;
  try {
    if (seColgo) {
      motorEnCurso = null;
      if (typeof cliente.destroy === "function") await cliente.destroy();
    } else {
      await cliente.clearImage();
    }
  } catch (e) {}
}
