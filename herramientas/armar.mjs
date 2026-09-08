// Armado — junta los módulos en un archivo HTML que se abre solo.
//
// No hay bundler, ni npm, ni nada que instalar: los módulos se concatenan en un orden fijo
// y se les quitan los `import`/`export`, porque en el navegador viven todos en el mismo
// ámbito. Es suficiente para este proyecto y no envejece.
//
// El armado FALLA RUIDOSAMENTE ante lo que produciría un HTML roto en silencio:
//   · un archivo .js que existe pero nadie metió en la lista,
//   · dos módulos que declaran el mismo nombre de nivel superior,
//   · un import o export que quedó sin resolver.
// Un build que calla y entrega basura es peor que un build que se detiene.
//
// Uso: node herramientas/armar.mjs

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { LOGO_PNG, LOGO_SVG } from "../interfaz/logo-datos.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

// Orden de armado. Las funciones se izan, pero las constantes de nivel superior no:
// el motor va antes que quien lo usa.
const MODULOS = [
  "motor/dinero.js",
  "motor/veredicto.js",
  "motor/ciclo.js",
  "motor/modelo.js",
  "motor/migraciones.js",
  "motor/presupuesto.js",
  "motor/ahorro.js",
  "motor/metas.js",
  "motor/fijos.js",
  "motor/deudas.js",
  "almacen/archivo.js",
  "almacen/local.js",
  "almacen/almacen.js",
  { ruta: "almacen/anfitrion-claude.js", opcional: true }, // borrarlo no rompe nada
  "interfaz/ui.js",
];

// El nombre de la app vive AQUÍ y en ningún otro lado: la pantalla lo lee del <title>.
const TITULO = "Quincena";
const DESCRIPCION = "Ordena tu quincena, controla tus gastos y sabe si tus metas de ahorro de verdad alcanzan.";

function fallar(mensaje) {
  console.error(`\n✗ Armado detenido: ${mensaje}\n`);
  process.exit(1);
}

const declarados = new Map();

function declaraciones(codigo, ruta) {
  const nombres = [];
  const patron = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  let coincidencia;
  while ((coincidencia = patron.exec(codigo))) nombres.push(coincidencia[1]);

  for (const nombre of nombres) {
    if (declarados.has(nombre)) {
      fallar(`"${nombre}" está declarado en ${declarados.get(nombre)} y otra vez en ${ruta}. ` +
        `Al concatenar comparten ámbito y uno pisaría al otro.`);
    }
    declarados.set(nombre, ruta);
  }
}

function limpiar(codigo) {
  return codigo
    .replace(/^import\b[^;]*;\s*$/gm, "") // los imports sobran: todo queda en el mismo ámbito
    .replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, "")
    .trimEnd();
}

// Datos del ícono: los usa este armado para escribir los PNG y para incrustarlos, pero no
// tienen nada que hacer dentro del guion de la app.
const FUERA_DEL_GUION = new Set(["interfaz/logo-datos.js"]);

// 1) Nadie se queda fuera de la lista por olvido.
const enLista = new Set([...MODULOS.map((m) => (typeof m === "string" ? m : m.ruta)), ...FUERA_DEL_GUION]);
for (const carpeta of ["motor", "almacen", "interfaz"]) {
  for (const archivo of readdirSync(join(RAIZ, carpeta)).filter((n) => n.endsWith(".js"))) {
    const ruta = `${carpeta}/${archivo}`;
    if (!enLista.has(ruta)) fallar(`${ruta} existe pero no está en MODULOS: no se armaría en la app.`);
  }
}

// 2) Concatenar.
const partes = [];
for (const entrada of MODULOS) {
  const ruta = typeof entrada === "string" ? entrada : entrada.ruta;
  let codigo;
  try {
    codigo = readFileSync(join(RAIZ, ruta), "utf8");
  } catch (e) {
    if (typeof entrada !== "string" && entrada.opcional) {
      console.log(`  · ${ruta} no está — se arma sin él (es opcional, así está diseñado)`);
      continue;
    }
    fallar(`no se pudo leer ${ruta}: ${e.message}`);
  }
  declaraciones(codigo, ruta);
  partes.push(`// ═══ ${ruta} ═══\n${limpiar(codigo)}`);
}

const cuerpo = partes.join("\n\n");

// 3) Nada de imports o exports vivos: en el navegador reventarían.
const sobrantes = cuerpo.match(/^\s*(import|export)\b.*$/gm);
if (sobrantes) fallar(`quedaron sentencias sin resolver:\n    ${sobrantes.slice(0, 5).join("\n    ")}`);

const guion = `(function () {
"use strict";

${cuerpo}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar);
else arrancar();
})();`;

// 4) Y que lo armado sea JavaScript válido. Parece obvio: por no comprobarlo, un `\\"`
//    dentro de una expresión de plantilla se coló hasta el navegador y la app no arrancó.
//    `new Function` lo parsea sin ejecutar una sola línea.
try {
  new Function(guion);
} catch (e) {
  fallar(`lo armado no es JavaScript válido: ${e.message}`);
}

const estilos = readFileSync(join(RAIZ, "interfaz/estilos.css"), "utf8");
const marcado = readFileSync(join(RAIZ, "interfaz/plantilla.html"), "utf8");
const sello = new Date().toISOString().slice(0, 10);

const DESCRIPCION_CORTA = "Ordena tu quincena y sabe si tus metas de ahorro alcanzan.";
// Dónde vive publicada. Si cambia el repo, se cambia aquí y en ningún otro lado.
const URL_PUBLICA = "https://gerardobr01.github.io/Quincena-/";
const FONDO = "#14171A";
const ACENTO = "#1f8a55";

const png = (tamano) => `data:image/png;base64,${LOGO_PNG[tamano]}`;
const svgIcono = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG, "utf8").toString("base64")}`;

const encabezado = `<title>${TITULO}</title>
<meta name="description" content="${DESCRIPCION}">
<style>
${estilos}</style>`;

// Lo que convierte una página en una app con ícono propio en el celular.
const metaApp = `<meta name="theme-color" content="${ACENTO}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${TITULO}">`;

const guionEnvuelto = `<script>
${guion}
</script>`;

// ── Salida A: autónoma. Ésta es la app. Se abre desde el disco, sin servidor y sin red.
// El ícono va incrustado, así que "Añadir a pantalla de inicio" en iOS ya le pone cara.
const autonoma = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
${metaApp}
<link rel="icon" href="${svgIcono}">
<link rel="apple-touch-icon" href="${png(180)}">
${encabezado}
</head>
<body>
<!-- Armado el ${sello} desde finanzas/. No editar a mano: se regenera con armar.mjs. -->
${marcado}
${guionEnvuelto}
</body>
</html>
`;

// ── Salida B: la misma app para publicar donde el entorno pone su propio envoltorio.
const publicable = `${encabezado}
${marcado}
${guionEnvuelto}
`;

// ── Salida C: la carpeta que se sube a un hosting. Misma app, más lo que Android e iOS
// piden para instalarla: manifest, íconos de verdad y un service worker que la deja abrir
// sin conexión. Nada de esto lo necesita la salida A para funcionar.
const manifiesto = {
  name: TITULO,
  short_name: TITULO,
  description: DESCRIPCION_CORTA,
  lang: "es-MX",
  start_url: "./",
  scope: "./",
  display: "standalone",
  orientation: "portrait",
  background_color: FONDO,
  theme_color: ACENTO,
  icons: [
    { src: "./icono-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "./icono-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
};

const hospedada = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
${metaApp}
<link rel="icon" href="./icono-192.png">
<link rel="apple-touch-icon" href="./icono-180.png">
<link rel="manifest" href="./manifest.webmanifest">
${encabezado}
</head>
<body>
<!-- Armado el ${sello} desde finanzas/. No editar a mano: se regenera con armar.mjs. -->
${marcado}
${guionEnvuelto}
<script>
// El service worker es un extra de esta salida: solo sirve para poder abrirla sin conexión
// una vez instalada. Si no está o falla, la app funciona exactamente igual.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  addEventListener("load", function () {
    navigator.serviceWorker.register("./sw.js").catch(function () {});
  });
}
</script>
</body>
</html>
`;

const serviceWorker = `// Service worker de Quincena — armado el ${sello}.
//
// Guarda la app para poder abrirla sin conexión. No guarda NINGÚN dato tuyo: los movimientos
// viven en el almacenamiento del navegador, que esto ni toca.

const CACHE = "quincena-${sello}";
const ARCHIVOS = ["./", "./index.html", "./manifest.webmanifest", "./icono-192.png", "./icono-512.png", "./icono-180.png"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (evento) => {
  // Al publicar una versión nueva, las viejas se tiran: nada de servir una app de hace meses.
  evento.waitUntil(
    caches.keys()
      .then((llaves) => Promise.all(llaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evento) => {
  if (evento.request.method !== "GET") return;
  evento.respondWith(
    fetch(evento.request)
      .then((respuesta) => {
        const copia = respuesta.clone();
        caches.open(CACHE).then((cache) => cache.put(evento.request, copia)).catch(() => {});
        return respuesta;
      })
      .catch(() => caches.match(evento.request).then((r) => r || caches.match("./index.html"))),
  );
});
`;

// Lo que GitHub Pages sirve va en la RAÍZ del repositorio: index.html y sus acompañantes.
// La variante del enlace privado va aparte, porque no es parte del sitio.
mkdirSync(join(RAIZ, "publicar"), { recursive: true });
writeFileSync(join(RAIZ, "finanzas.html"), autonoma);
writeFileSync(join(RAIZ, "publicar/finanzas.artifact.html"), publicable);
writeFileSync(join(RAIZ, "index.html"), hospedada);
writeFileSync(join(RAIZ, "manifest.webmanifest"), JSON.stringify(manifiesto, null, 2));
writeFileSync(join(RAIZ, "sw.js"), serviceWorker);
for (const tamano of [180, 192, 512]) {
  writeFileSync(join(RAIZ, `icono-${tamano}.png`), Buffer.from(LOGO_PNG[tamano], "base64"));
}

const kb = (t) => `${(Buffer.byteLength(t) / 1024).toFixed(1)} KB`;
console.log(`\n✓ Armado (${MODULOS.length - 1}+ módulos, ${declarados.size} nombres, 0 dependencias)`);
console.log(`  index.html + manifest + sw + íconos   ${kb(hospedada)}  ← lo que sirve Pages`);
console.log(`  finanzas.html                         ${kb(autonoma)}  ← autónoma: ábrela desde el disco`);
console.log(`  publicar/finanzas.artifact.html       ${kb(publicable)}\n`);
