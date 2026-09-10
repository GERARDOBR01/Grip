// La cola de intenciones — lo que decidiste en la sombra, esperando a que la app lo aplique.
//
// La otra mitad vive en el service worker (lo genera herramientas/armar.mjs). Él escribe, esto
// lee y vacía, y son dos mitades a propósito: cada lado hace UNA cosa, así que no hay código
// compartido que mantener en dos sitios ni riesgo de que se pisen.
//
// Va en su propia base de IndexedDB, aparte de tus datos. Una intención no es un movimiento:
// es «dijiste que sí a esto». El movimiento lo crea el motor cuando la app la aplica, con las
// mismas reglas de siempre. Si algo sale mal aquí, lo peor que pasa es que un cargo siga
// esperando en la bandeja — nunca que se cuente dos veces ni que se pierda dinero.

const BASE_INTENCIONES = "grip-intenciones";
const COLA_INTENCIONES = "cola";

function abrirCola() {
  return new Promise((listo, falla) => {
    let peticion;
    try {
      peticion = indexedDB.open(BASE_INTENCIONES, 1);
    } catch (e) {
      return falla(e); // hay navegadores donde tocar indexedDB ya lanza
    }
    peticion.onupgradeneeded = () => {
      const base = peticion.result;
      if (!base.objectStoreNames.contains(COLA_INTENCIONES)) base.createObjectStore(COLA_INTENCIONES, { autoIncrement: true });
    };
    peticion.onsuccess = () => listo(peticion.result);
    peticion.onerror = () => falla(peticion.error || new Error("no se pudo abrir la cola"));
  });
}

/**
 * Saca todo lo que haya y deja la cola vacía, en UNA transacción.
 *
 * Leer y borrar juntos es deliberado: si se leyera primero y se borrara después, un cierre a
 * media aplicación dejaría intenciones ya aplicadas listas para aplicarse otra vez. Un gasto
 * duplicado es peor que uno perdido, porque el perdido lo notas.
 *
 * Nunca lanza: sin IndexedDB devuelve `[]` y la app sigue igual.
 */
export async function drenarIntenciones() {
  let base = null;
  try {
    base = await abrirCola();
    return await new Promise((listo) => {
      const trato = base.transaction(COLA_INTENCIONES, "readwrite");
      const almacen = trato.objectStore(COLA_INTENCIONES);
      const todas = almacen.getAll();
      todas.onsuccess = () => almacen.clear();
      trato.oncomplete = () => listo(todas.result || []);
      trato.onerror = () => listo([]);
      trato.onabort = () => listo([]);
    });
  } catch (e) {
    return [];
  } finally {
    if (base) try { base.close(); } catch (e) {}
  }
}
