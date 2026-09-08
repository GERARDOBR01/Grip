// Service worker de Quincena — armado el 2026-09-08.
//
// Guarda la app para poder abrirla sin conexión. No guarda NINGÚN dato tuyo: los movimientos
// viven en el almacenamiento del navegador, que esto ni toca.

const CACHE = "quincena-2026-09-08";
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
