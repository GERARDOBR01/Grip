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
await instalada.evaluate((direccion) => {
  localStorage.setItem("grip:puente", JSON.stringify({ url: direccion, token: "llave-de-prueba" }));
}, `http://127.0.0.1:${puertoPuente}/exec`);
await instalada.reload();
await instalada.waitForSelector(".barra");
await instalada.click('[data-vista="ajustes"]');
await instalada.waitForSelector('[data-accion="traer-del-puente"]');
// Esta página comparte origen con las anteriores, así que ya hay cosas en la bandeja: lo que
// se mide es cuánto CRECE. Y se cuenta por el contador de la barra, no por tarjetas pintadas
// — la lista tiene tope, así que contar tarjetas daría siempre el mismo número.
const contador = async () => Number((await instalada.locator(".globo").textContent().catch(() => "0")) || 0);
await instalada.reload();
await instalada.waitForSelector(".barra", { timeout: 8000 });
const antes = await contador();
await instalada.click('[data-vista="ajustes"]');
await instalada.click('[data-accion="traer-del-puente"]');
await instalada.waitForSelector(".tarjeta.entrada", { timeout: 8000 });

const traidas = (await contador()) - antes;
revisar("el puente trae los dos avisos y caen leídos en la bandeja", traidas === 2, `${traidas} nuevas`);
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
