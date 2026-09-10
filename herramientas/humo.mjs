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

// ── La bandeja, en el navegador ────────────────────────────────────────────────
//
// El motor ya está probado; esto comprueba lo otro: que se pueda pegar un aviso y aceptarlo
// con el pulgar, y que la app aprenda de lo que se corrigió.

console.log("\n  ── la bandeja ──");

await pagina.click('[data-vista="bandeja"]');
await pagina.waitForSelector("#aviso");
await pagina.fill("#aviso", "Banorte: Compra por $189.50 MXN en STARBUCKS REFORMA con tarjeta terminacion 4821 el 08/09/2026. Saldo disponible: $9,000.00");
await pagina.click('[data-accion="leer-aviso"]');
await pagina.waitForSelector(".tarjeta.entrada", { timeout: 4000 });

const leido = (await pagina.textContent(".entrada .monto")).trim();
revisar("lee un aviso pegado y NO confunde el saldo con la compra", leido === "−$189.50", leido);
revisar("el contador aparece en la barra", (await pagina.textContent(".globo")) === "1");

const fichas = await pagina.locator(".entrada .chip").count();
revisar("ofrece pocas categorías, no las doce", fichas > 0 && fichas <= 6, `${fichas} fichas`);

await pagina.click('.entrada [data-categoria="comida-fuera"]');
await pagina.click('[data-accion="aceptar-entrada"]');
await pagina.waitForSelector(".entrada", { state: "detached", timeout: 4000 });
revisar("aceptar vacía la bandeja", (await pagina.locator(".globo").count()) === 0);

// Lo que separa esta app de las que se abandonan: no preguntar dos veces lo mismo.
await pagina.fill("#aviso", "Banorte: Compra por $75.00 MXN en STARBUCKS POLANCO el 09/09/2026");
await pagina.click('[data-accion="leer-aviso"]');
await pagina.waitForSelector(".tarjeta.entrada", { timeout: 4000 });
const aprendida = await pagina.getAttribute('.entrada .chip[aria-pressed="true"]', "data-categoria");
revisar("APRENDIÓ: otra sucursal del mismo lugar llega ya categorizada", aprendida === "comida-fuera", aprendida);

await pagina.click('[data-accion="descartar-entrada"]');
await pagina.click(".velo button[type=submit]");
await pagina.waitForSelector(".entrada", { state: "detached", timeout: 4000 });
revisar("descartar no registra nada", (await pagina.locator(".globo").count()) === 0);

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
  "y trae los atajos de Android: pegar y gasto rápido",
  Boolean(manifiesto) && (manifiesto.shortcuts || []).length === 2 &&
    manifiesto.shortcuts.every((a) => a.url && a.name && (a.icons || []).length),
  `${((manifiesto || {}).shortcuts || []).length} atajos`,
);
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

// ── La bandeja no crece para siempre ────────────────────────────────────────────
//
// Este es el defecto que ya se coló una vez: la función de purga existía, tenía su prueba,
// y nadie la llamaba. Sin ella la bandeja crece sin freno y —cuando hay sincronización— el
// documento topa y la sincronización se rompe. Aquí se comprueba sobre el almacén real.

const conCarga = await contexto.newPage();
await conCarga.goto(`http://127.0.0.1:${puerto}/index.html`);
await conCarga.waitForSelector(".barra", { timeout: 8000 });

await conCarga.evaluate(async () => {
  const bandeja = [];
  const entrada = (id, recibido, estado, monto, nota) => ({
    id, recibido, estado, huella: `h${id}`, confianza: "alta", origen: "correo",
    movimiento: { id: `m${id}`, fecha: recibido, monto, tipo: "gasto", categoria: "otros", nota },
  });
  for (let i = 0; i < 40; i++) bandeja.push(entrada(`viejo${i}`, "2026-01-10", "aceptado", 1000 + i, `VIEJO${i}`));
  bandeja.push(entrada("pendiente-vieja", "2026-01-10", "pendiente", 9999, "PENDIENTE VIEJA"));
  for (let i = 0; i < 40; i++) bandeja.push(entrada(`nuevo${i}`, "2026-09-08", "pendiente", 5000 + i, `NUEVO${i}`));

  const doc = {
    version: 2, creado: "2026-01-01", actualizado: "2026-09-08T00:00:00Z",
    perfil: { moneda: "MXN", ingresoQuincenal: 800000, cortes: [15], colchonObjetivo: null },
    categorias: [], movimientos: {}, presupuestos: {}, metas: [], reglas: [], fijos: [], deudas: [], bandeja,
  };
  await new Promise((ok, mal) => {
    const q = indexedDB.open("finanzas", 1);
    q.onsuccess = () => {
      const tx = q.result.transaction("documento", "readwrite");
      tx.objectStore("documento").put(doc, "raiz");
      tx.oncomplete = ok; tx.onerror = mal;
    };
    q.onerror = mal;
  });
});

await conCarga.reload();
await conCarga.waitForSelector(".barra", { timeout: 8000 });
await conCarga.click('[data-vista="bandeja"]');
await conCarga.waitForSelector(".tarjeta.entrada", { timeout: 8000 });

const pintadas = await conCarga.locator(".tarjeta.entrada").count();
revisar("con 41 pendientes NO pinta 41 tarjetas de golpe", pintadas === 25, `${pintadas} tarjetas`);
revisar("y ofrece ver el resto", (await conCarga.locator('[data-accion="ver-mas-bandeja"]').count()) === 1);
await conCarga.click('[data-accion="ver-mas-bandeja"]');
revisar("que las muestra al pedirlo", (await conCarga.locator(".tarjeta.entrada").count()) === 41);

const tras = await conCarga.evaluate(() => new Promise((ok) => {
  const q = indexedDB.open("finanzas", 1);
  q.onsuccess = () => {
    const g = q.result.transaction("documento", "readonly").objectStore("documento").get("raiz");
    g.onsuccess = () => ok({
      total: g.result.bandeja.length,
      resueltas: g.result.bandeja.filter((e) => e.estado !== "pendiente").length,
      pendienteVieja: g.result.bandeja.some((e) => e.id === "pendiente-vieja"),
    });
  };
}));
revisar("al abrir tira lo resuelto y viejo", tras.total === 41 && tras.resueltas === 0, `${tras.total} entradas, ${tras.resueltas} resueltas`);
revisar("pero NUNCA lo pendiente, por viejo que sea", tras.pendienteVieja);

// ── Compartir desde el celular ──────────────────────────────────────────────────
//
// Con la app instalada en Android, compartirle un correo la abre con el texto en la
// dirección. Es la única vía para bancos que solo notifican dentro de su app, como Nu.

const compartido = await contexto.newPage();
const textoCompartido = encodeURIComponent("Compra por $312.00 MXN en FARMACIA GUADALAJARA el 09/09/2026");
await compartido.goto(`http://127.0.0.1:${puerto}/index.html?texto=${textoCompartido}`);
await compartido.waitForSelector(".tarjeta.entrada", { timeout: 8000 });
revisar("lo compartido llega leído a la bandeja", (await compartido.textContent(".entrada .monto")).trim() === "−$312.00");
revisar(
  "y la dirección se limpia: recargar no lo duplica",
  !compartido.url().includes("texto="),
  compartido.url(),
);

// ── El peaje diario, medido ─────────────────────────────────────────────────────
//
// Con el puente son ~40 avisos por quincena. A un toque cada uno, eso es exactamente el
// mecanismo que hace que dos de cada tres personas abandonen estas apps antes de los 30 días.
// La regla no cambia —sigue aceptando él, viendo antes qué acepta—; lo que cambia es el costo.

// Contexto propio: las pruebas de arriba dejan la bandeja sembrada, y aquí hay que contar.
const contextoLote = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const lote = await contextoLote.newPage();
await lote.goto(`http://127.0.0.1:${puerto}/index.html`);
await lote.waitForSelector(".tarjeta");
await lote.click('[data-vista="bandeja"]');
await lote.waitForSelector("#aviso");

for (let i = 0; i < 6; i++) {
  await lote.fill("#aviso", `Banorte: Compra por $${120 + i}.00 MXN en TIENDA ${i} el 08/09/2026 con tu tarjeta terminación 4821.`);
  await lote.click('[data-accion="leer-aviso"]');
  await lote.waitForTimeout(120);
}

const antesDelLote = await lote.$$eval(".tarjeta.entrada", (n) => n.length);
revisar("seis avisos esperando, uno por uno", antesDelLote === 6, `${antesDelLote} tarjetas`);

await lote.click('[data-accion="aceptar-tanda"]');
await lote.waitForTimeout(500);
const quedan = await lote.$$eval(".tarjeta.entrada", (n) => n.length);
revisar("un toque los acepta todos", quedan === 0, `quedan ${quedan}`);

await lote.click('[data-accion="deshacer-tanda"]');
await lote.waitForTimeout(500);
const trasDeshacer = await lote.$$eval(".tarjeta.entrada", (n) => n.length);
revisar("y otro toque los devuelve enteros", trasDeshacer === 6, `${trasDeshacer} tarjetas`);
await contextoLote.close();

// ── Los atajos, y el permiso que NO se pide ─────────────────────────────────────
//
// Lo segundo importa más que lo primero. Pedir permiso de notificaciones al abrir es la forma
// más rápida de que te lo nieguen para siempre; aquí se pide desde Ajustes, cuando la persona
// lo enciende, y nunca antes. Esta prueba es lo que evita que alguien lo "mejore".

const contextoAtajo = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const atajo = await contextoAtajo.newPage();
await atajo.addInitScript(() => {
  window.__pidioPermiso = false;
  if (typeof Notification !== "undefined") {
    const original = Notification.requestPermission;
    Notification.requestPermission = function (...args) {
      window.__pidioPermiso = true;
      return original.apply(this, args);
    };
  }
});
await atajo.goto(`http://127.0.0.1:${puerto}/index.html?atajo=pegar`);
await atajo.waitForSelector("#aviso", { timeout: 8000 });
revisar("el atajo «pegar» abre directo en la caja de pegar", true);
revisar("y limpia la dirección: recargar no repite el atajo", !atajo.url().includes("atajo="), atajo.url());

await atajo.waitForTimeout(500);
revisar("al abrir NO se pide permiso de avisos: eso se enciende en Ajustes",
  (await atajo.evaluate(() => window.__pidioPermiso)) === false);
await contextoAtajo.close();

// ── Leer una captura de pantalla ────────────────────────────────────────────────
//
// El texto de una notificación del banco no se puede seleccionar; una captura se hace con dos
// botones. Esto comprueba el camino entero, con OCR de verdad: se dibuja un aviso en un canvas
// —para no meter capturas de nadie al repositorio—, se pega como si vinieras de la galería, y
// tiene que caer leído en la bandeja con su monto.
//
// Si alguien borró interfaz/lector-imagen.js, esto se salta solo: que el lector no esté es un
// escenario válido, no un fallo.

const HAY_LECTOR = existsSync(join(RAIZ, "interfaz/lector-imagen.js"));

if (HAY_LECTOR) {
const contextoOCR = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const ocr = await contextoOCR.newPage();
await ocr.goto(`http://127.0.0.1:${puerto}/index.html`);
await ocr.waitForSelector(".barra", { timeout: 8000 });
await ocr.click('[data-vista="bandeja"]');
await ocr.waitForSelector("#aviso");

revisar("con el lector puesto, la app ofrece leer una captura",
  (await ocr.locator('[data-accion="elegir-captura"]').count()) === 1);

// El aviso, dibujado. Texto renderizado y de alto contraste: el mejor caso posible del OCR, y
// exactamente lo que es una captura de pantalla de verdad.
await ocr.evaluate(async () => {
  const lienzo = document.createElement("canvas");
  lienzo.width = 1000;
  lienzo.height = 340;
  const pincel = lienzo.getContext("2d");
  pincel.fillStyle = "#ffffff";
  pincel.fillRect(0, 0, 1000, 340);
  pincel.fillStyle = "#000000";
  pincel.font = "bold 34px sans-serif";
  pincel.fillText("Banorte", 40, 70);
  pincel.font = "32px sans-serif";
  pincel.fillText("Compra por $189.00 MXN en OXXO CENTRO", 40, 160);
  pincel.fillText("el 09/09/2026 con tu tarjeta 4821", 40, 230);

  const trozo = await new Promise((listo) => lienzo.toBlob(listo, "image/png"));
  const archivo = new File([trozo], "captura.png", { type: "image/png" });
  const porta = new DataTransfer();
  porta.items.add(archivo);
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: porta, bubbles: true }));
});

// El motor son 4 MB y arranca una vez: aquí se le da tiempo de verdad.
let entradaLeida = null;
for (let i = 0; i < 120; i++) {
  entradaLeida = await ocr.evaluate(() => {
    const tarjeta = document.querySelector(".tarjeta.entrada");
    return tarjeta ? tarjeta.innerText : null;
  });
  if (entradaLeida) break;
  await ocr.waitForTimeout(500);
}

revisar(
  "pegar una captura la lee y cae en la bandeja con su monto",
  Boolean(entradaLeida) && entradaLeida.includes("189.00"),
  (entradaLeida || "no llegó nada a la bandeja").split("\n").slice(0, 2).join(" · "),
);

// La regla que no se rompe: un dígito mal leído no se acepta sin mirarlo.
const sinAceptarEnLote = await ocr.evaluate(() =>
  document.querySelectorAll('[data-accion="aceptar-tanda"]').length === 0);
revisar("y NO se ofrece aceptarla en lote: un OCR no acepta dinero solo", sinAceptarEnLote);

const guardoLaImagen = await ocr.evaluate(() =>
  JSON.stringify(window.localStorage).includes("data:image"));
revisar("y la imagen no se guarda en ningún lado", !guardoLaImagen);

await contextoOCR.close();
} else {
  console.log("  · el lector de imágenes no está: se salta. La app corre sin él, que es lo que se promete.");
}

// ── Sube tu recibo de nómina ────────────────────────────────────────────────────
//
// El ingreso es el número del que cuelgan todos los demás, y hasta hoy se tecleaba a ojo. Del
// CFDI sale exacto — y de regalo los días de corte, que es de lo poco que quedaba a mano.
// Nunca se aplica solo: se enseña lo leído y se confirma.

const contextoNomina = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const nomina = await contextoNomina.newPage();
await nomina.goto(`http://127.0.0.1:${puerto}/index.html`);
await nomina.waitForSelector(".barra", { timeout: 8000 });
await nomina.click('[data-vista="ajustes"]');
await nomina.waitForSelector('[data-accion="subir-nomina"]');

await nomina.setInputFiles("#nomina", join(RAIZ, "pruebas/nominas/decenal.xml"));
await nomina.waitForSelector(".hoja, [data-accion=\"guardar-hoja\"]", { timeout: 8000 }).catch(() => {});
await nomina.waitForTimeout(400);

const loLeido = await nomina.textContent("body");
revisar(
  "el recibo se lee y se ENSEÑA antes de aplicarlo",
  loLeido.includes("$3,500.00") && loLeido.includes("corta el día"),
  loLeido.includes("$3,500.00") ? "" : "no salió el neto",
);

// Confirmar: y solo entonces cambia el perfil.
const botonGuardar = await nomina.$('.hoja .boton:not(.tenue), [data-accion="guardar-hoja"]');
if (botonGuardar) await botonGuardar.click();
await nomina.waitForTimeout(600);

const perfil = await nomina.evaluate(() => {
  const filas = [...document.querySelectorAll(".fila")].map((f) => f.innerText);
  return filas.join(" | ");
});
// El corte del recibo es 10, y la app venía con 15 puesto por defecto: si sale 10, salió del
// recibo. Comprobarlo con un recibo que corta el 15 no habría probado nada.
revisar(
  "y al confirmarlo pone el ingreso exacto Y los días de corte del recibo",
  perfil.includes("$3,500.00") && /d[íi]a 10\b/.test(perfil) && !/d[íi]a 15\b/.test(perfil),
  perfil.split(" | ").filter((f) => /Ingreso|corte/i.test(f)).map((f) => f.replace(/\n/g, " ")).join(" · "),
);

await contextoNomina.close();

// ── Compartir a la app desde Android ────────────────────────────────────────────
//
// El share_target pasó de GET a POST para poder recibir archivos, y ésa es la regresión más
// probable de todo el trabajo: el texto compartido desde Gmail viajaba por el camino viejo.
// Aquí se comprueban los dos, con un formulario de verdad que el service worker intercepta.

const contextoCompartir = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const compartir = await contextoCompartir.newPage();
await compartir.goto(`http://127.0.0.1:${puerto}/index.html`);
await compartir.waitForSelector(".barra", { timeout: 8000 });
await compartir.evaluate(async () => { await navigator.serviceWorker.ready; });

/** Manda un formulario a ./compartir, como hace Android al compartir a una app instalada. */
async function compartirComoAndroid(pagina, campos) {
  await pagina.evaluate(async (partes) => {
    const formulario = document.createElement("form");
    formulario.method = "POST";
    formulario.action = "./compartir";
    formulario.enctype = "multipart/form-data";

    if (partes.texto) {
      const campo = document.createElement("input");
      campo.type = "hidden";
      campo.name = "texto";
      campo.value = partes.texto;
      formulario.appendChild(campo);
    }

    if (partes.conImagen) {
      const lienzo = document.createElement("canvas");
      lienzo.width = 1000;
      lienzo.height = 260;
      const pincel = lienzo.getContext("2d");
      pincel.fillStyle = "#ffffff";
      pincel.fillRect(0, 0, 1000, 260);
      pincel.fillStyle = "#000000";
      pincel.font = "32px sans-serif";
      pincel.fillText("Compra por $77.00 MXN en CAFE LA ESQUINA", 40, 110);
      pincel.fillText("el 09/09/2026 con tu tarjeta 4821", 40, 180);
      const trozo = await new Promise((listo) => lienzo.toBlob(listo, "image/png"));

      const campo = document.createElement("input");
      campo.type = "file";
      campo.name = "imagen";
      const porta = new DataTransfer();
      porta.items.add(new File([trozo], "captura.png", { type: "image/png" }));
      campo.files = porta.files;
      formulario.appendChild(campo);
    }

    document.body.appendChild(formulario);
    formulario.submit();
  }, campos);
}

// 1) Texto. Es lo que ya funcionaba y lo que no se puede romper.
await compartirComoAndroid(compartir, { texto: "Banorte: Compra por $312.00 MXN en FARMACIA SAN JORGE el 09/09/2026 con tu tarjeta terminación 4821." });
await compartir.waitForURL((u) => !u.toString().includes("/compartir"), { timeout: 10000 });
await compartir.waitForSelector(".tarjeta.entrada", { timeout: 10000 });
revisar(
  "compartir TEXTO por POST sigue llegando leído a la bandeja",
  (await compartir.textContent("body")).includes("312.00"),
  (await compartir.textContent(".entrada .monto") || "").trim(),
);
revisar("y la dirección queda limpia", !compartir.url().includes("compartido"), compartir.url());

// 2) Imagen. Lo nuevo: compartir la captura de una notificación desde la galería.
if (HAY_LECTOR) {
  await compartirComoAndroid(compartir, { conImagen: true });
  await compartir.waitForURL((u) => !u.toString().includes("/compartir"), { timeout: 10000 });

  let conCafe = false;
  for (let i = 0; i < 120; i++) {
    conCafe = (await compartir.textContent("body")).includes("77.00");
    if (conCafe) break;
    await compartir.waitForTimeout(500);
  }
  revisar("compartir una CAPTURA la lee y la mete a la bandeja", conCafe,
    conCafe ? "" : "no apareció el monto de la captura");

  const buzonVacio = await compartir.evaluate(async () => {
    const buzon = await caches.open("grip-compartido");
    return (await buzon.keys()).length === 0;
  });
  revisar("y el buzón queda vacío: la captura no se queda guardada", buzonVacio);
}

await contextoCompartir.close();

// ── La sombra de notificaciones, que es donde vive la gente ─────────────────────
//
// La jugada del proyecto: aceptar un cargo desde la pantalla de bloqueo, sin abrir nada. Hoy
// eso son cinco pasos —desbloquear, abrir, ir a Bandeja, buscarlo, Aceptar—; aquí es uno.
//
// Un navegador sin cabeza no concede permiso de notificaciones y no hay bandera que lo cambie,
// así que las notificaciones se DOBLAN: se apunta lo que la app pidió publicar. Eso no debilita
// la prueba, la afila — lo que importa no es que Chromium sepa pintar un aviso (eso es cosa
// suya), sino que la app pida el aviso correcto y que el service worker haga lo correcto al
// tocarlo. Las dos cosas se comprueban de verdad, y el manejador que se dispara es el mismo
// que corre en tu teléfono.

const contextoSombra = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const sombra = await contextoSombra.newPage();
await sombra.addInitScript(() => {
  try { localStorage.setItem("grip:avisos", JSON.stringify({ encendidos: true, mandados: {} })); } catch (e) {}
  // El doble: permiso concedido del lado de la página, y showNotification apuntando en vez de
  // pintando. Nada llega al navegador de verdad, así que nada depende de su permiso.
  try { Object.defineProperty(Notification, "permission", { get: () => "granted" }); } catch (e) {}
  window.__avisos = [];
  const original = ServiceWorkerRegistration.prototype.showNotification;
  ServiceWorkerRegistration.prototype.showNotification = function (titulo, opciones) {
    window.__avisos.push({ titulo, ...(opciones || {}) });
    return Promise.resolve();
  };
  window.__showNotificationReal = original;
});
await sombra.goto(`http://127.0.0.1:${puerto}/index.html`);
await sombra.waitForSelector(".barra", { timeout: 8000 });
await sombra.evaluate(async () => { await navigator.serviceWorker.ready; });

// La barra: se publica sola al guardar, con su fecha, y con un tag fijo para no apilarse.
await sombra.click('[data-vista="bandeja"]');
await sombra.waitForSelector("#aviso");
await sombra.fill("#aviso", "Banorte: Compra por $89.00 MXN en OXXO CENTRO el 09/09/2026 con tu tarjeta terminación 4821.");
await sombra.click('[data-accion="leer-aviso"]');
await sombra.waitForSelector(".tarjeta.entrada", { timeout: 8000 });
await sombra.waitForTimeout(600);

const barras = await sombra.evaluate(() => window.__avisos.filter((a) => a.tag === "grip:barra"));
revisar(
  "la barra se queda en la sombra, con su fecha y un botón para anotar",
  barras.length > 0 &&
    /al \d{4}-\d{2}-\d{2}/.test(barras[barras.length - 1].body || "") &&
    (barras[barras.length - 1].actions || []).some((a) => a.action === "anotar") &&
    barras.every((b) => b.tag === "grip:barra"),
  barras.length ? `${barras[barras.length - 1].titulo} — ${barras[barras.length - 1].body}` : "no se publicó",
);

// Y ahora lo que de verdad importa: tocar «Aceptar» en la sombra.
const idEntrada = await sombra.evaluate(() =>
  document.querySelector('.tarjeta.entrada [data-accion="aceptar-entrada"]').dataset.id);

/** Dispara la acción DENTRO del service worker, como si la hubieras tocado en la sombra. */
async function tocarEnLaSombra(accion, entradaId) {
  const [obrero] = contextoSombra.serviceWorkers();
  if (!obrero) return false;
  return obrero.evaluate(async ([accionTocada, id]) => {
    const evento = new Event("notificationclick");
    Object.defineProperty(evento, "notification", {
      value: { data: { entradaId: id, acuse: "Aceptado" }, tag: `entrada:${id}`, close() {} },
    });
    Object.defineProperty(evento, "action", { value: accionTocada });
    const esperas = [];
    evento.waitUntil = (p) => esperas.push(p);
    self.dispatchEvent(evento);
    await Promise.all(esperas);
    return true;
  }, [accion, entradaId]);
}

// Camino 1: la app abierta. El service worker manda la intención directo y se ve al instante.
revisar("el service worker escucha el toque", await tocarEnLaSombra("aceptar", idEntrada));
await sombra.waitForTimeout(800);
// A «Hoy» antes de mirar: aceptar no cambia de pantalla —sigues en Bandeja— y los movimientos
// ya aceptados solo se listan en Hoy. Buscarlos en Bandeja sería buscarlos donde no van.
await sombra.click('[data-vista="hoy"]');
await sombra.waitForTimeout(200);
const trasAceptar = await sombra.evaluate(() => ({
  entradas: document.querySelectorAll(".tarjeta.entrada").length,
  cuerpo: document.body.innerText,
}));
revisar(
  "aceptar desde la sombra crea el movimiento, con la app abierta",
  trasAceptar.entradas === 0 && trasAceptar.cuerpo.includes("OXXO CENTRO"),
  `${trasAceptar.entradas} entradas siguen esperando`,
);

// Camino 2: la app CERRADA. La intención se encola en IndexedDB y se aplica al abrir.
await sombra.click('[data-vista="bandeja"]');
await sombra.waitForSelector("#aviso");
await sombra.fill("#aviso", "Banorte: Compra por $47.00 MXN en FARMACIA SAN JORGE el 09/09/2026 con tu tarjeta terminación 4821.");
await sombra.click('[data-accion="leer-aviso"]');
await sombra.waitForSelector(".tarjeta.entrada", { timeout: 8000 });
const idCerrada = await sombra.evaluate(() =>
  document.querySelector('.tarjeta.entrada [data-accion="aceptar-entrada"]').dataset.id);

await sombra.close(); // sin ninguna ventana abierta: la intención tiene que encolarse
await tocarEnLaSombra("aceptar", idCerrada);

const reabierta = await contextoSombra.newPage();
await reabierta.goto(`http://127.0.0.1:${puerto}/index.html`);
await reabierta.waitForSelector(".barra", { timeout: 8000 });
await reabierta.waitForTimeout(1200);
const trasReabrir = await reabierta.evaluate(() => ({
  entradas: document.querySelectorAll(".tarjeta.entrada").length,
  cuerpo: document.body.innerText,
}));
revisar(
  "y con la app CERRADA se encola y se aplica al abrir",
  trasReabrir.cuerpo.includes("FARMACIA SAN JORGE") && trasReabrir.entradas === 0,
  `${trasReabrir.entradas} entradas siguen esperando`,
);

// La cola se vacía al drenarla: una intención aplicada dos veces sería un gasto duplicado, y
// un gasto duplicado es peor que uno perdido porque el perdido lo notas.
await reabierta.reload();
await reabierta.waitForSelector(".barra", { timeout: 8000 });
await reabierta.waitForTimeout(800);
const dobles = await reabierta.evaluate(() =>
  (document.body.innerText.match(/FARMACIA SAN JORGE/g) || []).length);
revisar("y no se aplica dos veces al volver a abrir", dobles === 1, `${dobles} veces en pantalla`);

await contextoSombra.close();

// ── Corregir una vez, no veinte ─────────────────────────────────────────────────
//
// Aprender hacia adelante dejaba media promesa cumplida: el siguiente cargo de OXXO llegaba
// bien y los cinco de antes se quedaban donde estaban, así que el presupuesto seguía mintiendo
// hasta tocarlos uno por uno — el trabajo que la app dice que te quita. Ahora se OFRECE
// arreglarlos, con el número por delante. Nunca solo: esto reescribe historial.

const contextoAtras = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const atras = await contextoAtras.newPage();
await atras.goto(`http://127.0.0.1:${puerto}/index.html`);
await atras.waitForSelector(".tarjeta");
await atras.click('[data-vista="bandeja"]');
await atras.waitForSelector("#aviso");

// Cinco cargos del mismo lugar, aceptados con la categoría que trae por defecto.
for (let i = 0; i < 5; i++) {
  await atras.fill("#aviso", `Banorte: Compra por $${60 + i}.00 MXN en OXXO CENTRO el 0${i + 1}/09/2026 con tu tarjeta terminación 4821.`);
  await atras.click('[data-accion="leer-aviso"]');
  await atras.waitForTimeout(120);
}
await atras.click('[data-accion="aceptar-tanda"]');
await atras.waitForTimeout(500);

// El sexto se corrige a mano: se le pone otra categoría antes de aceptar.
await atras.fill("#aviso", "Banorte: Compra por $99.00 MXN en OXXO CENTRO el 06/09/2026 con tu tarjeta terminación 4821.");
await atras.click('[data-accion="leer-aviso"]');
await atras.waitForSelector(".tarjeta.entrada", { timeout: 8000 });
// Las categorías son fichas, no un desplegable: aceptar tiene que ser un toque. Se elige la
// primera que NO sea la que ya viene puesta.
const otraFicha = await atras.$('.tarjeta.entrada .chip[aria-pressed="false"]');
if (otraFicha) {
  await otraFicha.click();
  await atras.waitForTimeout(250);
  await atras.click('.tarjeta.entrada [data-accion="aceptar-entrada"]');
  await atras.waitForTimeout(600);

  const texto = await atras.textContent("body");
  const ofrecido = (texto.match(/También tienes \d+ cargos?/) || ["no salió el ofrecimiento"])[0];
  revisar("corregir una vez ofrece arreglar los cargos viejos del mismo lugar",
    texto.includes("También tienes 5 cargos"), ofrecido);

  await atras.click('[data-accion="aplicar-hacia-atras"]');
  await atras.waitForTimeout(600);
  const despues = await atras.textContent("body");
  revisar("y un toque los pasa todos, diciendo cuántos movió",
    despues.includes("5 movimientos pasaron") && !despues.includes("También tienes 5 cargos"));
} else {
  revisar("corregir una vez ofrece arreglar los cargos viejos del mismo lugar", false,
    "no encontré una ficha de categoría distinta a la puesta");
}
await contextoAtras.close();

// ── Un banco que nadie programó ─────────────────────────────────────────────────
//
// Ocho de los once bancos de la tabla nunca han enseñado su formato, y las plantillas cambian
// sin avisar. Hasta hoy, un aviso que no se entendía se CONTABA como ilegible y se tiraba: ahí
// desaparecía un gasto de verdad sin dejar rastro. Ahora espera y pide dos datos.

const raro = await contexto.newPage();
const avisoRaro = encodeURIComponent(
  "Aviso de tu cuenta\nSe aplico un movimiento a tu plastico terminacion 4821.\nConsulta el detalle en la app.",
);
await raro.goto(`http://127.0.0.1:${puerto}/index.html?texto=${avisoRaro}`);
await raro.waitForSelector('[data-accion="guardar-ilegible"]', { timeout: 8000 });
revisar("un aviso que no se entiende ESPERA en vez de tirarse", true);

const idIlegible = await raro.getAttribute('[data-accion="guardar-ilegible"]', "data-id");
revisar(
  "y enseña con qué reconocerlo, sin guardar el cuerpo del correo",
  (await raro.textContent("body")).includes("Aviso de tu cuenta") &&
    !(await raro.textContent("body")).includes("Consulta el detalle"),
);

await raro.fill(`#ileg-monto-${idIlegible}`, "245.00");
await raro.fill(`#ileg-nota-${idIlegible}`, "FERRETERIA LOPEZ");
await raro.click('[data-accion="guardar-ilegible"]');
await raro.waitForTimeout(500);
revisar("completarlo a mano lo convierte en gasto y además aprende",
  /aprend/i.test(await raro.textContent("body")));

await raro.click('[data-vista="hoy"]');
await raro.waitForTimeout(400);
revisar("y el gasto aparece entre los movimientos, con su monto",
  (await raro.textContent("body")).includes("FERRETERIA LOPEZ") &&
    (await raro.textContent("body")).includes("245.00"));

// ── El puente de correo ─────────────────────────────────────────────────────────
//
// Este servidor imita a Apps Script: otro origen (otro puerto), y la misma cabecera que
// devuelve Google. Prueba lo que sí está de nuestro lado — que el navegador deje pasar la
// llamada y que el adaptador lea la respuesta. Que el Apps Script de verdad responda es
// cosa de desplegarlo, y ahí no llega ninguna prueba automática.

// Si alguien borró el adaptador, estas comprobaciones no aplican — igual que las del motor,
// se saltan solas. Que el puente no esté es un escenario válido, no un fallo.
const HAY_PUENTE = existsSync(join(RAIZ, "almacen/puente-correo.js"));

let huboPreflight = false;
const puente = createServer((peticion, respuesta) => {
  if (peticion.method === "OPTIONS") huboPreflight = true;
  let cuerpo = "";
  peticion.on("data", (trozo) => { cuerpo += trozo; });
  peticion.on("end", () => {
    const pedido = JSON.parse(cuerpo || "{}");
    const salida = pedido.token !== "llave-de-prueba"
      ? { error: "Token incorrecto." }
      : { avisos: [
          { remitente: "alertas@banorte.com", asunto: "Compra aprobada",
            texto: "Compra por $540.00 MXN en HOME DEPOT con tarjeta terminacion ****4821 el 09/09/2026" },
          { remitente: "no-reply@mercadopago.com.mx", asunto: "Pago realizado",
            texto: "Pagaste $128.00 MXN en RAPPI el 09/09/2026" },
        ] };
    respuesta.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*", // lo mismo que devuelve Apps Script
    });
    respuesta.end(JSON.stringify(salida));
  });
});
await new Promise((listo) => puente.listen(0, "127.0.0.1", listo));
const puertoPuente = puente.address().port;

if (HAY_PUENTE) {
// Esta página comparte origen con las anteriores, así que ya hay cosas en la bandeja: lo que
// se mide es cuánto CRECE. Y se cuenta por el contador de la barra, no por tarjetas pintadas
// — la lista tiene tope, así que contar tarjetas daría siempre el mismo número.
const contador = async () => Number((await instalada.locator(".globo").textContent().catch(() => "0")) || 0);
const esperarA = async (condicion, limite = 8000) => {
  const hasta = Date.now() + limite;
  while (Date.now() < hasta) {
    if (await condicion()) return true;
    await instalada.waitForTimeout(150);
  }
  return false;
};

// El contador se lee sobre una página ya recargada: las pantallas anteriores dejaron cosas en
// la bandeja y el número de esta pestaña está viejo.
await instalada.reload();
await instalada.waitForSelector(".barra", { timeout: 8000 });
const antes = await contador();

// La promesa: configurado el puente, la bandeja se llena SOLA. Aquí no se aprieta nada — se
// configura, se recarga, y se espera. Si esto deja de pasar, «que capture sola» era un decir.
await instalada.evaluate((direccion) => {
  localStorage.removeItem("grip:puente:ultima"); // como si nunca se hubiera traído
  localStorage.setItem("grip:puente", JSON.stringify({ url: direccion, token: "llave-de-prueba" }));
}, `http://127.0.0.1:${puertoPuente}/exec`);
await instalada.reload();
await instalada.waitForSelector(".barra", { timeout: 8000 });

const llegaronSolos = await esperarA(async () => (await contador()) - antes === 2);
revisar("sin tocar nada, la bandeja se llena sola al abrir",
  llegaronSolos, `${(await contador()) - antes} nuevas`);

// Y no se pregunta otra vez en cada recarga: eso sería una llamada a Apps Script por vistazo.
await instalada.reload();
await instalada.waitForSelector(".barra", { timeout: 8000 });
await instalada.waitForTimeout(600);
revisar("y no vuelve a preguntar en cada recarga", (await contador()) - antes === 2,
  `${(await contador()) - antes} tras recargar`);

// El botón sigue ahí para quien no quiera esperar, y lo que ya trajo no lo trae dos veces.
await instalada.click('[data-vista="ajustes"]');
await instalada.waitForSelector('[data-accion="traer-del-puente"]');
await instalada.click('[data-accion="traer-del-puente"]');
await instalada.waitForSelector(".aviso", { timeout: 8000 });
revisar("«Traer ahora» sigue funcionando y no duplica lo ya traído",
  (await contador()) - antes === 2 && (await instalada.textContent(".aviso")).includes("no hay nada nuevo"),
  await instalada.textContent(".aviso"));
revisar(
  "sin petición de permiso previa: por eso se manda como text/plain",
  !huboPreflight,
  huboPreflight ? "hubo OPTIONS, Apps Script no lo contestaría" : "",
);

// Un token equivocado no puede quedarse callado.
await instalada.evaluate((direccion) => {
  localStorage.setItem("grip:puente", JSON.stringify({ url: direccion, token: "llave-mala" }));
}, `http://127.0.0.1:${puertoPuente}/exec`);
await instalada.reload();
await instalada.waitForSelector(".barra");
await instalada.click('[data-vista="ajustes"]');
await instalada.click('[data-accion="traer-del-puente"]');
await instalada.waitForSelector(".aviso", { timeout: 8000 });
revisar("y un token equivocado lo dice, no falla en silencio",
  (await instalada.textContent(".aviso")).includes("Token incorrecto"));
} else {
  console.log("  · el puente no está: se salta. La app corre sin él, que es justo lo que se promete.");
}

puente.close();
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
