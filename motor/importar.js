// Importar un estado de cuenta — meses de historial sin teclear uno solo.
//
// Todos los bancos de aquí dejan bajar los movimientos en CSV, y varios en OFX. Es la forma más
// rápida de que la app sepa a dónde se va el dinero desde el primer día, en vez de esperar a
// que se junten tres quincenas de avisos.
//
// La regla de la casa no cambia: lo que entra de un archivo va a la BANDEJA, como cualquier
// aviso, y no cuenta en ningún número hasta que la persona dice que sí. Y antes de eso, la
// persona confirma qué columna es qué — un CSV no trae instrucciones, y adivinar en silencio
// que la tercera columna es el monto es la clase de suposición que esta app no hace.
//
// Lo que NO lee: Excel (.xls/.xlsx). Es un formato binario que pide una dependencia, y el mismo
// banco que lo ofrece ofrece CSV. Se dice así en pantalla, en vez de fallar raro.

import { aCentavos, formatear } from "./dinero.js";
import { esISO, armarISO, diasEntre, hoyISO } from "./ciclo.js";
import { TIPOS, ORIGENES, ESTADOS_BANDEJA, ACCIONES_REGLA, normalizarEntrada, esperaRespuesta } from "./modelo.js";
import { sugerirParaAviso } from "./aprendizaje.js";

/** Cuántas filas se miran, como mucho, buscando el encabezado. Los bancos ponen un preámbulo. */
const FILAS_DE_PREAMBULO = 25;

/** Lo más que se acepta de un archivo. Un año de movimientos de alguien muy activo cabe holgado. */
export const MAXIMO_DE_FILAS = 3000;

/**
 * Cuántas entradas pueden estar esperando en la bandeja por culpa de un archivo. La bandeja
 * viaja entera en un solo documento cuando hay sincronización, y ese documento tiene tope
 * (~570 entradas). Un año de movimientos de golpe lo rompería. Se manda una tanda, la persona
 * la acepta, y vuelve a subir el mismo archivo: lo ya mandado no se repite.
 */
export const TANDA_DE_IMPORTACION = 300;

/** Los campos que se pueden mapear, en el orden en que se piden en pantalla. */
export const CAMPOS_IMPORTAR = [
  { clave: "fecha", etiqueta: "Fecha" },
  { clave: "descripcion", etiqueta: "Descripción" },
  { clave: "monto", etiqueta: "Monto (con signo)" },
  { clave: "cargo", etiqueta: "Cargo / retiro" },
  { clave: "abono", etiqueta: "Abono / depósito" },
  { clave: "referencia", etiqueta: "Referencia" },
];

// ── Partir el texto ────────────────────────────────────────────────────────

/** ¿Es un OFX? Se reconoce por su cabecera, no por la extensión: los nombres mienten. */
export function esOFX(texto) {
  return /OFXHEADER|<OFX>/i.test(String(texto || "").slice(0, 2000));
}

/** El separador que más filas parte en el mismo número de columnas. */
function separadorDelCSV(texto) {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  let mejor = { sep: ",", puntos: -1 };
  for (const sep of [",", ";", "\t", "|"]) {
    const cuentas = lineas.map((l) => partirLineaCSV(l, sep).length).filter((n) => n > 1);
    if (!cuentas.length) continue;
    const moda = cuentas.sort((a, b) => cuentas.filter((x) => x === b).length - cuentas.filter((x) => x === a).length)[0];
    const puntos = cuentas.filter((n) => n === moda).length * 10 + moda;
    if (puntos > mejor.puntos) mejor = { sep, puntos };
  }
  return mejor.sep;
}

/** Una línea de CSV en celdas, respetando comillas. Una sola línea: no se cruzan renglones. */
function partirLineaCSV(linea, sep) {
  const celdas = [];
  let actual = "";
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (entreComillas) {
      if (c === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
      else if (c === '"') entreComillas = false;
      else actual += c;
    } else if (c === '"') entreComillas = true;
    else if (c === sep) { celdas.push(actual.trim()); actual = ""; }
    else actual += c;
  }
  celdas.push(actual.trim());
  return celdas;
}

/**
 * El CSV en filas de celdas. Las comillas pueden contener saltos de línea (hay bancos que meten
 * la descripción en dos renglones), así que se junta lo que quedó con una comilla abierta.
 */
export function partirCSV(texto) {
  const limpio = String(texto || "").replace(/^﻿/, "");
  const sep = separadorDelCSV(limpio);
  const filas = [];
  let pendiente = "";
  for (const linea of limpio.split(/\r?\n/)) {
    pendiente = pendiente ? `${pendiente}\n${linea}` : linea;
    if ((pendiente.match(/"/g) || []).length % 2 === 1) continue; // comilla abierta: sigue
    if (pendiente.trim()) filas.push(partirLineaCSV(pendiente, sep));
    pendiente = "";
    if (filas.length > MAXIMO_DE_FILAS + FILAS_DE_PREAMBULO) break;
  }
  if (pendiente.trim()) filas.push(partirLineaCSV(pendiente, sep));
  return filas;
}

// ── Leer celdas ────────────────────────────────────────────────────────────

const MESES_DE_ARCHIVO = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
  sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};

function anioDeArchivo(a) {
  const n = Number(a);
  return a.length <= 2 ? 2000 + n : n;
}

/**
 * Una fecha de banco a ISO, o null. `orden` dice cómo leer "03/04/2026": "dma" (como se escribe
 * aquí) o "mda" (como lo exportan algunos sistemas gringos).
 */
export function leerFecha(texto, orden = "dma") {
  const t = String(texto || "").trim().toLowerCase();
  if (!t) return null;
  let anio, mes, dia;

  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];

  if (!m && (m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/))) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    [dia, mes] = orden === "mda" ? [b, a] : [a, b];
    anio = anioDeArchivo(m[3]);
  }

  if (!m && (m = t.match(/^(\d{1,2})[-/. ]+([a-z]{3})[a-z]*\.?[-/. ]+(\d{2,4})\b/))) {
    mes = MESES_DE_ARCHIVO[m[2]];
    dia = Number(m[1]);
    anio = anioDeArchivo(m[3]);
  }

  if (!m && (m = t.match(/^(\d{4})(\d{2})(\d{2})/))) [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];

  if (!m || !mes) return null;
  const iso = armarISO(anio, mes, dia);
  return esISO(iso) ? iso : null;
}

/**
 * Cómo vienen las fechas de esta columna. Si algún primer número pasa de 12, es día primero; si
 * algún segundo, mes primero. Si ninguno lo delata, se supone el de aquí — y la pantalla lo
 * enseña para que la persona lo cambie si no.
 */
export function ordenDeFechas(valores) {
  let dma = false;
  let mda = false;
  for (const v of valores) {
    const m = String(v || "").trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    if (Number(m[1]) > 12) dma = true;
    if (Number(m[2]) > 12) mda = true;
  }
  return { orden: mda && !dma ? "mda" : "dma", seguro: dma !== mda };
}

/**
 * Un monto de estado de cuenta a centavos CON signo, o null.
 * Acepta "$1,234.50", "-1234.5", "(1,234.50)" y "1,234.50-" (negativos de contador), y
 * "1.234,50" (coma decimal).
 */
export function leerMonto(texto) {
  let t = String(texto || "").replace(/\s|\$|mxn|mn/gi, "");
  if (!t) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(t)) { negativo = true; t = t.slice(1, -1); }
  if (/-$/.test(t)) { negativo = true; t = t.slice(0, -1); }
  if (t.startsWith("-")) { negativo = !negativo; t = t.slice(1); }
  if (t.startsWith("+")) t = t.slice(1);
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t) || /^\d+,\d{1,2}$/.test(t)) {
    t = t.replace(/\./g, "").replace(",", ".");
  }
  const centavos = aCentavos(t);
  if (centavos === null) return null;
  return negativo ? -centavos : centavos;
}

// ── Qué columna es qué ─────────────────────────────────────────────────────

function sinAcentosCSV(texto) {
  return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

const PISTAS_DE_COLUMNA = {
  fecha: /\b(fecha|date|dia)\b/,
  cargo: /\b(cargos?|retiros?|debitos?|debits?|egresos?|salidas?)\b/,
  abono: /\b(abonos?|depositos?|creditos?|credits?|ingresos?|entradas?)\b/,
  monto: /\b(importe|monto|amount|cantidad|valor)\b/,
  descripcion: /\b(descripcion|concepto|detalle|description|memo|beneficiario|comercio|establecimiento|movimiento)\b/,
  referencia: /\b(referencia|folio|rastreo|autorizacion|reference)\b/,
  saldo: /\b(saldo|balance)\b/,
};

/** ¿Esta fila es el encabezado? Tiene que nombrar una fecha y algo de dinero. */
function pareceEncabezado(fila) {
  const celdas = fila.map(sinAcentosCSV);
  const fecha = celdas.some((c) => PISTAS_DE_COLUMNA.fecha.test(c));
  const dinero = celdas.some((c) => PISTAS_DE_COLUMNA.monto.test(c) || PISTAS_DE_COLUMNA.cargo.test(c) || PISTAS_DE_COLUMNA.abono.test(c));
  return fecha && dinero;
}

/** Propone qué columna es cada campo a partir de los nombres del encabezado. */
function mapeoPorNombres(encabezado) {
  const mapeo = { fecha: null, descripcion: null, monto: null, cargo: null, abono: null, referencia: null };
  const tomada = new Set();
  const tomar = (campo, prueba) => {
    if (mapeo[campo] !== null) return;
    const i = encabezado.findIndex((c, j) => !tomada.has(j) && prueba(sinAcentosCSV(c)));
    if (i >= 0) { mapeo[campo] = i; tomada.add(i); }
  };
  // El saldo se aparta primero: "saldo" nunca es un movimiento, y "abono" no debe tragárselo.
  encabezado.forEach((c, j) => { if (PISTAS_DE_COLUMNA.saldo.test(sinAcentosCSV(c))) tomada.add(j); });
  tomar("fecha", (c) => PISTAS_DE_COLUMNA.fecha.test(c));
  // Una columna que dice "cargo/abono" no es ni cargo ni abono: es el monto con su sentido.
  tomar("cargo", (c) => PISTAS_DE_COLUMNA.cargo.test(c) && !PISTAS_DE_COLUMNA.abono.test(c));
  tomar("abono", (c) => PISTAS_DE_COLUMNA.abono.test(c) && !PISTAS_DE_COLUMNA.cargo.test(c));
  tomar("monto", (c) => PISTAS_DE_COLUMNA.monto.test(c) || (PISTAS_DE_COLUMNA.cargo.test(c) && PISTAS_DE_COLUMNA.abono.test(c)));
  tomar("descripcion", (c) => PISTAS_DE_COLUMNA.descripcion.test(c));
  tomar("referencia", (c) => PISTAS_DE_COLUMNA.referencia.test(c));
  if (mapeo.cargo !== null && mapeo.abono !== null) mapeo.monto = null;
  return mapeo;
}

/** Sin encabezado: se adivina por el contenido, y la pantalla lo enseña para corregirlo. */
function mapeoPorContenido(filas) {
  const columnas = Math.max(...filas.map((f) => f.length));
  const proporcion = (j, prueba) => {
    const valores = filas.map((f) => f[j]).filter((v) => v !== undefined && v !== "");
    return valores.length ? valores.filter(prueba).length / valores.length : 0;
  };
  const mapeo = { fecha: null, descripcion: null, monto: null, cargo: null, abono: null, referencia: null };
  for (let j = 0; j < columnas && mapeo.fecha === null; j++) {
    if (proporcion(j, (v) => leerFecha(v) !== null) >= 0.6) mapeo.fecha = j;
  }
  const numericas = [];
  for (let j = 0; j < columnas; j++) {
    if (j !== mapeo.fecha && proporcion(j, (v) => leerMonto(v) !== null) >= 0.6) numericas.push(j);
  }
  // La última columna numérica de un estado de cuenta suele ser el saldo: no se usa como monto
  // si hay otra antes.
  mapeo.monto = numericas.length ? numericas[0] : null;
  let largo = -1;
  for (let j = 0; j < columnas; j++) {
    if (j === mapeo.fecha || numericas.includes(j)) continue;
    const promedio = filas.reduce((t, f) => t + String(f[j] || "").length, 0) / filas.length;
    if (promedio > largo) { largo = promedio; mapeo.descripcion = j; }
  }
  return mapeo;
}

/**
 * Lee un CSV y propone cómo interpretarlo. Devuelve `{ encabezado, filas, mapeo, orden,
 * ordenSeguro }`: las filas son las de DATOS (sin preámbulo ni encabezado).
 */
export function analizarCSV(texto) {
  const todas = partirCSV(texto);
  const indice = todas.slice(0, FILAS_DE_PREAMBULO).findIndex(pareceEncabezado);
  const encabezado = indice >= 0 ? todas[indice] : null;
  let filas = indice >= 0 ? todas.slice(indice + 1) : todas;
  // Sin encabezado, lo de antes de la primera fecha es preámbulo.
  if (!encabezado) {
    const primera = filas.findIndex((f) => f.some((c) => leerFecha(c) !== null));
    filas = primera >= 0 ? filas.slice(primera) : [];
  }
  filas = filas.filter((f) => f.some((c) => c !== "")).slice(0, MAXIMO_DE_FILAS);
  const mapeo = encabezado ? mapeoPorNombres(encabezado) : mapeoPorContenido(filas.slice(0, 50));
  const { orden, seguro } = ordenDeFechas(mapeo.fecha === null ? [] : filas.map((f) => f[mapeo.fecha]));
  return { encabezado, filas, mapeo, orden, ordenSeguro: seguro };
}

/**
 * Las filas, ya convertidas a movimientos con el mapeo que confirmó la persona.
 * Devuelve `{ movimientos, descartadas }`. Una fila que no tiene fecha o monto que se pueda leer
 * no se inventa: se cuenta como descartada (son los totales y renglones de pie de página).
 *
 * `invertir` es para los bancos que exportan los cargos en positivo en la columna de monto.
 */
export function filasAMovimientos(filas, mapeo, { orden = "dma", invertir = false } = {}) {
  const movimientos = [];
  let descartadas = 0;
  const usada = (j) => j !== null && j !== undefined && j !== "";
  const celda = (fila, j) => (usada(j) ? fila[Number(j)] ?? "" : "");
  const separadas = usada(mapeo.cargo) || usada(mapeo.abono);

  for (const fila of filas) {
    const fecha = leerFecha(celda(fila, mapeo.fecha), orden);
    let firmado = null;
    if (separadas) {
      const cargo = leerMonto(celda(fila, mapeo.cargo));
      const abono = leerMonto(celda(fila, mapeo.abono));
      if (cargo) firmado = -Math.abs(cargo);
      else if (abono) firmado = Math.abs(abono);
    } else {
      firmado = leerMonto(celda(fila, mapeo.monto));
      if (firmado !== null && invertir) firmado = -firmado;
    }
    if (!fecha || !firmado) {
      descartadas++;
      continue;
    }
    const nota = String(celda(fila, mapeo.descripcion)).replace(/\s+/g, " ").trim().slice(0, 120);
    const ref = String(celda(fila, mapeo.referencia)).trim().slice(0, 40) || null;
    movimientos.push({
      fecha,
      monto: Math.abs(firmado),
      tipo: firmado < 0 ? TIPOS.GASTO : TIPOS.INGRESO,
      nota,
      ref,
    });
  }
  return { movimientos, descartadas };
}

/** El valor de una etiqueta OFX dentro de un bloque. OFX 1 no cierra sus etiquetas. */
function etiquetaOFX(bloque, nombre) {
  const m = bloque.match(new RegExp(`<${nombre}>([^<\\r\\n]*)`, "i"));
  return m ? m[1].trim() : "";
}

/** Lee un OFX. No pide mapeo: el formato ya dice qué es cada cosa. */
export function leerOFX(texto) {
  const movimientos = [];
  let descartadas = 0;
  const bloques = String(texto || "").split(/<STMTTRN>/i).slice(1, MAXIMO_DE_FILAS + 1);
  for (const crudo of bloques) {
    const bloque = crudo.split(/<\/STMTTRN>/i)[0];
    const fecha = leerFecha(etiquetaOFX(bloque, "DTPOSTED").slice(0, 8));
    const firmado = leerMonto(etiquetaOFX(bloque, "TRNAMT"));
    if (!fecha || !firmado) {
      descartadas++;
      continue;
    }
    const nombre = etiquetaOFX(bloque, "NAME");
    const memo = etiquetaOFX(bloque, "MEMO");
    const nota = (nombre && memo && !memo.toLowerCase().includes(nombre.toLowerCase()) ? `${nombre} ${memo}` : nombre || memo)
      .replace(/\s+/g, " ").slice(0, 120);
    movimientos.push({
      fecha,
      monto: Math.abs(firmado),
      tipo: firmado < 0 ? TIPOS.GASTO : TIPOS.INGRESO,
      nota,
      ref: etiquetaOFX(bloque, "FITID").slice(0, 40) || null,
    });
  }
  return { movimientos, descartadas };
}

// ── A la bandeja ───────────────────────────────────────────────────────────

/** Qué tan lejos puede estar un movimiento ya capturado para sospechar que es el mismo. */
const DIAS_DE_PARECIDO = 2;

function claveDeFila(texto) {
  return sinAcentosCSV(texto).replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Manda los movimientos del archivo a la bandeja. Devuelve `{ datos, nuevos, repetidos,
 * parecidos, sinCupo }`. `sinCupo` son los que no cupieron en esta tanda.
 *
 * Volver a subir el mismo archivo no duplica nada: cada fila lleva una huella (su FITID, o su
 * fecha+monto+descripción con el número de vez que aparece en el archivo), y lo que ya pasó por
 * la bandeja no vuelve a entrar. Lo que se parece a algo que ya capturaste —mismo monto, mismo
 * sentido, a dos días o menos— entra, pero marcado para revisar a mano: puede ser el mismo
 * movimiento que llegó por correo, o dos cafés iguales. Eso no lo decide la app.
 */
export function mandarABandeja(datos, movimientos, iso = hoyISO(), tanda = TANDA_DE_IMPORTACION) {
  const esperando = (datos.bandeja || []).filter((e) => e.origen === ORIGENES.ARCHIVO && esperaRespuesta(e)).length;
  const cupo = Math.max(0, tanda - esperando);
  let sinCupo = 0;
  const huellasVistas = new Set((datos.bandeja || []).map((e) => e.huella).filter(Boolean));
  const refs = new Set(Object.values(datos.movimientos || {}).flat().map((m) => m.ref).filter(Boolean));
  const capturados = Object.values(datos.movimientos || {}).flat();
  const veces = new Map();
  const nuevas = [];
  let repetidos = 0;
  let parecidos = 0;

  for (const m of movimientos) {
    const base = `${m.fecha}|${m.tipo}|${m.monto}|${claveDeFila(m.nota)}`;
    const vez = (veces.get(base) || 0) + 1;
    veces.set(base, vez);
    const huella = m.ref ? `archivo:${m.ref}` : `archivo:${base}#${vez}`;
    if (huellasVistas.has(huella) || (m.ref && refs.has(m.ref))) {
      repetidos++;
      continue;
    }
    if (nuevas.length >= cupo) {
      sinCupo++;
      continue;
    }
    huellasVistas.add(huella);

    const parecido = capturados.find((c) =>
      c.monto === m.monto &&
      (c.tipo === m.tipo || (m.tipo === TIPOS.GASTO && c.tipo === TIPOS.PAGO)) &&
      Math.abs(diasEntre(c.fecha, m.fecha)) <= DIAS_DE_PARECIDO);
    if (parecido) parecidos++;

    const sugerida = m.tipo === TIPOS.GASTO ? sugerirParaAviso(datos, m.nota) : null;
    const esPago = Boolean(sugerida && sugerida.accion === ACCIONES_REGLA.PAGO);
    const movimiento = esPago
      ? { ...m, tipo: TIPOS.PAGO, categoria: null, tarjetaId: sugerida.tarjetaId }
      : { ...m, categoria: sugerida ? sugerida.categoriaId : m.tipo === TIPOS.GASTO ? "otros" : null };

    const entrada = normalizarEntrada({
      recibido: iso,
      estado: ESTADOS_BANDEJA.PENDIENTE,
      movimiento,
      huella,
      // Un archivo del banco no es un OCR ni un correo que hubo que interpretar: el monto y la
      // fecha son los del banco. Lo único que deja la confianza en baja es parecerse a algo
      // que ya está, porque eso sí hay que mirarlo.
      confianza: parecido ? "baja" : "alta",
      comercio: m.nota ? m.nota.slice(0, 60) : null,
      origen: ORIGENES.ARCHIVO,
      aviso: [
        parecido ? `Ya tienes ${parecido.tipo === TIPOS.INGRESO ? "un ingreso" : "un movimiento"} de ${formatear(parecido.monto)} el ${parecido.fecha}: si es el mismo, descártalo.` : "",
        esPago ? sugerida.veredicto.motivo : "",
      ].filter(Boolean).join(" "),
    });
    if (entrada) nuevas.push(entrada);
  }

  return {
    datos: nuevas.length ? { ...datos, bandeja: [...nuevas, ...(datos.bandeja || [])] } : datos,
    nuevos: nuevas.length,
    repetidos,
    parecidos,
    sinCupo,
  };
}
