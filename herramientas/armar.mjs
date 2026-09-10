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
import { createHash } from "node:crypto";
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
  "motor/fusion.js",
  "motor/presupuesto.js",
  "motor/ahorro.js",
  "motor/metas.js",
  "motor/fijos.js",
  "motor/deudas.js",
  "motor/reglas-banco.js",
  "motor/campos.js",
  "motor/rapido.js",
  "motor/lectura.js",
  "motor/aprendizaje.js",
  "motor/recurrentes.js",
  "motor/tendencia.js",
  "motor/bandeja.js",
  "motor/recordatorios.js", // después de fijos y bandeja: lee de los dos
  "almacen/intenciones.js",
  "almacen/archivo.js",
  "almacen/local.js",
  "almacen/almacen.js",
  { ruta: "almacen/anfitrion-claude.js", opcional: true }, // borrarlo no rompe nada
  { ruta: "almacen/puente-correo.js", opcional: true },    // tampoco
  "interfaz/avisos.js",
  { ruta: "interfaz/lector-imagen.js", opcional: true }, // borrarlo deja la app sin OCR, y ya
  "interfaz/ui.js",
];

// El nombre de la app vive AQUÍ y en ningún otro lado: la pantalla lo lee del <title>.
const TITULO = "Grip";
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
// El sello de esta versión sale del CONTENIDO armado, no del calendario.
//
// Antes era la fecha del día, y eso costaba dos cosas que no se ven hasta que muerden: armar
// dos veces sin tocar nada producía archivos distintos —así que nadie podía comprobar que lo
// publicado corresponde a las fuentes— y le tiraba la caché a todo mundo por haber pasado un
// día. Con el hash el sello cambia exactamente cuando cambia la app: ni antes, ni después.
const sello = createHash("sha256")
  .update(guion)
  .update(estilos)
  .update(marcado)
  .update(LOGO_SVG)
  .update(LOGO_PNG[192])
  .update(LOGO_PNG[512])
  .update(LOGO_PNG[180])
  .digest("hex")
  .slice(0, 8);

const DESCRIPCION_CORTA = "Ordena tu quincena y sabe si tus metas de ahorro alcanzan.";
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
<!-- Armado desde finanzas/, versión ${sello}. No editar a mano: se regenera con armar.mjs. -->
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
  // Compartir un correo del banco a la app desde Android: llega como ?texto=... y la app lo
  // lee sola. Es GET a propósito — un POST necesitaría que el service worker lo interceptara,
  // y una pieza más que puede fallar entre el aviso y la bandeja no vale lo que cuesta.
  share_target: {
    action: "./",
    method: "GET",
    params: { title: "titulo", text: "texto", url: "enlace" },
  },
  // Dejar apretado el ícono en Android lleva directo a lo que se hace a diario, sin pasar por
  // la pantalla de Hoy. Son las dos únicas cosas que se hacen a diario; una lista más larga
  // sería un menú, y un menú no ahorra nada.
  shortcuts: [
    {
      name: "Pegar un aviso",
      short_name: "Pegar",
      description: "Pega el correo del banco y cae leído en la bandeja",
      url: "./?atajo=pegar",
      icons: [{ src: "./icono-192.png", sizes: "192x192" }],
    },
    {
      name: "Gasto rápido",
      short_name: "Gasto",
      description: "Captura un gasto en efectivo",
      url: "./?atajo=rapido",
      icons: [{ src: "./icono-192.png", sizes: "192x192" }],
    },
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
<!-- Armado desde finanzas/, versión ${sello}. No editar a mano: se regenera con armar.mjs. -->
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

const serviceWorker = `// Service worker de Grip — versión ${sello}, que es el hash de lo armado.
//
// Guarda la app para poder abrirla sin conexión. No guarda NINGÚN dato tuyo: los movimientos
// viven en el almacenamiento del navegador, que esto ni toca.

const CACHE = "grip-${sello}";
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
  // Solo lo de esta app. Si algún día se consulta algo de fuera (el puente de correo, por
  // ejemplo), guardarlo en caché serviría respuestas viejas como si fueran de ahora.
  if (new URL(evento.request.url).origin !== self.location.origin) return;
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

// ── La sombra de notificaciones, que es donde vive la gente ────────────────
//
// Aceptar un cargo desde aquí ES aceptarlo: un toque en la sombra vale lo mismo que abrir la
// app, ir a la bandeja y darle Aceptar. Eso son cinco pasos para decir que sí a un cargo que
// ya conocías; aquí es uno, sin desbloquear nada.
//
// Lo que NO pasa aquí es el cálculo. El motor vive en un solo lugar y no se copia dentro del
// service worker: esto recoge la INTENCIÓN y se la pasa a la app. Si hay una ventana abierta,
// ahora mismo; si no, se guarda y la app la recoge al abrir. Así se sigue cumpliendo la regla
// de siempre —nada cuenta hasta que la persona lo acepta— porque esto es la persona
// aceptándolo.

const INTENCIONES = "grip-intenciones";

/** Guarda la intención para que la app la aplique al abrir. Nunca lanza. */
function guardarIntencion(intencion) {
  return new Promise((listo) => {
    let peticion;
    try {
      peticion = indexedDB.open(INTENCIONES, 1);
    } catch (e) {
      return listo(false);
    }
    peticion.onupgradeneeded = () => {
      const base = peticion.result;
      if (!base.objectStoreNames.contains("cola")) base.createObjectStore("cola", { autoIncrement: true });
    };
    peticion.onerror = () => listo(false);
    peticion.onsuccess = () => {
      try {
        const base = peticion.result;
        const trato = base.transaction("cola", "readwrite");
        trato.objectStore("cola").add(intencion);
        trato.oncomplete = () => { base.close(); listo(true); };
        trato.onerror = () => { base.close(); listo(false); };
      } catch (e) {
        listo(false);
      }
    };
  });
}

self.addEventListener("notificationclick", (evento) => {
  const info = evento.notification.data || {};
  const accion = evento.action || "abrir";
  const intencion = {
    accion,
    entradaId: info.entradaId || null,
    // Respuesta escrita en la sombra, donde el navegador la ofrezca. Donde no, viene vacía y
    // no pasa nada: se abre la app, que es la caída natural.
    texto: evento.reply || "",
    cuando: Date.now(),
  };
  evento.notification.close();

  evento.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

    // Con la app abierta se le pasa directo: la aplica con el motor de siempre y se ve al
    // instante, sin pasar por la cola.
    if (ventanas.length) {
      ventanas[0].postMessage({ de: "grip", intencion });
      if (accion !== "aceptar") {
        try { await ventanas[0].focus(); } catch (e) {}
      }
      return;
    }

    const guardado = await guardarIntencion(intencion);

    // Aceptar NO abre la app: ése es el punto entero. Solo se abre si NO se pudo guardar la
    // intención, porque tragarse un cargo en silencio sí sería grave.
    if (accion !== "aceptar" || !guardado) {
      try { await self.clients.openWindow(accion === "aceptar" ? "./" : "./?atajo=bandeja"); } catch (e) {}
      return;
    }

    // Un toque que no da señal se siente roto aunque haya funcionado. El acuse reemplaza al
    // aviso original —mismo tag— así que no se acumulan.
    if (info.acuse) {
      try {
        await self.registration.showNotification(info.acuse, {
          body: "Ya cuenta en tus números.",
          icon: "./icono-192.png",
          badge: "./icono-192.png",
          tag: evento.notification.tag,
          silent: true,
        });
      } catch (e) {}
    }
  })());
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
