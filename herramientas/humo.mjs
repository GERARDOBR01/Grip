// Prueba de humo en un navegador de verdad, abriendo el archivo desde el DISCO (file://),
// sin servidor y sin red. Si esto pasa, la app no depende de nadie para funcionar.
//
// Es la única pieza del proyecto que usa algo de fuera (Playwright, si está instalado en la
// máquina). No es una dependencia de la app: si no está, esta prueba se salta sola y la
// suite de `node --test` —que sí cubre todo el motor— sigue corriendo igual.
//
// Uso: node herramientas/humo.mjs

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (e) {
  try {
    ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs"));
  } catch (e2) {
    console.log("· Playwright no está instalado: se salta la prueba de navegador.");
    console.log("  El motor se prueba igual con: node --test pruebas/*.test.js");
    process.exit(0);
  }
}

const ARCHIVO = pathToFileURL(join(RAIZ, "finanzas.html")).href;

const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const pagina = await contexto.newPage();

const errores = [];
pagina.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`));
pagina.on("console", (m) => { if (m.type() === "error") errores.push(`console: ${m.text()}`); });

await pagina.goto(ARCHIVO);
await pagina.waitForSelector(".barra", { timeout: 5000 });

const paso = (nombre, ok, detalle = "") => console.log(`${ok ? "  ✓" : "  ✗"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
let fallos = 0;
const revisar = (nombre, ok, detalle) => { paso(nombre, ok, detalle); if (!ok) fallos++; };

// 1. Abre y declara su modo de guardado
const estado = (await pagina.textContent(".estado")).trim();
revisar("abre desde el disco y declara dónde guarda", estado.includes("Solo este dispositivo"), estado);

// 2. Estado vacío: no inventa números
const cifraInicial = await pagina.textContent(".cifra");
revisar("sin ingreso capturado NO muestra un cero disfrazado", cifraInicial.trim() === "—", cifraInicial.trim());
const veredictoInicial = await pagina.textContent(".marca");
revisar("declara SIN_DATOS_SUFICIENTES", veredictoInicial.includes("SIN_DATOS"), veredictoInicial);

// 3. Capturar el ingreso quincenal
await pagina.click('[data-accion="editar-ingreso"]');
await pagina.fill('[data-clave="monto"]', "8000");
await pagina.click('button[type="submit"]');
await pagina.waitForSelector(".velo", { state: "detached" });
const trasIngreso = (await pagina.textContent(".cifra")).trim();
revisar("con el ingreso capturado aparece el disponible", trasIngreso === "$8,000.00", trasIngreso);

// 4. Capturar un gasto: + → monto → categoría → guardar
await pagina.click('[data-accion="capturar"]');
await pagina.fill('[data-clave="monto"]', "450.50");
await pagina.click('.chips [data-valor="super"]');
await pagina.click('button[type="submit"]');
await pagina.waitForSelector(".velo", { state: "detached" });
const trasGasto = (await pagina.textContent(".cifra")).trim();
revisar("el gasto se descuenta del disponible", trasGasto === "$7,549.50", trasGasto);
revisar("el movimiento aparece en la lista", (await pagina.textContent("main")).includes("Súper"));

// 5. Presupuesto y semáforo
await pagina.click('[data-vista="presupuesto"]');
await pagina.waitForSelector(".barra-progreso");
revisar("una categoría sin tope se declara SIN_TOPE", (await pagina.textContent("main")).includes("SIN_TOPE"));
await pagina.click('[data-accion="editar-tope"]');
await pagina.fill('[data-clave="tope"]', "400");
await pagina.click('button[type="submit"]');
await pagina.waitForSelector(".velo", { state: "detached" });
revisar("con tope puesto, el semáforo marca el exceso", (await pagina.textContent("main")).includes("NO_ALCANZA"));

// 6. Meta imposible → NO_ALCANZA con su alternativa
await pagina.click('[data-vista="metas"]');
await pagina.click('[data-accion="nueva-meta"]');
await pagina.fill('[data-clave="nombre"]', "Coche");
await pagina.fill('[data-clave="objetivo"]', "300000");
await pagina.fill('[data-clave="fechaLimite"]', "2026-12-31");
await pagina.click('button[type="submit"]');
await pagina.waitForSelector(".velo", { state: "detached" });
const metas = await pagina.textContent("main");
revisar("una meta imposible se declara NO_ALCANZA", metas.includes("NO_ALCANZA"));
revisar("y ofrece la fecha realista calculada", /fecha realista/.test(metas), metas.match(/Con .* la fecha realista es el [^.]*/)?.[0] || "");

// 7. Persistencia real: recargar
await pagina.reload();
await pagina.waitForSelector(".barra");
const trasRecarga = (await pagina.textContent(".cifra")).trim();
revisar("tras recargar, los datos siguen ahí", trasRecarga === "$7,549.50", trasRecarga);

// 8. Fijos
await pagina.click('[data-vista="fijos"]');
await pagina.click('[data-accion="nuevo-fijo"]');
await pagina.fill('[data-clave="nombre"]', "Renta");
await pagina.fill('[data-clave="monto"]', "5000");
await pagina.fill('[data-clave="diaCorte"]', "5");
await pagina.click('button[type="submit"]');
await pagina.waitForSelector(".velo", { state: "detached" });
revisar("el fijo entra en el comprometido del mes", (await pagina.textContent("main")).includes("$5,000.00"));

await pagina.click('[data-vista="hoy"]');
revisar("y aparece en 'Por pagar' del panel", (await pagina.textContent("main")).includes("Por pagar"));

// 9. Los tres movimientos que no son un gasto, y corregir uno ya capturado
const cifra = async () => {
  const texto = (await pagina.locator(".cifra").first().textContent()).trim();
  return Number(texto.replace(/[^\d.]/g, "")) * (texto.includes("−") ? -1 : 1);
};
await pagina.click('[data-accion="capturar"]');
await pagina.click('[data-clave="tipo"] [data-valor="ingreso"]');
await pagina.waitForTimeout(120);
revisar("un ingreso no pide categoría", (await pagina.locator('[data-clave="categoria"]').count()) === 0);
await pagina.fill('[data-clave="monto"]', "500");
await pagina.click('button[type="submit"]');
await pagina.waitForSelector(".velo", { state: "detached" });

const antesApartar = await cifra();
await pagina.click('[data-accion="capturar"]');
await pagina.click('[data-clave="tipo"] [data-valor="ahorro"]');
await pagina.waitForTimeout(120);
await pagina.fill('[data-clave="monto"]', "200");
await pagina.click('button[type="submit"]');
await pagina.waitForSelector(".velo", { state: "detached" });
const apartado = await cifra();
await pagina.click('[data-accion="capturar"]');
await pagina.click('[data-clave="tipo"] [data-valor="retiro"]');
await pagina.waitForTimeout(120);
await pagina.fill('[data-clave="monto"]', "50");
await pagina.click('button[type="submit"]');
await pagina.waitForSelector(".velo", { state: "detached" });
const retirado = await cifra();
revisar(
  "apartar baja el disponible y retirar lo devuelve",
  Math.round(antesApartar - apartado) === 200 && Math.round(retirado - apartado) === 50,
  `${antesApartar} → ${apartado} → ${retirado}`,
);

const antesDeCorregir = await pagina.locator('[data-accion="editar-movimiento"]').count();
await pagina.locator(".fila", { hasText: "Súper" }).locator('[data-accion="editar-movimiento"]').first().click();
await pagina.fill('[data-clave="monto"]', "999");
await pagina.click('button[type="submit"]');
await pagina.waitForSelector(".velo", { state: "detached" });
revisar(
  "corregir un movimiento no lo duplica",
  (await pagina.locator('[data-accion="editar-movimiento"]').count()) === antesDeCorregir,
);

// 10. Historial, con su buscador
await pagina.click('[data-accion="ver-historial"]');
revisar("el historial agrupa por mes", (await pagina.textContent("main")).includes("septiembre 2026"));
await pagina.fill("#buscador", "renta");
await pagina.waitForTimeout(150);
revisar("el buscador filtra sin perder el foco", await pagina.evaluate(() => document.activeElement.id === "buscador"));
await pagina.fill("#buscador", "");
await pagina.click('[data-vista="hoy"]');

// 11. Un pago anual no es un gasto mensual
await pagina.click('[data-vista="fijos"]');
await pagina.click('[data-accion="nuevo-fijo"]');
await pagina.fill('[data-clave="nombre"]', "Seguro anual");
await pagina.fill('[data-clave="monto"]', "12000");
await pagina.click('[data-clave="frecuencia"] [data-valor="12"]');
await pagina.waitForTimeout(150);
revisar("un fijo no mensual pregunta en qué mes toca", (await pagina.locator('[data-clave="mesAncla"]').count()) === 1);
await pagina.fill('[data-clave="mesAncla"]', "2026-03");
await pagina.fill('[data-clave="diaCorte"]', "10");
await pagina.click('button[type="submit"]');
await pagina.waitForSelector(".velo", { state: "detached" });
const textoFijos = await pagina.textContent("main");
revisar(
  "el seguro anual entra al promedio dividido entre 12, no completo",
  textoFijos.includes("Este mes en concreto se pagan") && textoFijos.includes("cada año · toca en marzo"),
);
await pagina.click('[data-vista="hoy"]');


revisar("ni un solo error de JavaScript", errores.length === 0, errores.slice(0, 3).join(" | "));

// ── Escenario 2: un navegador que NO deja guardar nada ──────────────────────────
//
// Un iframe sin `allow-same-origin` deja el documento en un origen opaco: ahí, hasta LEER
// window.localStorage lanza SecurityError, y confirm() también. Es el mismo terreno que el
// modo privado de algunos navegadores o los datos de sitio bloqueados. La app tiene que
// seguir usable y DECIRLO — nunca fingir que guardó.

console.log("\n  ── en un navegador que no deja guardar (origen aislado) ──");
const hoja = readFileSync(join(RAIZ, "finanzas.html"), "utf8");
const encerrada = await contexto.newPage();
const erroresEncerrada = [];
encerrada.on("pageerror", (e) => erroresEncerrada.push(e.message.slice(0, 120)));
await encerrada.setContent('<iframe id="m" sandbox="allow-scripts allow-forms" style="width:390px;height:800px;border:0"></iframe>');
await encerrada.evaluate((h) => { document.getElementById("m").srcdoc = h; }, hoja);
const marco = encerrada.frameLocator("#m");
await marco.locator(".barra").waitFor({ timeout: 8000 });

revisar("arranca igual", await marco.locator(".cifra").first().isVisible());
const modo = (await marco.locator(".estado").textContent()).trim();
revisar("NO miente sobre dónde guarda", modo.includes("Sin guardar"), modo);
revisar("avisa por su cuenta, sin que se lo pregunten", (await marco.locator(".aviso").first().textContent()).includes("no deja guardar"));

await marco.locator('[data-accion="editar-ingreso"]').click();
await marco.locator('[data-clave="monto"]').fill("8000");
await marco.locator('button[type="submit"]').click();
await marco.locator(".velo").waitFor({ state: "detached", timeout: 5000 });
revisar("se puede seguir capturando (en memoria)", (await marco.locator(".cifra").first().textContent()).trim() === "$8,000.00");

// Borrar todo usaba confirm(), que aquí lanza SecurityError.
await marco.locator('[data-vista="ajustes"]').click();
await marco.locator('[data-accion="borrar-todo"]').click();
revisar("la confirmación es propia y aparece (confirm() aquí lanza)", await marco.locator(".hoja").isVisible());
await marco.locator('button[type="submit"]').click();
await marco.locator(".velo").waitFor({ state: "detached", timeout: 5000 });
await marco.locator('[data-vista="hoy"]').click();
revisar("y borrar de verdad borra", (await marco.locator(".cifra").first().textContent()).trim() === "—");
revisar("sin un solo error de JavaScript", erroresEncerrada.length === 0, erroresEncerrada.slice(0, 2).join(" | "));

// ── Escenario 3: instalada como app ─────────────────────────────────────────────
//
// La carpeta app/ servida por http: es como vive cuando está subida a un hosting. Aquí se
// comprueba lo que Android e iOS piden para ofrecer "instalar", y lo que de verdad importa:
// que una vez instalada abra SIN CONEXIÓN. El servidor es el de Node — cero dependencias.

console.log("\n  ── servida por http, como app instalable ──");

const TIPOS_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

const servidor = createServer((peticion, respuesta) => {
  const nombre = decodeURIComponent(peticion.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const ruta = join(RAIZ, nombre);
  if (!ruta.startsWith(RAIZ) || !existsSync(ruta)) {
    respuesta.writeHead(404).end("no está");
    return;
  }
  const extension = nombre.slice(nombre.lastIndexOf("."));
  respuesta.writeHead(200, { "content-type": TIPOS_MIME[extension] || "application/octet-stream" });
  respuesta.end(readFileSync(ruta));
});

await new Promise((listo) => servidor.listen(0, "127.0.0.1", listo));
const puerto = servidor.address().port;

const instalada = await contexto.newPage();
await instalada.goto(`http://127.0.0.1:${puerto}/index.html`);
await instalada.waitForSelector(".barra", { timeout: 8000 });

const manifiesto = await instalada.evaluate(async () => {
  const enlace = document.querySelector('link[rel="manifest"]');
  if (!enlace) return null;
  const r = await fetch(enlace.href);
  return r.ok ? await r.json() : null;
});
revisar("el manifest carga y la declara instalable", Boolean(manifiesto) && manifiesto.display === "standalone");
revisar(
  "con íconos enmascarables, como piden Android e iOS",
  Boolean(manifiesto) && manifiesto.icons.length === 2 && manifiesto.icons.every((i) => i.purpose.includes("maskable")),
);

const medida = await instalada.evaluate(() => new Promise((res) => {
  const img = new Image();
  img.onload = () => res(`${img.naturalWidth}x${img.naturalHeight}`);
  img.onerror = () => res("no carga");
  img.src = "./icono-512.png";
}));
revisar("el ícono existe y mide lo que dice", medida === "512x512", medida);

const registro = await instalada.evaluate(async () => {
  for (let i = 0; i < 40; i++) {
    const r = await navigator.serviceWorker.getRegistration();
    if (r && (r.active || r.installing || r.waiting)) return "sí";
    await new Promise((s) => setTimeout(s, 100));
  }
  return "no";
});
revisar("el service worker se registra", registro === "sí");

await instalada.evaluate(() => navigator.serviceWorker.ready);
await instalada.waitForTimeout(500);
await contexto.setOffline(true);
await instalada.reload().catch(() => {});
revisar("y una vez instalada, abre SIN CONEXIÓN", await instalada.locator(".barra").isVisible().catch(() => false));
await contexto.setOffline(false);

servidor.close();

// La promesa que no se toca, comprobada al final: el archivo suelto no depende de nada.
revisar("el archivo autónomo no arrastra manifest ni service worker", (await pagina.locator('link[rel="manifest"]').count()) === 0);
revisar(
  "pero sí lleva su ícono incrustado, para iOS",
  ((await pagina.locator('link[rel="apple-touch-icon"]').getAttribute("href")) || "").startsWith("data:image/png"),
);

await navegador.close();
console.log(fallos === 0 ? "\n✓ Funciona desde el disco, donde no se puede guardar, e instalada sin conexión.\n" : `\n✗ ${fallos} fallo(s).\n`);
process.exit(fallos ? 1 : 0);
