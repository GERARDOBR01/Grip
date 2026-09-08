// Almacén local — la base sobre la que corre todo, en el propio navegador.
//
// IndexedDB primero (aguanta años de movimientos y sobrevive a recargas), localStorage si
// no está disponible, y memoria como último recurso. El nivel que se logró se DECLARA:
// una app que guarda en memoria y no lo dice es una app que te va a perder los datos.
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
    return {
      tipo: "indexeddb",
      duradero: true,
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
