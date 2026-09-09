// Modelo — la forma de los datos y su versión.
//
// Todo vive en UN documento raíz, portable: es exactamente lo que exporta el respaldo en
// JSON y lo que come el importador. Si algún día esta app cambia de casa, los datos se
// mudan solos.
//
// El documento lleva `version` a propósito: es lo que permite cambiar la forma de los
// datos dentro de dos años sin perder un solo movimiento (ver migraciones.js).

import { aCentavos } from "./dinero.js";
import { hoyISO, mesDe, esISO } from "./ciclo.js";

/** Versión del esquema. Sube de uno en uno, con su migración escrita. */
export const VERSION_DATOS = 2;

// AHORRO aparta dinero; RETIRO lo saca de vuelta. Sin RETIRO, sacar de una meta obligaba
// a borrar el apartado original, y el historial acababa mintiendo sobre lo que pasó.
export const TIPOS = { GASTO: "gasto", INGRESO: "ingreso", AHORRO: "ahorro", RETIRO: "retiro" };

/** Catálogo inicial pensado para México. Son valores por defecto de la app, no datos suyos. */
export const CATEGORIAS_BASE = [
  { id: "super", nombre: "Súper", emoji: "🛒", clase: "variable" },
  { id: "comida-fuera", nombre: "Comida fuera", emoji: "🍔", clase: "variable" },
  { id: "transporte", nombre: "Transporte", emoji: "🚌", clase: "variable" },
  { id: "casa", nombre: "Renta y casa", emoji: "🏠", clase: "fija" },
  { id: "servicios", nombre: "Servicios", emoji: "💡", clase: "fija" },
  { id: "suscripciones", nombre: "Suscripciones", emoji: "📺", clase: "fija" },
  { id: "salud", nombre: "Salud", emoji: "💊", clase: "variable" },
  { id: "escuela", nombre: "Escuela", emoji: "📚", clase: "variable" },
  { id: "ropa", nombre: "Ropa", emoji: "👕", clase: "variable" },
  { id: "ocio", nombre: "Ocio", emoji: "🎬", clase: "variable" },
  { id: "deuda", nombre: "Pago de deuda", emoji: "🧾", clase: "fija" },
  { id: "otros", nombre: "Otros", emoji: "•", clase: "variable" },
];

/** El documento vacío: sin un solo monto inventado. */
export function datosVacios(iso = hoyISO()) {
  return {
    version: VERSION_DATOS,
    creado: iso,
    actualizado: iso,
    perfil: {
      moneda: "MXN",
      ingresoQuincenal: null, // null = todavía no lo captura. No es cero.
      cortes: [15],
      colchonObjetivo: null,
    },
    categorias: CATEGORIAS_BASE.map((c) => ({ ...c, tope: null })),
    movimientos: {}, // "AAAA-MM" → [movimiento]
    presupuestos: {}, // "AAAA-MM" → { categoriaId: topeCentavos }
    fijos: [],
    deudas: [],
    metas: [],
    // Lo que llegó solo y todavía no confirma nadie. Nada de aquí cuenta en ningún número
    // hasta que la persona lo acepta: un aviso mal leído no debe poder ensuciar las cuentas.
    bandeja: [],
    // Lo que la app aprendió de sus correcciones: "este comercio es de esta categoría".
    reglas: [],
  };
}

let contador = 0;
/** Identificador local, sin dependencias: tiempo + contador + azar. */
export function idNuevo(prefijo = "m") {
  contador = (contador + 1) % 1000;
  const tiempo = Date.now().toString(36);
  const azar = Math.random().toString(36).slice(2, 6);
  return `${prefijo}_${tiempo}${contador.toString(36)}${azar}`;
}

function entero(valor, porDefecto = null) {
  const n = typeof valor === "string" ? aCentavos(valor) : valor;
  return Number.isFinite(n) ? Math.trunc(n) : porDefecto;
}

/**
 * Deja el documento en su forma canónica: rellena lo que falte, tira lo que no sirve.
 * Todo lo que entra al motor pasa por aquí — un JSON importado a mano incluido.
 */
export function normalizar(entrada) {
  const base = datosVacios();
  const datos = entrada && typeof entrada === "object" ? entrada : {};

  const perfil = { ...base.perfil, ...(datos.perfil || {}) };
  perfil.ingresoQuincenal = entero(perfil.ingresoQuincenal, null);
  perfil.colchonObjetivo = entero(perfil.colchonObjetivo, null);
  perfil.cortes = Array.isArray(perfil.cortes)
    ? perfil.cortes.filter((c) => Number.isInteger(c) && c >= 1 && c <= 30)
    : [15];
  perfil.moneda = perfil.moneda || "MXN";

  const categorias = (Array.isArray(datos.categorias) && datos.categorias.length
    ? datos.categorias
    : base.categorias
  )
    .filter((c) => c && c.id)
    .map((c) => ({
      id: String(c.id),
      nombre: String(c.nombre || c.id),
      emoji: c.emoji || "•",
      clase: c.clase === "fija" ? "fija" : "variable",
      tope: entero(c.tope, null),
      archivada: Boolean(c.archivada),
    }));

  const movimientos = {};
  for (const [mes, lista] of Object.entries(datos.movimientos || {})) {
    if (!/^\d{4}-\d{2}$/.test(mes) || !Array.isArray(lista)) continue;
    const limpios = lista.map(normalizarMovimiento).filter(Boolean);
    if (limpios.length) movimientos[mes] = limpios.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }

  const presupuestos = {};
  for (const [mes, topes] of Object.entries(datos.presupuestos || {})) {
    if (!/^\d{4}-\d{2}$/.test(mes) || !topes || typeof topes !== "object") continue;
    const limpio = {};
    for (const [id, tope] of Object.entries(topes)) {
      const valor = entero(tope, null);
      if (valor !== null) limpio[id] = valor;
    }
    if (Object.keys(limpio).length) presupuestos[mes] = limpio;
  }

  return {
    version: VERSION_DATOS,
    creado: datos.creado || base.creado,
    actualizado: datos.actualizado || base.actualizado,
    perfil,
    categorias,
    movimientos,
    presupuestos,
    fijos: (Array.isArray(datos.fijos) ? datos.fijos : []).map(normalizarFijo).filter(Boolean),
    deudas: (Array.isArray(datos.deudas) ? datos.deudas : []).map(normalizarDeuda).filter(Boolean),
    metas: (Array.isArray(datos.metas) ? datos.metas : []).map(normalizarMeta).filter(Boolean),
    bandeja: (Array.isArray(datos.bandeja) ? datos.bandeja : []).map(normalizarEntrada).filter(Boolean),
    reglas: (Array.isArray(datos.reglas) ? datos.reglas : []).map(normalizarRegla).filter(Boolean),
  };
}

export const ESTADOS_BANDEJA = { PENDIENTE: "pendiente", ACEPTADO: "aceptado", DESCARTADO: "descartado" };
export const ORIGENES = { PEGADO: "pegado", COMPARTIDO: "compartido", CORREO: "correo" };

/**
 * Una entrada de la bandeja: un movimiento propuesto, con de dónde salió y qué tan seguro
 * está el lector. Guarda lo extraído, nunca el texto del aviso.
 */
export function normalizarEntrada(e) {
  if (!e || typeof e !== "object") return null;
  const movimiento = normalizarMovimiento(e.movimiento);
  if (!movimiento) return null;
  const estado = Object.values(ESTADOS_BANDEJA).includes(e.estado) ? e.estado : ESTADOS_BANDEJA.PENDIENTE;
  return {
    id: e.id || idNuevo("ent"),
    recibido: esISO(e.recibido) ? e.recibido : movimiento.fecha,
    estado,
    movimiento,
    huella: e.huella ? String(e.huella).slice(0, 200) : null,
    confianza: ["alta", "media", "baja"].includes(e.confianza) ? e.confianza : "baja",
    banco: e.banco ? String(e.banco).slice(0, 40) : null,
    comercio: e.comercio ? String(e.comercio).slice(0, 60) : null,
    ultimos4: /^\d{4}$/.test(e.ultimos4 || "") ? e.ultimos4 : null,
    origen: Object.values(ORIGENES).includes(e.origen) ? e.origen : ORIGENES.PEGADO,
    aviso: e.aviso ? String(e.aviso).slice(0, 280) : "",
    posibleTraspaso: Boolean(e.posibleTraspaso),
    movimientoId: e.movimientoId || null, // el que se creó al aceptarla, para poder deshacer
  };
}

/** Una regla aprendida: "cuando veas este comercio, es esta categoría". */
export function normalizarRegla(r) {
  if (!r || !r.clave || !r.categoriaId) return null;
  return {
    clave: String(r.clave).slice(0, 60),
    categoriaId: String(r.categoriaId),
    veces: Number.isInteger(r.veces) && r.veces > 0 ? r.veces : 1,
    ultima: esISO(r.ultima) ? r.ultima : null,
  };
}

export function normalizarMovimiento(m) {
  if (!m || !esISO(m.fecha)) return null;
  const monto = entero(m.monto, null);
  if (monto === null || monto === 0) return null;

  const tipo = Object.values(TIPOS).includes(m.tipo) ? m.tipo : TIPOS.GASTO;
  return {
    id: m.id || idNuevo("mov"),
    fecha: m.fecha,
    monto: Math.abs(monto), // el signo lo da el tipo, no el número
    tipo,
    categoria: m.categoria ? String(m.categoria) : tipo === TIPOS.GASTO ? "otros" : null,
    metodo: m.metodo ? String(m.metodo) : null,
    nota: m.nota ? String(m.nota).slice(0, 280) : "",
    fijoId: m.fijoId || null,
    deudaId: m.deudaId || null,
    metaId: m.metaId || null,
  };
}

/** Cada cuántos meses se paga un fijo. La tenencia no es un gasto mensual. */
export const FRECUENCIAS = [
  { meses: 1, etiqueta: "Cada mes" },
  { meses: 2, etiqueta: "Cada 2 meses" },
  { meses: 3, etiqueta: "Cada 3 meses" },
  { meses: 6, etiqueta: "Cada 6 meses" },
  { meses: 12, etiqueta: "Cada año" },
];

export function normalizarFijo(f) {
  if (!f || !f.nombre) return null;
  const monto = entero(f.monto, null);
  const frecuencia = FRECUENCIAS.some((x) => x.meses === f.frecuencia) ? f.frecuencia : 1;
  return {
    id: f.id || idNuevo("fijo"),
    nombre: String(f.nombre).slice(0, 80),
    monto, // null = lo tiene registrado pero no sabe cuánto. Se declara, no se asume.
    diaCorte: Number.isInteger(f.diaCorte) ? Math.min(Math.max(f.diaCorte, 1), 31) : 1,
    frecuencia,
    // En qué mes toca cuando no es mensual. Sin ancla, un fijo anual no sabría cuándo cae.
    mesAncla: /^\d{4}-\d{2}$/.test(f.mesAncla || "") ? f.mesAncla : null,
    deudaId: f.deudaId || null, // si este pago abona a una deuda, la abona de verdad
    categoria: f.categoria ? String(f.categoria) : "servicios",
    activo: f.activo !== false,
  };
}

export function normalizarDeuda(d) {
  if (!d || !d.nombre) return null;
  return {
    id: d.id || idNuevo("deuda"),
    nombre: String(d.nombre).slice(0, 80),
    montoOriginal: entero(d.montoOriginal, null),
    tasaAnual: Number.isFinite(d.tasaAnual) ? d.tasaAnual : null, // sin tasa no se proyecta interés
    diaCorte: Number.isInteger(d.diaCorte) ? Math.min(Math.max(d.diaCorte, 1), 31) : 1,
    activa: d.activa !== false,
  };
}

export function normalizarMeta(m) {
  if (!m || !m.nombre) return null;
  return {
    id: m.id || idNuevo("meta"),
    nombre: String(m.nombre).slice(0, 80),
    objetivo: entero(m.objetivo, null),
    fechaLimite: esISO(m.fechaLimite) ? m.fechaLimite : null,
    prioridad: Number.isInteger(m.prioridad) ? m.prioridad : 1,
    lograda: Boolean(m.lograda),
  };
}

// --- Lectura ---

export function movimientosDelMes(datos, mes) {
  return datos.movimientos[mes] || [];
}

/** Movimientos entre dos fechas, inclusive. Solo toca los meses que hacen falta. */
export function movimientosEntre(datos, desde, hasta) {
  const salida = [];
  for (const [mes, lista] of Object.entries(datos.movimientos)) {
    if (mes < desde.slice(0, 7) || mes > hasta.slice(0, 7)) continue;
    for (const m of lista) if (m.fecha >= desde && m.fecha <= hasta) salida.push(m);
  }
  return salida.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

export function categoriaPorId(datos, id) {
  return datos.categorias.find((c) => c.id === id) || null;
}

export function suma(movimientos, filtro = () => true) {
  return movimientos.reduce((total, m) => (filtro(m) ? total + m.monto : total), 0);
}

// --- Escritura (devuelven datos nuevos; nunca mutan el documento recibido) ---

export function agregarMovimiento(datos, entrada) {
  const mov = normalizarMovimiento({ ...entrada, id: entrada.id || idNuevo("mov") });
  if (!mov) return { datos, error: "El movimiento necesita fecha y monto." };

  const mes = mesDe(mov.fecha);
  const lista = [mov, ...(datos.movimientos[mes] || [])].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  return {
    datos: { ...datos, movimientos: { ...datos.movimientos, [mes]: lista } },
    movimiento: mov,
    error: null,
  };
}

export function eliminarMovimiento(datos, id) {
  const movimientos = {};
  for (const [mes, lista] of Object.entries(datos.movimientos)) {
    const filtrada = lista.filter((m) => m.id !== id);
    if (filtrada.length) movimientos[mes] = filtrada;
  }
  return { ...datos, movimientos };
}
