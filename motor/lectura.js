// Lectura de avisos — convertir el texto de un banco en un movimiento.
//
// Esta es la pieza que hace que la app sirva para alguien sin tiempo. Y es también la más
// peligrosa, porque un aviso mal leído ensucia los números en silencio. Por eso:
//
//   1. NUNCA devuelve un movimiento a medias. Sin monto no hay nada que registrar y se
//      declara `SIN_DATOS_SUFICIENTES`, igual que todo el motor.
//   2. NUNCA guarda el correo. Solo monto, fecha, comercio y los últimos 4 de la tarjeta.
//      El cuerpo del aviso se usa aquí y se tira.
//   3. SIEMPRE dice qué tan seguro está. La confianza es parte de la respuesta, no una
//      nota al pie: es lo que decide si esto se muestra como un hecho o como una pregunta.
//
// Funciona con cualquier banco, reconocido o no. La tabla de reglas-banco.js sube la
// confianza; su ausencia no impide leer.

import { aCentavos } from "./dinero.js";
import { hoyISO, armarISO, diasEnMes, sumarDias, diasEntre } from "./ciclo.js";
import { TIPOS } from "./modelo.js";
import { veredicto, sinDatos, ESTADOS, SEVERIDADES } from "./veredicto.js";
import { bancoDeRemitente } from "./reglas-banco.js";

export const CONFIANZAS = { ALTA: "alta", MEDIA: "media", BAJA: "baja" };

/** A cuántos días de hoy deja de ser creíble la fecha de un aviso. */
const DIAS_RAZONABLES = 60;

const MESES_ES = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
};

// Un monto se reconoce por el signo o por la moneda. Pedir una de las dos evita confundir
// un número de referencia de 6 dígitos con dinero.
// Un monto se reconoce por el signo o por la moneda, y la moneda puede ir de los dos lados:
// "$1,234.56", "1,234.56 MXN" y "MXN 1,234.56" son el mismo dinero. Pedir alguna de las dos
// marcas evita confundir un número de referencia de seis dígitos con un importe.
const CIFRA = String.raw`\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const PATRON_MONTO = new RegExp(
  String.raw`\$\s*(${CIFRA})` +                                   // $1,234.56
  String.raw`|\b(?:MXN|M\.?N\.?)\s*(${CIFRA})\b` +                // MXN 1,234.56
  String.raw`|\b(${CIFRA})\s*(?:MXN|M\.?N\.?|pesos)\b`,           // 1,234.56 MXN
  "gi",
);

// Lo que aparece junto a un monto que NO es el de la operación. Es la regla que más errores
// evita: casi todo aviso bancario trae el saldo, y el saldo no es un gasto.
const CONTEXTO_AJENO = /(saldo|disponible|l[íi]mite|l[íi]nea de cr[ée]dito|puntos|cashback|pago m[íi]nimo|para no generar intereses|meses sin intereses|promoci[óo]n|aprovecha|participantes|felicidades)/i;
const CONTEXTO_PROPIO = /(monto|importe|cargo|compra|total|pago|retiro|abono|dep[óo]sito|transferencia|env[íi]o|cobro|consumo)/i;

const PISTAS_INGRESO = /(recibiste|recibida|recibido|te depositaron|te enviaron|abono|dep[óo]sito|devoluci[óo]n|reembolso|bonificaci[óo]n|cancelaci[óo]n de cargo|nómina|n[óo]mina)/i;
const PISTAS_GASTO = /(compra|cargo|retiro|disposici[óo]n|pagaste|enviaste|realizaste un pago|transferencia enviada|spei enviado|domiciliaci[óo]n)/i;
const PISTAS_TRASPASO = /(entre tus cuentas|entre cuentas propias|a tu cuenta|traspaso|cuenta propia)/i;

/** Quita el HTML y deja texto plano. Los avisos de banco llegan casi siempre en HTML. */
export function limpiarAviso(entrada) {
  return String(entrada || "")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;?/gi, "&")
    .replace(/&(lt|gt|quot|#39|apos);?/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * El monto de la operación. Devuelve `{ centavos, seguro }`.
 * `seguro` es false cuando el número existe pero nadie dijo de qué era: se lee, pero baja
 * la confianza en vez de fingir certeza.
 */
/** A cuántos caracteres del monto queda la palabra más cercana que empate con `patron`. */
function distanciaA(patron, antes, despues) {
  const atras = [...antes.matchAll(new RegExp(patron.source, "gi"))].pop();
  const adelante = despues.match(new RegExp(patron.source, "i"));
  return Math.min(
    atras ? antes.length - (atras.index + atras[0].length) : Infinity,
    adelante ? adelante.index : Infinity,
  );
}

export function montoDelAviso(texto) {
  const candidatos = [];
  PATRON_MONTO.lastIndex = 0;
  let hallazgo;
  while ((hallazgo = PATRON_MONTO.exec(texto))) {
    const centavos = aCentavos(hallazgo[1] || hallazgo[2] || hallazgo[3]);
    if (centavos === null || centavos === 0) continue;
    // Gana la palabra MÁS CERCANA, no cualquiera de la ventana. En "Cargo por $89.00 en OXXO.
    // Saldo disponible: $8,000" las dos palabras rodean al mismo número: mirar si existe un
    // "saldo" por ahí descartaba el cargo de verdad.
    const antes = texto.slice(Math.max(0, hallazgo.index - 60), hallazgo.index);
    const despues = texto.slice(hallazgo.index + hallazgo[0].length, hallazgo.index + hallazgo[0].length + 25);
    const aAjeno = distanciaA(CONTEXTO_AJENO, antes, despues);
    const aPropio = distanciaA(CONTEXTO_PROPIO, antes, despues);
    candidatos.push({ centavos, ajeno: aAjeno < aPropio, propio: aPropio < aAjeno });
  }

  if (!candidatos.length) return { centavos: null, seguro: false, varios: false };

  const noAjeno = candidatos.filter((c) => !c.ajeno);
  // Un estado de cuenta trae varias operaciones y aquí solo cabe una. No se inventa nada:
  // se lee la primera y se dice que había más, para que la persona revise el correo.
  const varios = new Set(noAjeno.map((c) => c.centavos)).size > 1;

  const nombrado = candidatos.find((c) => c.propio && !c.ajeno);
  if (nombrado) return { centavos: nombrado.centavos, seguro: true, varios };

  if (noAjeno.length === 1) return { centavos: noAjeno[0].centavos, seguro: true, varios };
  if (noAjeno.length) return { centavos: noAjeno[0].centavos, seguro: false, varios };

  // Todos los montos eran saldos, límites o promociones. Eso no es una operación: es un
  // aviso informativo. Antes se colaba como un gasto de confianza baja y ensuciaba la
  // bandeja con cosas que nadie compró.
  return { centavos: null, seguro: false, soloAjenos: true };
}

function fechaValida(anio, mes, dia) {
  if (mes < 1 || mes > 12) return null;
  if (dia < 1 || dia > diasEnMes(anio, mes)) return null;
  return armarISO(anio, mes, dia);
}

function anioCompleto(crudo, hoy) {
  const n = Number(crudo);
  if (crudo.length === 4) return n;
  return n + (n > 70 ? 1900 : 2000);
}

/**
 * La fecha de la operación. Devuelve `{ iso, explicita }`.
 * Si no la encuentra usa hoy y lo dice: una fecha inventada que se presenta como leída es
 * la clase de mentira que descuadra un ciclo entero.
 */
export function fechaDelAviso(texto, hoy = hoyISO()) {
  const iso = texto.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const f = fechaValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (f) return { iso: f, explicita: true };
  }

  const conLetra = texto.match(/\b(\d{1,2})\s*(?:de\s+)?[\/\- ]?\s*([a-záéíóú]{3,10})\.?\s*(?:de\s+)?[\/\- ]?\s*(\d{2,4})?\b/i);
  if (conLetra) {
    const mes = MESES_ES[conLetra[2].slice(0, 3).toLowerCase()];
    if (mes) {
      const anio = conLetra[3] ? anioCompleto(conLetra[3], hoy) : Number(hoy.slice(0, 4));
      const f = fechaValida(anio, mes, Number(conLetra[1]));
      if (f) return { iso: f, explicita: true };
    }
  }

  // En México el orden es día/mes/año. Asumir el orden gringo movería gastos de mes.
  const numerica = texto.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (numerica) {
    const f = fechaValida(anioCompleto(numerica[3], hoy), Number(numerica[2]), Number(numerica[1]));
    if (f) return { iso: f, explicita: true };
  }

  return { iso: hoy, explicita: false };
}

/** Los últimos 4 de la tarjeta. Es lo único de la tarjeta que se guarda, nunca más. */
export function tarjetaDelAviso(texto) {
  const m = texto.match(/(?:\*{2,}|x{2,}|terminaci[óo]n(?:\s+en)?|terminada en|final)\s*[:\-]?\s*(\d{4})\b/i);
  return m ? m[1] : null;
}

const RUIDO_COMERCIO = /^(el|la|los|las|un|una|tu|su|de|del|en|por|con|monto|importe|cargo|compra|pago|fecha|hora|tarjeta|cuenta|total|mxn|pesos)$/i;

/** El comercio donde se gastó. Sale de las frases que todos los bancos comparten. */
export function comercioDelAviso(texto) {
  const nombrado = texto.match(/(?:comercio|establecimiento|negocio|beneficiario|destinatario|concepto)\s*[:\-]\s*([^\n|]{2,60})/i);
  if (nombrado) return recortarComercio(nombrado[1]);

  // El monto suele meterse entre "compra" y "en", así que hay que saltárselo. Y el nombre
  // termina donde empieza a hablarse de la tarjeta o de la fecha, no en el primer punto:
  // "EL PALACIO DE HIERRO" tiene preposiciones adentro y no hay que cortarlo a la mitad.
  // "compra ... en X", pero también "cargo domiciliado de X" — las suscripciones casi siempre
  // usan "de", y son justo las que alimentan la detección de recurrentes. Y no todo banco dice
  // "compra": hay quien encabeza con "movimiento" o "transacción".
  const conEn = texto.match(
    /(?:compra|cargo|pago|consumo|compraste|pagaste|movimiento|operaci[óo]n|transacci[óo]n|abono|dep[óo]sito)\b[^\n]{0,44}?\b(?:en|de)\s+((?![$\d]|MXN\b|M\.?N\.?\b)[^\n]{2,90}?)(?=\s+(?:con|usando|mediante|tu|su)\b|\s+el\s+\d|\s+a\s+las\b|\s+por\s+\$|[.,;|\n]|$)/i,
  );
  if (conEn) return recortarComercio(conEn[1]);

  return null;
}

function recortarComercio(crudo) {
  const limpio = String(crudo)
    .replace(/\s+/g, " ")
    .replace(/\s+(?:con|el|por|de)\s+(?:tu |su |la |el )?(?:tarjeta|cuenta|monto|importe|fecha|hora|folio|referencia)\b.*$/i, "")
    .replace(/[\s.,;:-]+$/, "")
    .trim();
  if (!limpio || RUIDO_COMERCIO.test(limpio)) return null;
  if (!/[a-záéíóúñ]{2}/i.test(limpio)) return null; // referencias y cifras sueltas no son un nombre
  return limpio.slice(0, 60);
}

/**
 * La forma comparable de un comercio: "OXXO GASOLINERA 4412 MEX" → "oxxo gasolinera".
 * Es la llave con la que la app aprende y con la que detecta suscripciones, así que
 * tiene que ser estable entre un cargo y el siguiente del mismo lugar.
 */
export function normalizarComercio(nombre) {
  return String(nombre || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    // Los sufijos legales se quitan ENTEROS y con su puntuación. Si se rompen antes, "S.A.
    // de C.V." se convierte en letras sueltas que se cuelan en el nombre.
    .replace(/\bs\.?\s*a\.?\s*(?:p\.?\s*i\.?\s*)?(?:de\s*)?c\.?\s*v\.?/g, " ")
    .replace(/\bs\.?\s*de\s*r\.?\s*l\.?(?:\s*de\s*c\.?\s*v\.?)?/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b\d+\b/g, " ")                 // sucursales y referencias cambian, el nombre no
    .replace(/\b(de|del|la|el|mexico|mex|mx|suc|sucursal)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ").slice(0, 3).join(" ");
}

/**
 * La MARCA, más corta que el nombre normalizado: "starbucks reforma" → "starbucks".
 *
 * Existe porque las dos cosas se necesitan y son distintas:
 *   · para saber si dos avisos son el MISMO cargo hace falta precisión — ahí va el nombre
 *     completo, porque dos compras en sucursales distintas son dos compras;
 *   · para aprender una categoría hace falta lo contrario, generalizar — si corriges el
 *     Starbucks de Reforma, el de Polanco también es comida fuera.
 *
 * Se toma la primera palabra, y dos si la primera es muy corta ("wal mart", "la europea"):
 * una sola letra o sílaba no identifica a nadie.
 */
export function marcaDe(comercio) {
  const partes = normalizarComercio(comercio).split(" ").filter(Boolean);
  if (!partes.length) return "";
  return partes[0].length <= 3 && partes[1] ? `${partes[0]} ${partes[1]}` : partes[0];
}

/** Gasto o ingreso. Devuelve `{ tipo, explicito }`. */
export function tipoDelAviso(texto) {
  const ingreso = PISTAS_INGRESO.test(texto);
  const gasto = PISTAS_GASTO.test(texto);
  if (ingreso && !gasto) return { tipo: TIPOS.INGRESO, explicito: true };
  if (gasto && !ingreso) return { tipo: TIPOS.GASTO, explicito: true };
  // Ambas o ninguna: la mayoría de los avisos son cobros, pero eso es una suposición.
  return { tipo: TIPOS.GASTO, explicito: false };
}

/**
 * La huella: qué hace que dos avisos sean el MISMO movimiento.
 * Los bancos mandan dos correos por una compra (la autorización y el cargo). Sin esto, cada
 * compra se contaría dos veces y la app mentiría hacia arriba, que es la peor dirección.
 */
export function huellaDe({ banco, fecha, monto, ultimos4, comercio }) {
  return [banco || "?", fecha || "?", monto == null ? "?" : monto, ultimos4 || "?", normalizarComercio(comercio)]
    .join("|");
}

/**
 * Lee un aviso. Nunca lanza: un texto basura devuelve SIN_DATOS_SUFICIENTES con qué falta.
 */
export function interpretar(entrada, remitente = "", hoy = hoyISO()) {
  const texto = limpiarAviso(entrada);
  const banco = bancoDeRemitente(remitente) || bancoDeRemitente(texto.slice(0, 200));

  if (!texto) {
    return sinLectura(sinDatos("No hay texto que leer.", "pega el aviso del banco"), banco);
  }

  const { centavos, seguro, varios } = montoDelAviso(texto);
  if (centavos === null) {
    const motivo = montoDelAviso(texto).soloAjenos
      ? "Esto parece un aviso de saldo o una promoción, no un movimiento."
      : "No encontré un monto en este texto.";
    const falta = montoDelAviso(texto).soloAjenos
      ? "si sí fue un cargo, captúralo con el botón +"
      : "revisa que el aviso traiga el importe con $ o MXN";
    return sinLectura(sinDatos(motivo, falta), banco);
  }

  const { iso, explicita } = fechaDelAviso(texto, hoy);
  const comercio = comercioDelAviso(texto);
  const ultimos4 = tarjetaDelAviso(texto);
  const { tipo, explicito } = tipoDelAviso(texto);
  const traspaso = PISTAS_TRASPASO.test(texto);

  const razones = [];
  const lejos = Math.abs(diasEntre(hoy, iso));
  if (lejos > DIAS_RAZONABLES) {
    razones.push(`la fecha que leí (${iso}) queda a ${lejos} días de hoy — revísala antes de aceptar`);
  }
  if (varios) razones.push("el correo traía más de un cargo y solo leí el primero");
  if (!seguro) razones.push("el monto no venía etiquetado");
  if (!explicita) razones.push("no traía fecha, usé la de hoy");
  if (!explicito) razones.push("no decía si era cargo o abono, lo tomé como gasto");
  if (!comercio) razones.push("no identifiqué el comercio");

  // ALTA significa exactamente una cosa: no quedó nada que revisar. Antes bastaban tres de
  // cuatro señales, así que un aviso sin comercio —o con una fecha absurda— se anunciaba como
  // "lo leí completo" mientras su propio motivo decía "revísalo". Prometer certeza donde
  // faltó un dato es peor que admitir la duda.
  const señales = [seguro, explicita, explicito, Boolean(comercio)].filter(Boolean).length;
  const confianza =
    banco && !razones.length && señales === 4 ? CONFIANZAS.ALTA
      : señales >= 2 ? CONFIANZAS.MEDIA
        : CONFIANZAS.BAJA;

  return {
    movimiento: {
      fecha: iso,
      monto: Math.abs(centavos),
      tipo,
      categoria: tipo === TIPOS.GASTO ? "otros" : null,
      nota: comercio || (banco ? banco.nombre : ""),
      metodo: ultimos4 ? `••${ultimos4}` : null,
    },
    banco: banco ? banco.id : null,
    comercio,
    ultimos4,
    confianza,
    posibleTraspaso: traspaso,
    huella: huellaDe({ banco: banco ? banco.id : null, fecha: iso, monto: Math.abs(centavos), ultimos4, comercio }),
    veredicto: veredicto(
      confianza === CONFIANZAS.ALTA ? ESTADOS.VA_BIEN : ESTADOS.AJUSTADO,
      confianza === CONFIANZAS.ALTA ? SEVERIDADES.OK : SEVERIDADES.INFO,
      razones.length ? `Revísalo: ${razones.join("; ")}.` : "Lo leí completo.",
      { confianza, razones },
    ),
  };
}

function sinLectura(v, banco) {
  return {
    movimiento: null,
    banco: banco ? banco.id : null,
    comercio: null,
    ultimos4: null,
    confianza: CONFIANZAS.BAJA,
    posibleTraspaso: false,
    huella: null,
    veredicto: v,
  };
}

/**
 * ¿Ya conocía esto? Mira la bandeja (misma huella) y lo ya registrado (mismo monto y
 * comercio en ±1 día). Devuelve un veredicto que la pantalla puede mostrar, o null.
 */
export function posibleDuplicado(datos, lectura) {
  if (!lectura || !lectura.movimiento || !lectura.huella) return null;

  const enBandeja = (datos.bandeja || []).some((e) => e.huella === lectura.huella && e.estado !== "descartado");
  if (enBandeja) {
    return veredicto(ESTADOS.AJUSTADO, SEVERIDADES.MEDIA, "Este mismo aviso ya está en la bandeja.", {
      motivo: "huella",
    });
  }

  const clave = normalizarComercio(lectura.comercio);
  const { fecha, monto } = lectura.movimiento;
  const desde = sumarDias(fecha, -1);
  const hasta = sumarDias(fecha, 1);

  for (const mes of new Set([desde.slice(0, 7), fecha.slice(0, 7), hasta.slice(0, 7)])) {
    for (const m of datos.movimientos[mes] || []) {
      if (m.monto !== monto || Math.abs(diasEntre(m.fecha, fecha)) > 1) continue;
      if (clave && normalizarComercio(m.nota) !== clave) continue;
      return veredicto(ESTADOS.AJUSTADO, SEVERIDADES.MEDIA,
        "Ya tienes un movimiento igual por estos días. ¿Es el mismo cargo?", { motivo: "parecido", id: m.id });
    }
  }
  return null;
}
