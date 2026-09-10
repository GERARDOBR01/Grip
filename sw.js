// Service worker de Grip — versión 54db742c, que es el hash de lo armado.
//
// Guarda la app para poder abrirla sin conexión. No guarda NINGÚN dato tuyo: los movimientos
// viven en el almacenamiento del navegador, que esto ni toca.

const CACHE = "grip-54db742c";
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
