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
import { fusionar, difieren, relojDesfasado } from "../motor/fusion.js";
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

  /**
   * Una sola fila para escribir, y en orden de llegada.
   *
   * Escribir es `await` dos veces: primero lo local, luego el espejo. Sin fila, dos guardados
   * que se encabalgan —aceptar un cargo desde la sombra mientras se está guardando un gasto,
   * que es exactamente lo que pasa cuando llega una notificación— pueden llegar al espejo al
   * revés, porque el espejo va por la red y la red no respeta el orden en que se le habló. El
   * documento viejo aterriza al último, gana por sello, y en la siguiente sincronización se
   * traga el nuevo. No es teórico: es la forma en que un sistema con dos copias pierde datos.
   *
   * La fila no se rompe cuando un trabajo falla: el siguiente entra igual.
   */
  let fila = Promise.resolve();
  function enFila(trabajo) {
    const turno = fila.then(trabajo, trabajo);
    fila = turno.then(() => {}, () => {});
    return turno;
  }

  /**
   * Traduce el fallo de un disco a algo con lo que alguien pueda hacer algo.
   *
   * Se mira el NOMBRE de la excepción, no su texto. Adivinar por el mensaje ("cuota", "space")
   * traduce mal cualquier error que solo mencione la palabra, y un diagnóstico equivocado es
   * peor que uno crudo: manda a borrar meses a quien tenía otro problema. Firefox usa su
   * propio nombre para lo mismo, y por eso están los dos.
   */
  function explicar(error) {
    const nombre = (error && error.name) || "";
    if (nombre === "QuotaExceededError" || nombre === "NS_ERROR_DOM_QUOTA_REACHED") {
      return "Ya no cabe más en este navegador. Descarga un respaldo y borra los meses que ya no consultes.";
    }
    return (error && error.message) || "el almacenamiento rechazó la escritura";
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
      await enFila(async () => {
        // Por la fila también, y no por prolijidad: abrir y guardar pueden encabalgarse —el
        // espejo avisa de un cambio justo mientras se está capturando— y esta reescritura es
        // un documento ENTERO. Fuera de orden, pisa lo que se acaba de guardar.
        if (difieren(unido, datosLocal)) {
          try {
            await local.guardar(unido);
          } catch (e) {
            degradar(`No se pudo dejar la copia unida en este dispositivo: ${explicar(e)}`);
          }
        }
        if (espejo && difieren(unido, datosEspejo)) {
          try {
            await espejo.guardar(unido);
          } catch (e) {
            degradar("Se abrió la copia unida, pero no se pudo escribir de vuelta en la sincronizada.");
          }
        }
      });

      // Un reloj adelantado hace que gane el aparato equivocado en todo lo escalar. No se
      // bloquea nada por eso —los movimientos ya se unen por id—, pero sí se dice.
      const desfase = relojDesfasado([datosLocal, datosEspejo], new Date().toISOString());
      estado.aviso = desfase
        ? `El reloj de alguno de tus dispositivos va ${desfase} minutos adelantado. ` +
          "Tus movimientos están completos, pero ajústalo para que los cambios de ajustes no se pisen."
        : null;

      const avisos = [ladoLocal, ladoEspejo]
        .filter((lado) => lado && lado.motivo)
        .map((lado) => lado.motivo)
        .concat(estado.aviso || []);
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

      return enFila(async () => {
        // Lo local primero, que es lo seguro. Pero que falle ya NO cancela el intento en el
        // espejo: si el disco de este aparato está lleno y la cuenta sí acepta la escritura,
        // el gasto está a salvo — y quedarse sin intentarlo habría sido perderlo por orgullo
        // del orden. Se guarda donde se pueda, y se dice exactamente dónde quedó.
        let falloLocal = null;
        try {
          await local.guardar(sello);
        } catch (e) {
          falloLocal = e;
        }

        let enEspejo = false;
        if (espejo) {
          try {
            await espejo.guardar(sello);
            enEspejo = true;
          } catch (e) {
            enEspejo = false;
          }
        }

        if (!falloLocal) {
          if (espejo && enEspejo) {
            estado.motivo = null;
            estado.modo = MODOS.SINCRONIZADO;
          } else if (espejo) {
            degradar("Se guardó en este dispositivo, pero no se pudo sincronizar.");
          }
          return sello;
        }

        if (enEspejo) {
          estado.modo = MODOS.SINCRONIZADO;
          estado.motivo =
            `No se pudo guardar en este dispositivo (${explicar(falloLocal)}), pero sí en tu cuenta: ` +
            "lo capturado está a salvo y vuelve al abrir en cualquier lado.";
          return sello;
        }

        // Ni aquí ni allá. Esto sí se lanza: la pantalla revierte y lo dice.
        throw new Error(explicar(falloLocal));
      });
    },

    suscribir(alCambiar) {
      if (!espejo || typeof espejo.suscribir !== "function") return () => {};
      return espejo.suscribir(alCambiar, mesDe(hoyISO()));
    },

    async borrarTodo() {
      await enFila(() => local.borrar());
      estado.bloqueado = false; // borrar es una decisión explícita: destraba la escritura
      estado.motivo = local.motivo || null;
    },
  };
}
