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
import { fusionar, difieren } from "../motor/fusion.js";
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
    // ¿El navegador se comprometió a no borrar esto si anda corto de espacio? Es distinto de
    // `duradero` (sobrevivir a cerrar la pestaña) y la interfaz tiene que poder decirlo.
    persistente: local.persistente === true,
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

      if (!crudoLocal && !crudoEspejo) return { datos: datosVacios(hoyISO()), nuevo: true, aviso: null };

      // Cada lado se sube a la versión de hoy ANTES de unirlos. Fusionar un documento v2 con
      // uno v3 mezclaría dos formas distintas de los mismos datos, que es peor que no unir.
      const ladoLocal = crudoLocal ? migrar(crudoLocal) : null;
      const ladoEspejo = crudoEspejo ? migrar(crudoEspejo) : null;

      // Si CUALQUIERA de los dos no se sabe abrir, no se toca nada: ni se abre a medias ni se
      // borra. Se conserva, se explica y se traba la escritura.
      const fallo = [ladoLocal, ladoEspejo].find((lado) => lado && !lado.ok);
      if (fallo) {
        estado.bloqueado = true;
        estado.motivo = fallo.motivo;
        return { datos: datosVacios(hoyISO()), nuevo: true, aviso: fallo.motivo, bloqueado: true };
      }
      estado.bloqueado = false;

      const datosLocal = ladoLocal ? ladoLocal.datos : null;
      const datosEspejo = ladoEspejo ? ladoEspejo.datos : null;

      // Y aquí lo importante: se UNEN. Antes ganaba un documento entero por su fecha y el otro
      // se descartaba completo — lo capturado en el aparato que sincronizó primero desaparecía
      // sin avisar. Ahora no se pierde nada que alguien no haya borrado a propósito.
      const unido = normalizar(fusionar(datosLocal, datosEspejo));

      // El que iba atrás se pone al día. `difieren` evita reescribir cuando ya decían lo mismo.
      if (difieren(unido, datosLocal)) await local.guardar(unido);
      if (espejo && difieren(unido, datosEspejo)) {
        try {
          await espejo.guardar(unido);
        } catch (e) {
          degradar("Se abrió la copia unida, pero no se pudo escribir de vuelta en la sincronizada.");
        }
      }

      const avisos = [ladoLocal, ladoEspejo].filter((lado) => lado && lado.motivo).map((lado) => lado.motivo);
      return { datos: unido, nuevo: false, aviso: avisos.length ? avisos.join(" ") : null };
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
