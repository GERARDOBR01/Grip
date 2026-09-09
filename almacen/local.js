// Almacén local — la base sobre la que corre todo, en el propio navegador.
//
// IndexedDB primero (aguanta años de movimientos y sobrevive a recargas), localStorage si
// no está disponible, y memoria como último recurso. El nivel que se logró se DECLARA:
// una app que guarda en memoria y no lo dice es una app que te va a perder los datos.
//
// Y hay DOS preguntas distintas que antes se respondían con un solo `true`:
//   `duradero`   — ¿sobrevive a cerrar la pestaña?  (sí en IndexedDB y localStorage)
//   `persistente`— ¿el navegador se comprometió a no borrarlo si anda corto de espacio?
// La segunda hay que PEDIRLA y puede negarse. Decir que sí sin haberla pedido —que es lo que
// hacía este archivo— es la clase de mentira que se cobra el día que el sistema hace limpieza.
//
// Cuidado con las guardas: en un origen aislado (un iframe sin `allow-same-origin`, o un
// navegador con los datos de sitio bloqueados) **hasta leer** `window.localStorage` lanza
// SecurityError. Por eso aquí no se pregunta con `typeof`: se intenta de verdad, dentro de
// un try, y si truena se baja al siguiente nivel. Este archivo no puede lanzar nunca.

const BASE = "finanzas";
const ALMACEN = "documento";
const LLAVE = "raiz";

/** Lee una global sin que el acceso pueda tumbar la app. Devuelve null si ni mirarla se puede. */
function leerGlobal(nombre) {
  try {
    return globalThis[nombre] || null;
  } catch (e) {
    return null;
  }
}

/**
 * Le pide al navegador que NO borre estos datos cuando ande corto de espacio.
 *
 * Sin esto, lo guardado es "mejor esfuerzo": Safari borra todo el almacenamiento de scripts a
 * los 7 días sin interacción, y Chrome desaloja primero los orígenes que no lo pidieron. Una
 * app de finanzas que pierde el historial no es una app de finanzas.
 *
 * Devuelve lo que el navegador CONCEDIÓ, no lo que se pidió: si dice que no, hay que decirlo
 * en pantalla en vez de suponer que sí. Nunca lanza y nunca se queda colgada.
 */
export async function pedirPersistencia() {
  const almacenamiento = leerGlobal("navigator") && leerGlobal("navigator").storage;
  if (!almacenamiento || typeof almacenamiento.persist !== "function") return false;
  try {
    // Si ya estaba concedida, no se vuelve a pedir: en Firefox eso le sale al usuario como
    // una pregunta, y preguntar dos veces por lo mismo es una forma de gastarle el permiso.
    if (typeof almacenamiento.persisted === "function" && (await almacenamiento.persisted())) return true;
    return (await Promise.race([
      almacenamiento.persist(),
      new Promise((r) => setTimeout(() => r(false), 3000)),
    ])) === true;
  } catch (e) {
    return false;
  }
}

function abrirIndexedDB() {
  return new Promise((resolver) => {
    const idb = leerGlobal("indexedDB");
    if (!idb) return resolver(null);

    let peticion;
    try {
      peticion = idb.open(BASE, 1);
    } catch (e) {
      return resolver(null);
    }

    // Si la base no responde (permisos, versión trabada), no se espera para siempre.
    const rendirse = setTimeout(() => resolver(null), 3000);
    const terminar = (valor) => {
      clearTimeout(rendirse);
      resolver(valor);
    };

    peticion.onupgradeneeded = () => {
      const bd = peticion.result;
      if (!bd.objectStoreNames.contains(ALMACEN)) bd.createObjectStore(ALMACEN);
    };
    peticion.onsuccess = () => terminar(peticion.result);
    peticion.onerror = () => terminar(null);
    peticion.onblocked = () => terminar(null);
  });
}

function operar(bd, modo, accion) {
  return new Promise((resolver, rechazar) => {
    try {
      const tx = bd.transaction(ALMACEN, modo);
      const peticion = accion(tx.objectStore(ALMACEN));
      peticion.onsuccess = () => resolver(peticion.result);
      peticion.onerror = () => rechazar(peticion.error || new Error("La base local rechazó la operación."));
    } catch (e) {
      rechazar(e);
    }
  });
}

/** localStorage no basta con que exista: tiene que dejar escribir (modo privado, cuotas). */
function localStorageUtilizable() {
  const ls = leerGlobal("localStorage");
  if (!ls) return null;
  try {
    const prueba = `${BASE}:prueba`;
    ls.setItem(prueba, "1");
    ls.removeItem(prueba);
    return ls;
  } catch (e) {
    return null;
  }
}

export function enMemoria(motivo) {
  let memoria = null;
  return {
    tipo: "memoria",
    duradero: false,
    persistente: false,
    motivo,
    async cargar() {
      return memoria;
    },
    async guardar(datos) {
      memoria = datos;
    },
    async borrar() {
      memoria = null;
    },
  };
}

/** Devuelve siempre un almacén utilizable. Nunca lanza; en el peor caso, memoria declarada. */
export async function abrirLocal() {
  let bd = null;
  try {
    bd = await abrirIndexedDB();
  } catch (e) {
    bd = null;
  }

  if (bd) {
    const persistente = await pedirPersistencia();
    return {
      tipo: "indexeddb",
      duradero: true,
      persistente,
      // `motivo` es para cuando algo se degradó. Que no haya persistencia no degrada nada
      // aquí: es un hecho que la interfaz tiene que contar con sus palabras, no un fallo.
      motivo: null,
      async cargar() {
        try {
          return (await operar(bd, "readonly", (s) => s.get(LLAVE))) || null;
        } catch (e) {
          return null;
        }
      },
      async guardar(datos) {
        await operar(bd, "readwrite", (s) => s.put(datos, LLAVE));
      },
      async borrar() {
        await operar(bd, "readwrite", (s) => s.delete(LLAVE));
      },
    };
  }

  const ls = localStorageUtilizable();
  if (ls) {
    return {
      tipo: "localstorage",
      duradero: true,
      // localStorage es el nivel de abajo: nunca tuvo garantía de permanencia y no se le pide.
      persistente: false,
      motivo: null,
      async cargar() {
        try {
          const texto = ls.getItem(`${BASE}:${LLAVE}`);
          return texto ? JSON.parse(texto) : null;
        } catch (e) {
          return null;
        }
      },
      async guardar(datos) {
        ls.setItem(`${BASE}:${LLAVE}`, JSON.stringify(datos));
      },
      async borrar() {
        ls.removeItem(`${BASE}:${LLAVE}`);
      },
    };
  }

  // Sin almacenamiento del navegador: la app funciona, pero al cerrar se pierde. Se avisa.
  return enMemoria("Este navegador no deja guardar datos: al cerrar la pestaña se pierde lo capturado.");
}
