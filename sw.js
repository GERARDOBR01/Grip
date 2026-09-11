// Service worker de Grip — versión ea51b2c9, que es el hash de lo armado.
//
// Guarda la app para poder abrirla sin conexión. No guarda NINGÚN dato tuyo: los movimientos
// viven en el almacenamiento del navegador, que esto ni toca.

const CACHE = "grip-ea51b2c9";
const ARCHIVOS = ["./", "./index.html", "./manifest.webmanifest", "./icono-192.png", "./icono-512.png", "./icono-180.png"];

// El motor de OCR vive en su PROPIA caché, con su propio sello. Son 4 MB que no cambian casi
// nunca, y guardarlos junto a la app significaba volver a bajarlos enteros cada vez que se
// arregla una palabra en un texto. Con el sello aparte, solo se rebajan cuando cambia el motor.
const MOTOR = "grip-motor-ccd6ceb3";

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

// Lo que se comparte a la app aterriza aquí antes de que la pantalla exista. No es caché de la
// app: es un buzón de una sola entrega, y por eso NO se borra al activar una versión nueva.
const BUZON = "grip-compartido";

self.addEventListener("activate", (evento) => {
  // Al publicar una versión nueva, las viejas se tiran: nada de servir una app de hace meses.
  evento.waitUntil(
    caches.keys()
      .then((llaves) => Promise.all(
        llaves.filter((k) => k !== CACHE && k !== BUZON && k !== MOTOR).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

/**
 * Guarda lo compartido en el buzón. Nunca lanza: si esto falla, la app abre vacía, que es feo
 * pero no es perder nada.
 */
async function recibirCompartido(peticion) {
  try {
    const formulario = await peticion.formData();
    const buzon = await caches.open(BUZON);

    const texto = [formulario.get("titulo"), formulario.get("texto"), formulario.get("enlace")]
      .filter((t) => typeof t === "string" && t.trim())
      .join("\n")
      .trim();
    if (texto) await buzon.put("./buzon-texto", new Response(texto));

    const imagen = formulario.get("imagen");
    if (imagen && imagen.size) {
      await buzon.put("./buzon-imagen", new Response(imagen, {
        headers: { "content-type": imagen.type || "image/png" },
      }));
    }
  } catch (e) {}
}

self.addEventListener("fetch", (evento) => {
  // Compartir desde Android: llega un POST a ./compartir con el texto y, si la hay, la imagen.
  // Se contesta con un redirect INMEDIATO —la pantalla no espera a que se lea el archivo— y la
  // lectura del formulario sigue en segundo plano con waitUntil.
  if (evento.request.method === "POST" && new URL(evento.request.url).pathname.endsWith("/compartir")) {
    evento.respondWith(Response.redirect("./?compartido=1", 303));
    evento.waitUntil(recibirCompartido(evento.request));
    return;
  }

  if (evento.request.method !== "GET") return;
  // Solo lo de esta app. Si algún día se consulta algo de fuera (el puente de correo, por
  // ejemplo), guardarlo en caché serviría respuestas viejas como si fueran de ahora.
  const direccion = new URL(evento.request.url);
  if (direccion.origin !== self.location.origin) return;

  // El motor de OCR a su caché, el resto a la de la versión.
  const cajon = direccion.pathname.includes("/ocr/") ? MOTOR : CACHE;
  evento.respondWith(servir(evento, cajon));
});

/**
 * Caché primero, red después. Y no es una preferencia: es la única correcta AQUÍ.
 *
 * Antes iba a la red primero y solo caía a la caché si la red fallaba. Con señal mala eso
 * significa esperar a que el navegador se rinda —segundos, con la pantalla en blanco— para
 * después servir lo que ya estaba guardado desde el principio. Justo el peor sitio para
 * hacerlo esperar: al abrir.
 *
 * Servir de la caché no puede quedarse viejo porque el nombre de la caché ES el hash del
 * contenido: una versión nueva de la app es una caché nueva, que se llena al instalar, y las
 * viejas se tiran al activar. Si el contenido cambió, esta caché no lo tiene. Si esta caché lo
 * tiene, es el contenido de esta versión. Por eso tampoco se revalida por detrás: sería gastar
 * datos ajenos en confirmar algo que ya se sabe.
 */
async function servir(evento, cajon) {
  const peticion = evento.request;
  const guardado = await caches.match(peticion, { cacheName: cajon });
  if (guardado) return guardado;

  try {
    const respuesta = await fetch(peticion);
    // Solo se guarda lo que salió bien. Cachear un 404 o un 500 es servirlo para siempre.
    if (respuesta && respuesta.ok && respuesta.type === "basic") {
      const copia = respuesta.clone();
      // Atado a la vida del evento, no suelto y ya. El navegador apaga un service worker en
      // cuanto cree que terminó, y una escritura de caché lanzada por libre se puede quedar a
      // medias — sin error y sin rastro. En lo grande eso se nota: los 4 MB del motor de OCR se
      // volverían a bajar cada vez, en el aparato lento, que es justo donde el navegador apaga
      // antes. Y aun así la respuesta no espera: esto mantiene vivo al worker, no retrasa lo
      // que ya se devolvió.
      evento.waitUntil(caches.open(cajon).then((cache) => cache.put(peticion, copia)).catch(() => {}));
    }
    return respuesta;
  } catch (e) {
    // Sin red y sin copia. Si lo que se pedía era una pantalla, se da la app: dentro está todo
    // lo capturado, que es lo que la persona venía a ver.
    const alternativa = await caches.match("./index.html");
    if (alternativa) return alternativa;
    throw e;
  }
}

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
