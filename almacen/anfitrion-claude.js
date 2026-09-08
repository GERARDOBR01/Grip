// Adaptador OPCIONAL del anfitrión.
//
// Éste es el único archivo de todo el proyecto que sabe que existe un entorno anfitrión.
// Hace dos cosas: sincronizar entre dispositivos y entregar el archivo de respaldo cuando
// el visor no deja que un enlace lo descargue por su cuenta.
// Si se borra, la app sigue funcionando igual: guarda en el navegador y lo declara en la
// barra superior. Ninguna otra parte del código lo nombra — hay una prueba que lo verifica.
//
// Mapeo contra el límite de tamaño por documento: la configuración va en uno, y los
// movimientos van en un documento POR MES. Mil movimientos al año no se acercan al tope.

const DOC_CONFIG = "finanzas/config";
const COL_MESES = "movimientos";

function esMes(id) {
  return /^\d{4}-\d{2}$/.test(id);
}

/** Devuelve el adaptador, o null si no hay entorno que lo provea. No lanza nunca. */
export async function abrirSincronizacion() {
  try {
    const anfitrion = globalThis.claude;
    if (!anfitrion || typeof anfitrion.use !== "function") return null;

    const db = await anfitrion.use("db");
    if (!db) return null;

    const cache = new Map();

    return {
      tipo: "sincronizado",

      async cargar() {
        const config = await db.doc(DOC_CONFIG).get();
        if (!config.exists) return null;

        const datos = { ...config.data(), movimientos: {} };
        const meses = await db.collection(COL_MESES).get();
        for (const doc of meses.docs) {
          if (!esMes(doc.id)) continue;
          const lista = doc.data().lista;
          if (Array.isArray(lista) && lista.length) datos.movimientos[doc.id] = lista;
          cache.set(doc.id, JSON.stringify(lista || []));
        }
        return datos;
      },

      async guardar(datos) {
        const { movimientos, ...config } = datos;
        await db.doc(DOC_CONFIG).set(config);

        for (const [mes, lista] of Object.entries(movimientos)) {
          const texto = JSON.stringify(lista);
          if (cache.get(mes) === texto) continue; // no reescribe un mes que no cambió
          await db.collection(COL_MESES).doc(mes).set({ lista, actualizado: new Date().toISOString() });
          cache.set(mes, texto);
        }
      },

      /** Avisa cuando otro dispositivo escribe. Devuelve la función para dejar de escuchar. */
      suscribir(alCambiar, mesActual) {
        const cortes = [];
        const aviso = () => alCambiar();
        try {
          cortes.push(db.doc(DOC_CONFIG).onSnapshot((s) => { if (!s.metadata.hasPendingWrites) aviso(); }, () => {}));
          if (mesActual) {
            cortes.push(
              db.collection(COL_MESES).doc(mesActual).onSnapshot((s) => { if (!s.metadata.hasPendingWrites) aviso(); }, () => {}),
            );
          }
        } catch (e) {
          // Sin suscripción se sigue trabajando: se sincroniza al guardar y al abrir.
        }
        return () => cortes.forEach((cortar) => { try { cortar(); } catch (e) {} });
      },
    };
  } catch (e) {
    return null;
  }
}

/**
 * Entrega un archivo al usuario a través del anfitrión.
 * Devuelve false si aquí no se puede, para que la app caiga al enlace de descarga normal
 * (que es lo que funciona cuando el archivo está abierto desde el disco).
 */
export async function descargarEnAnfitrion({ nombre, texto }) {
  try {
    const anfitrion = globalThis.claude;
    if (!anfitrion || typeof anfitrion.use !== "function") return false;

    const descargas = await anfitrion.use("downloads");
    if (!descargas) return false;

    await descargas.save({ filename: nombre, data: texto });
    return true;
  } catch (e) {
    // Que el usuario diga "no" no es un fallo: no hay nada a lo que caer.
    return Boolean(e && e.code === "declined");
  }
}
