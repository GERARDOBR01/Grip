// El almacén — cuatro métodos y varios respaldos detrás.
//
// La interfaz de la app habla SOLO con esto: cargar, guardar, suscribir, estado. Debajo
// puede haber IndexedDB sola, o IndexedDB con un espejo sincronizado. Cambiar de espejo
// mañana (una carpeta local, un servidor propio) es escribir otro adaptador; ni el motor
// ni la interfaz se enteran.
//
// El local SIEMPRE se escribe primero. Si el espejo falla, el dato ya está a salvo y el
// modo baja a "solo este dispositivo" con su motivo: nunca se pierde una captura en
// silencio.

import { abrirLocal, enMemoria } from "./local.js";
import { migrar } from "../motor/migraciones.js";
import { datosVacios, normalizar } from "../motor/modelo.js";
import { hoyISO, mesDe } from "../motor/ciclo.js";

export const MODOS = {
  SINCRONIZADO: "sincronizado",
  LOCAL: "local",
  EFIMERO: "efimero",
};

export async function abrirAlmacen(opciones = {}) {
  // Abrir el almacén NUNCA falla: en el peor de los casos se trabaja en memoria y se dice.
  let local;
  try {
    local = opciones.local || (await abrirLocal());
  } catch (e) {
    local = enMemoria("No se pudo abrir el almacenamiento de este navegador.");
  }

  // El adaptador de sincronización es opcional: si su archivo no está, esto no falla.
  let espejo = null;
  const proveedor =
    opciones.proveedorSincronizacion ||
    (typeof abrirSincronizacion === "function" ? abrirSincronizacion : null);
  if (proveedor) {
    try {
      espejo = await proveedor();
    } catch (e) {
      espejo = null;
    }
  }

  const estado = {
    modo: espejo ? MODOS.SINCRONIZADO : local.duradero ? MODOS.LOCAL : MODOS.EFIMERO,
    tipoLocal: local.tipo,
    motivo: local.motivo || null,
    // Se enciende cuando se leyeron datos que este código no sabe abrir (versión más
    // nueva). Mientras esté encendido NO se escribe: escribir sería borrarlos.
    bloqueado: false,
    aviso: null,
  };

  function degradar(motivo) {
    estado.modo = local.duradero ? MODOS.LOCAL : MODOS.EFIMERO;
    estado.motivo = motivo;
  }

  return {
    estado: () => ({ ...estado }),

    async cargar() {
      const crudoLocal = await local.cargar();
      let crudoEspejo = null;

      if (espejo) {
        try {
          crudoEspejo = await espejo.cargar();
        } catch (e) {
          degradar("No se pudo leer la copia sincronizada; se abrió la de este dispositivo.");
        }
      }

      const elegido = masReciente(crudoLocal, crudoEspejo);
      if (!elegido) return { datos: datosVacios(hoyISO()), nuevo: true, aviso: null };

      const resultado = migrar(elegido);
      if (!resultado.ok) {
        // Ni se abre a medias ni se borra: se conserva, se explica y se traba la escritura.
        estado.bloqueado = true;
        estado.motivo = resultado.motivo;
        return { datos: datosVacios(hoyISO()), nuevo: true, aviso: resultado.motivo, bloqueado: true };
      }
      estado.bloqueado = false;

      // El que iba atrás se pone al día con el que ganó.
      if (elegido === crudoEspejo && crudoEspejo) await local.guardar(resultado.datos);

      return { datos: resultado.datos, nuevo: false, aviso: resultado.motivo || null };
    },

    async guardar(datos) {
      if (estado.bloqueado) {
        throw new Error(
          "No se guarda nada mientras haya datos que esta versión no sabe abrir: se perderían. " +
            "Actualiza la app, o descarga un respaldo y empieza de cero a propósito.",
        );
      }

      const sello = { ...normalizar(datos), actualizado: new Date().toISOString() };
      await local.guardar(sello); // primero lo seguro

      if (espejo) {
        try {
          await espejo.guardar(sello);
          estado.motivo = null;
          estado.modo = MODOS.SINCRONIZADO;
        } catch (e) {
          degradar("Se guardó en este dispositivo, pero no se pudo sincronizar.");
        }
      }
      return sello;
    },

    suscribir(alCambiar) {
      if (!espejo || typeof espejo.suscribir !== "function") return () => {};
      return espejo.suscribir(alCambiar, mesDe(hoyISO()));
    },

    async borrarTodo() {
      await local.borrar();
      estado.bloqueado = false; // borrar es una decisión explícita: destraba la escritura
      estado.motivo = local.motivo || null;
    },
  };
}

/** Gana el documento con el `actualizado` más reciente. Un solo usuario: no hay que fusionar. */
export function masReciente(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const fechaA = a.actualizado || a.creado || "";
  const fechaB = b.actualizado || b.creado || "";
  return fechaB > fechaA ? b : a;
}
