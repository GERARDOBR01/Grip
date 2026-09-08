// Datos de prueba. Montos inventados a propósito y sin ningún parecido con los reales:
// los datos de verdad no entran nunca al repositorio.

import { normalizar, datosVacios } from "../motor/modelo.js";

export function datosDePrueba(extra = {}) {
  return normalizar({
    ...datosVacios("2026-09-01"),
    perfil: { moneda: "MXN", ingresoQuincenal: 800000, cortes: [15], colchonObjetivo: null },
    categorias: [
      { id: "super", nombre: "Súper", clase: "variable", tope: 300000 },
      { id: "transporte", nombre: "Transporte", clase: "variable", tope: 100000 },
      { id: "comida-fuera", nombre: "Comida fuera", clase: "variable", tope: 80000 },
      { id: "ocio", nombre: "Ocio", clase: "variable", tope: null },
      { id: "casa", nombre: "Renta y casa", clase: "fija", tope: null },
    ],
    fijos: [
      { id: "f_renta", nombre: "Renta", monto: 500000, diaCorte: 5, categoria: "casa" },
      { id: "f_internet", nombre: "Internet", monto: 60000, diaCorte: 10, categoria: "servicios" },
    ],
    ...extra,
  });
}

export function conMovimientos(datos, movimientos) {
  const salida = { ...datos, movimientos: { ...datos.movimientos } };
  for (const m of movimientos) {
    const mes = m.fecha.slice(0, 7);
    salida.movimientos[mes] = [...(salida.movimientos[mes] || []), { id: m.id || `x${Math.random()}`, ...m }];
  }
  return normalizar(salida);
}
