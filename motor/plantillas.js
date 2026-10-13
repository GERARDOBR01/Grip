// Plantillas — lo que se repite igualito, con nombre.
//
// La captura rápida ya ofrece los montos de siempre sacándolos del historial, y eso cubre los
// tacos y el camión. Lo que no cubre es lo que la persona SABE que se repite aunque el historial
// todavía no lo diga: la colegiatura, la renta que se paga en efectivo, el súper de los sábados.
// Una plantilla es eso dicho una vez: nombre, monto y categoría. Usarla es un toque.
//
// Usar una plantilla no la cambia ni la aprende: crea un movimiento con HOY como fecha y nada
// más. Si ese mes la renta subió, se edita el movimiento — la plantilla sigue diciendo lo que la
// persona le dijo, hasta que ella la cambie.

import { hoyISO } from "./ciclo.js";
import { normalizarPlantilla, agregarMovimiento, marcarBorrado, TIPOS } from "./modelo.js";

/** Cuántas plantillas caben. Más que eso deja de ser un atajo y se vuelve otra lista que leer. */
export const MAXIMO_DE_PLANTILLAS = 12;

/** Las plantillas, por nombre. */
export function listaDePlantillas(datos) {
  return [...(datos.plantillas || [])].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/**
 * Crea o reemplaza una plantilla. Devuelve `{ datos, plantilla, error }`.
 * Con `id` se edita la que ya estaba; sin él, nace una nueva.
 */
export function guardarPlantilla(datos, propuesta) {
  const plantilla = normalizarPlantilla(propuesta);
  if (!plantilla) {
    return { datos, plantilla: null, error: "Una plantilla necesita nombre y un monto mayor a cero." };
  }
  const otras = (datos.plantillas || []).filter((p) => p.id !== plantilla.id);
  if (otras.some((p) => p.nombre.toLowerCase() === plantilla.nombre.toLowerCase())) {
    return { datos, plantilla: null, error: `Ya tienes una plantilla que se llama «${plantilla.nombre}».` };
  }
  if (otras.length >= MAXIMO_DE_PLANTILLAS) {
    return { datos, plantilla: null, error: `Caben ${MAXIMO_DE_PLANTILLAS} plantillas. Borra una que ya no uses.` };
  }
  if (plantilla.tipo === TIPOS.GASTO && !(datos.categorias || []).some((c) => c.id === plantilla.categoria)) {
    return { datos, plantilla: null, error: "Elige la categoría de la plantilla." };
  }
  return { datos: { ...datos, plantillas: [...otras, plantilla] }, plantilla, error: null };
}

/** Borra una plantilla y deja su lápida, para que el otro dispositivo no la reviva. */
export function borrarPlantilla(datos, id, cuando = new Date().toISOString()) {
  if (!(datos.plantillas || []).some((p) => p.id === id)) return datos;
  return marcarBorrado({ ...datos, plantillas: datos.plantillas.filter((p) => p.id !== id) }, id, cuando);
}

/**
 * Registra el movimiento de una plantilla con fecha de hoy. Devuelve `{ datos, movimiento,
 * error }`, igual que capturarlo a mano.
 */
export function usarPlantilla(datos, id, iso = hoyISO(), hora = "") {
  const plantilla = (datos.plantillas || []).find((p) => p.id === id);
  if (!plantilla) return { datos, movimiento: null, error: "Esa plantilla ya no existe." };
  return agregarMovimiento(datos, {
    fecha: iso,
    hora,
    monto: plantilla.monto,
    tipo: plantilla.tipo,
    categoria: plantilla.categoria,
    metodo: plantilla.metodo,
    tarjetaId: plantilla.tarjetaId,
    nota: plantilla.nota || plantilla.nombre,
  });
}

/** Una plantilla a partir de un movimiento que ya existe: "esto se repite". */
export function plantillaDesdeMovimiento(movimiento, nombre) {
  return {
    nombre: nombre || movimiento.nota || "Sin nombre",
    monto: movimiento.monto,
    tipo: movimiento.tipo,
    categoria: movimiento.categoria,
    metodo: movimiento.metodo,
    tarjetaId: movimiento.tarjetaId,
    nota: movimiento.nota,
  };
}
