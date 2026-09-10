# El motor de OCR

Aquí vive lo único de este repositorio que no escribimos nosotros: el motor que convierte una
captura de pantalla en texto. Son 4.2 MB en disco y ~1.9 MB por la red, comprimidos.

## Qué hace y qué NO hace

Convierte **píxeles en texto**, y ahí se acaba su trabajo. El monto, la fecha y el comercio los
saca después `motor/lectura.js`, con las mismas reglas deterministas que lee un correo pegado.
Ningún modelo decide un peso: la regla 1 del proyecto sigue en pie.

Corre **dentro del dispositivo**, en un Web Worker. No manda la imagen a ningún lado —no hay a
dónde— y por eso estos archivos están commiteados en vez de bajarse de un CDN: así la app sigue
sin pedirle nada a internet, que es la promesa de siempre.

## De dónde salió

| Archivo | Origen | Licencia |
|---|---|---|
| `lib.js`, `tesseract-worker.js`, `tesseract-core.wasm` | [`tesseract-wasm`](https://github.com/robertknight/tesseract-wasm) v0.11.0, de npm | BSD-2-Clause (ver `LICENCIA-tesseract-wasm.md`) |
| `spa.traineddata` | [`tessdata_fast`](https://github.com/tesseract-ocr/tessdata_fast) | Apache-2.0 |

`tessdata_fast` es la versión de enteros de 8 bits: el compromiso entre velocidad y precisión.
Para una captura de pantalla —texto renderizado, alto contraste, sin inclinación ni sombras—
es de sobra; ése es el mejor caso posible del OCR.

## Decisiones que conviene no deshacer sin pensarlas

- **Solo va el núcleo con SIMD.** El paquete trae también `tesseract-core-fallback.wasm` para
  navegadores sin SIMD, otros 1.8 MB. WebAssembly SIMD lleva en Chrome, Firefox y Safari desde
  2021; un teléfono de hoy lo tiene. Donde no, el lector no se ofrece y se dice, en vez de
  cargar dos motores para todo el mundo por si acaso.
- **No se precargan en el service worker.** Se guardan en caché la primera vez que USAS el
  lector, no al instalar la app. Quien nunca lea una captura no paga 4 MB por nada.
- **El archivo suelto (`finanzas.html`) no lleva OCR.** No se puede meter un wasm de 1.8 MB
  dentro de un HTML sin volverlo absurdo. Se declara, no se disimula — igual que ese archivo
  tampoco lleva el puente.

## Cómo actualizarlo

Bajar el `.tgz` de npm, copiar `dist/lib.js`, `dist/tesseract-worker.js` y
`dist/tesseract-core.wasm`, y volver a correr las pruebas. El `spa.traineddata` casi nunca
cambia.
