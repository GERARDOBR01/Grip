// Aprendizaje — que no tengas que decirle dos veces lo mismo.
//
// Es la diferencia entre las apps que la gente abandona y las que no. La más respetada del
// mundo (YNAB) obliga a categorizar cada movimiento a mano, siempre, incluso los importados;
// hay quien la deja a las tres semanas por eso. Las buenas aprenden de tus correcciones.
//
// Aquí "aprender" no es nada misterioso ni hace falta que lo sea: si corriges OXXO a Súper,
// se guarda una regla, y el siguiente cargo de OXXO ya llega con Súper puesto. Determinista,
// inspeccionable y borrable — que es justo lo que se le pide a algo que toca tu dinero.
//
// Además, antes de que exista una sola regla, ya puede sugerir mirando lo que tú mismo
// capturaste a mano: si tus tres últimos cargos de OXXO fueron Súper, ese es el dato.

import { marcaDe } from "./lectura.js";
import { normalizarRegla, canonizarPalabra, ACCIONES_REGLA, PALABRA_MINIMA, TIPOS } from "./modelo.js";
import { hoyISO } from "./ciclo.js";
import { veredicto, ESTADOS, SEVERIDADES } from "./veredicto.js";

/** Cuántos movimientos pasados hay que ver para sugerir sin una regla explícita. */
const MINIMO_PARA_DEDUCIR = 2;

/** La categoría que la persona usó más para este comercio, según su propio historial. */
export function categoriaMasUsada(datos, clave) {
  if (!clave) return null;
  const cuenta = new Map();
  for (const lista of Object.values(datos.movimientos || {})) {
    for (const m of lista) {
      if (!m.categoria || marcaDe(m.nota) !== clave) continue;
      cuenta.set(m.categoria, (cuenta.get(m.categoria) || 0) + 1);
    }
  }
  let mejor = null;
  for (const [categoria, veces] of cuenta) {
    if (!mejor || veces > mejor.veces) mejor = { categoria, veces };
  }
  return mejor && mejor.veces >= MINIMO_PARA_DEDUCIR ? mejor : null;
}

// ── Qué regla le toca ──────────────────────────────────────────────────────
//
// Dos formas de coincidir:
//   1. Por clave: la marca del comercio es exactamente la clave de la regla. Es lo que aprende
//      la app sola.
//   2. Por palabra: el comercio CONTIENE una de las palabras de la regla, al inicio de una de
//      sus palabras. "oxxo" atrapa "OXXO 1234 MTY" y "OXXO GASOLINERA"; "uber" atrapa "UBER
//      EATS" pero no "SUPERBIA".
//
// Si varias atrapan el mismo cargo, gana la que dijo MÁS: el texto más largo. "oxxo gas" le
// gana a "oxxo" en la gasolinera y "oxxo" se queda con el resto de las tiendas. Ante empate
// gana la clave —lo que corregiste a mano sobre ese comercio exacto— y después la primera
// por nombre. Nunca al azar.

/** El texto del comercio tal como se compara: la misma forma que una palabra de regla, completo. */
function comparableParaReglas(comercio) {
  return String(comercio || "")
    .slice(0, 280)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿El texto contiene esta palabra, empezando donde empieza una de las suyas? */
function contienePalabra(texto, palabra) {
  return palabra.length >= PALABRA_MINIMA && ` ${texto}`.includes(` ${palabra}`);
}

/**
 * La regla que manda sobre este comercio, o null.
 * Devuelve `{ regla, por: "clave" | "palabra", palabra }` para poder decir de dónde salió.
 */
export function reglaPara(datos, comercio) {
  const reglas = datos.reglas || [];
  const clave = marcaDe(comercio);
  const exacta = clave ? reglas.find((r) => r.clave === clave) : null;
  let mejor = exacta ? { regla: exacta, por: "clave", palabra: null, largo: clave.length } : null;

  const texto = comparableParaReglas(comercio);
  if (!texto) return mejor && { regla: mejor.regla, por: mejor.por, palabra: mejor.palabra };
  for (const regla of reglas) {
    for (const palabra of regla.palabras || []) {
      if (!contienePalabra(texto, palabra)) continue;
      const gana = !mejor ||
        palabra.length > mejor.largo ||
        (palabra.length === mejor.largo && mejor.por === "palabra" && regla.clave < mejor.regla.clave);
      if (gana) mejor = { regla, por: "palabra", palabra, largo: palabra.length };
    }
  }
  return mejor && { regla: mejor.regla, por: mejor.por, palabra: mejor.palabra };
}

/**
 * Qué hacer con un aviso de este comercio. Devuelve `{ accion, categoriaId, tarjetaId,
 * veredicto }` o null. Primero lo que la persona dijo, después lo que la persona hizo. Nunca
 * inventa.
 */
export function sugerirParaAviso(datos, comercio) {
  const encontrada = reglaPara(datos, comercio);
  if (encontrada) {
    const { regla, por, palabra } = encontrada;
    const porQue = por === "palabra" ? `Dice «${palabra}», y tu regla «${regla.clave}»` : "Ya me habías dicho que";
    if (regla.accion === ACCIONES_REGLA.PAGO) {
      const tarjeta = (datos.tarjetas || []).find((t) => t.id === regla.tarjetaId);
      return {
        accion: ACCIONES_REGLA.PAGO,
        categoriaId: null,
        tarjetaId: regla.tarjetaId,
        veredicto: veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK,
          `${por === "palabra" ? `${porQue} dice que es` : "Ya me habías dicho que esto es"} un pago${tarjeta ? ` a ${tarjeta.nombre}` : " de tarjeta"}, no un gasto.`,
          { clave: regla.clave, palabra, fuente: "regla" }),
      };
    }
    return {
      accion: ACCIONES_REGLA.CATEGORIA,
      categoriaId: regla.categoriaId,
      tarjetaId: null,
      veredicto: veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK,
        por === "palabra" ? `${porQue} lo manda a esta categoría.` : `Ya me habías dicho que ${comercio} va aquí.`,
        { clave: regla.clave, palabra, veces: regla.veces, fuente: "regla" }),
    };
  }

  const clave = marcaDe(comercio);
  const deducida = categoriaMasUsada(datos, clave);
  if (deducida) {
    return {
      accion: ACCIONES_REGLA.CATEGORIA,
      categoriaId: deducida.categoria,
      tarjetaId: null,
      veredicto: veredicto(ESTADOS.AJUSTADO, SEVERIDADES.INFO,
        `Tus últimos ${deducida.veces} movimientos de ${comercio} fueron de esta categoría.`,
        { clave, veces: deducida.veces, fuente: "historial" }),
    };
  }

  return null;
}

/**
 * Qué categoría le toca a este comercio. Devuelve `{ categoriaId, veredicto }` o null.
 * Una regla de pago no da categoría: lo que dice es que esto no es un gasto.
 */
export function sugerirCategoria(datos, comercio) {
  const sugerida = sugerirParaAviso(datos, comercio);
  if (!sugerida || sugerida.accion !== ACCIONES_REGLA.CATEGORIA) return null;
  return { categoriaId: sugerida.categoriaId, veredicto: sugerida.veredicto };
}

/**
 * Guarda la corrección. Devuelve datos nuevos; no muta lo recibido.
 * Si la regla ya existía con otra categoría, gana la última: la persona cambió de opinión y
 * la app no está para discutir con ella.
 *
 * Si una regla de palabras ya mandaba este comercio a la misma categoría, no nace otra: se le
 * suma una vez a esa. Si lo mandaba a OTRA, sí nace una regla propia para este comercio — es
 * más específica, y por eso gana sin tocar la de palabras, que sigue sirviendo para el resto.
 */
export function recordar(datos, comercio, categoriaId, iso = hoyISO()) {
  const clave = marcaDe(comercio);
  if (!clave || !categoriaId) return datos;

  const previas = datos.reglas || [];
  const anterior = previas.find((r) => r.clave === clave);

  if (!anterior) {
    const porPalabra = reglaPara(datos, comercio);
    if (porPalabra && porPalabra.regla.accion === ACCIONES_REGLA.CATEGORIA && porPalabra.regla.categoriaId === categoriaId) {
      const regla = porPalabra.regla;
      return {
        ...datos,
        reglas: previas.map((r) => (r.clave === regla.clave ? { ...r, veces: r.veces + 1, ultima: iso } : r)),
      };
    }
  }

  const nueva = normalizarRegla({
    clave,
    categoriaId,
    palabras: anterior ? anterior.palabras : [],
    veces: anterior && anterior.categoriaId === categoriaId ? anterior.veces + 1 : 1,
    ultima: iso,
  });

  return { ...datos, reglas: [nueva, ...previas.filter((r) => r.clave !== clave)] };
}

/** Las palabras que escribió la persona, separadas por coma, punto y coma o renglón. */
export function partirPalabras(texto) {
  const lista = Array.isArray(texto) ? texto : String(texto || "").split(/[,;\n]+/);
  return lista.map((p) => String(p).trim()).filter(Boolean);
}

/**
 * Crea o edita una regla escrita por la persona. Devuelve `{ datos, regla, error }`.
 *
 * `propuesta` = `{ clave, palabras, accion, categoriaId, tarjetaId }`. Con `claveOriginal` se
 * edita la que ya estaba (su nombre no cambia: es su identidad, y la que aprendió la app sola
 * es la marca del comercio).
 *
 * Una palabra no puede estar en dos reglas. Si pudiera, el mismo cargo tendría dos dueños y
 * cuál gana dependería de un desempate que nadie ve. Wallet hace lo mismo, y por la misma razón.
 *
 * Si la palabra es el comercio de una regla APRENDIDA (sin palabras propias), esa regla se
 * absorbe: la persona acaba de decir explícitamente qué hacer con ese comercio, y eso es más
 * nuevo y más claro que una corrección de hace semanas. Se devuelven en `absorbidas` para
 * poder decirlo. Si la otra también la escribió ella, no se pisa: se le pregunta.
 */
export function guardarRegla(datos, propuesta, claveOriginal = null, iso = hoyISO()) {
  const falla = (error) => ({ datos, regla: null, absorbidas: [], error });
  const previas = datos.reglas || [];
  const original = claveOriginal ? previas.find((r) => r.clave === claveOriginal) : null;
  if (claveOriginal && !original) return falla("Esa regla ya no existe.");

  const clave = original ? original.clave : String((propuesta && propuesta.clave) || "").trim().slice(0, 60);
  if (!clave) return falla("Ponle un nombre a la regla.");
  const otras = previas.filter((r) => r.clave !== clave);
  if (!original && previas.some((r) => r.clave.toLowerCase() === clave.toLowerCase())) {
    return falla(`Ya hay una regla que se llama «${clave}».`);
  }

  const escritas = partirPalabras(propuesta.palabras);
  const palabras = [];
  const absorbidas = [];
  for (const escrita of escritas) {
    const palabra = canonizarPalabra(escrita);
    if (palabra.length < PALABRA_MINIMA) {
      return falla(`«${escrita}» es muy corta: usa al menos ${PALABRA_MINIMA} letras, o atraparía de todo.`);
    }
    if (palabras.includes(palabra)) continue;
    const duena = otras.find((r) => (r.palabras || []).includes(palabra));
    if (duena) return falla(`«${escrita}» ya está en la regla «${duena.clave}». Una palabra solo puede tener un dueño.`);
    const propia = otras.find((r) => r.clave === palabra);
    if (propia && propia.palabras.length) {
      return falla(`«${escrita}» es el nombre de tu regla «${propia.clave}». Agrégale ahí la palabra, o usa otra.`);
    }
    if (propia) absorbidas.push(propia.clave);
    palabras.push(palabra);
  }
  if (!palabras.length && !original) return falla("Escribe al menos una palabra que aparezca en el aviso.");

  const accion = propuesta.accion === ACCIONES_REGLA.PAGO ? ACCIONES_REGLA.PAGO : ACCIONES_REGLA.CATEGORIA;
  if (accion === ACCIONES_REGLA.CATEGORIA && !(datos.categorias || []).some((c) => c.id === propuesta.categoriaId)) {
    return falla("Elige a qué categoría manda la regla.");
  }
  if (accion === ACCIONES_REGLA.PAGO && !(datos.tarjetas || []).some((t) => t.id === propuesta.tarjetaId)) {
    return falla("Elige qué tarjeta se está pagando.");
  }

  const regla = normalizarRegla({
    clave,
    accion,
    categoriaId: propuesta.categoriaId,
    tarjetaId: propuesta.tarjetaId,
    palabras,
    veces: original ? original.veces : 1,
    ultima: iso,
  });
  const quedan = otras.filter((r) => !absorbidas.includes(r.clave));
  return { datos: { ...datos, reglas: [regla, ...quedan] }, regla, absorbidas, error: null };
}

/** Borrar una regla tiene que ser tan fácil como crearla. */
export function olvidar(datos, clave) {
  return { ...datos, reglas: (datos.reglas || []).filter((r) => r.clave !== clave) };
}

/** Lo aprendido, para poder mirarlo y corregirlo en Ajustes. */
export function reglasAprendidas(datos) {
  return [...(datos.reglas || [])].sort((a, b) => b.veces - a.veces || (a.clave < b.clave ? -1 : 1));
}

// ── Hacia atrás ────────────────────────────────────────────────────────────
//
// Aprender hacia adelante deja media promesa cumplida. Corriges OXXO a Súper y el siguiente
// cargo ya llega bien, pero los veinte de antes se quedan en «Otros» y el presupuesto sigue
// mintiendo hasta que los tocas uno por uno — que es exactamente el trabajo que la app dijo
// que te iba a quitar.
//
// Lo que NO hace: aplicarse sola. Esto reescribe historial, y una app que cambia tus números
// pasados sin decírtelo pierde la autoridad que la hace útil. Se ofrece, con el número por
// delante, y decides tú.

/**
 * Los movimientos pasados de este comercio que la regla cambiaría, del más nuevo al más viejo.
 * Los que ya están en esa categoría no salen: no hay nada que hacerles.
 */
export function movimientosDeLaMarca(datos, clave, categoriaId = null) {
  if (!clave) return [];
  const encontrados = [];
  for (const [mes, lista] of Object.entries(datos.movimientos || {})) {
    for (const m of lista) {
      if (marcaDe(m.nota) !== clave) continue;
      if (categoriaId && m.categoria === categoriaId) continue;
      encontrados.push({ ...m, mes });
    }
  }
  return encontrados.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

/**
 * Aplica la regla a lo ya capturado. Devuelve datos nuevos; no muta lo recibido.
 *
 * Solo toca la categoría. El monto, la fecha y la nota son lo que pasó, y eso no se corrige
 * desde aquí ni desde ningún otro lado que no seas tú escribiéndolo.
 */
export function aplicarRegla(datos, clave, categoriaId) {
  if (!clave || !categoriaId) return datos;

  const movimientos = {};
  let tocados = 0;
  for (const [mes, lista] of Object.entries(datos.movimientos || {})) {
    movimientos[mes] = lista.map((m) => {
      if (marcaDe(m.nota) !== clave || m.categoria === categoriaId) return m;
      tocados++;
      return { ...m, categoria: categoriaId };
    });
  }

  return tocados ? { ...datos, movimientos } : datos;
}

/** ¿Este movimiento ya está como la regla lo dejaría? */
function yaCumpleLaRegla(regla, m) {
  if (m.tipo !== TIPOS.GASTO) return true; // solo los gastos se tocan: ni ingresos ni lo ya pagado
  return regla.accion === ACCIONES_REGLA.CATEGORIA && m.categoria === regla.categoriaId;
}

/**
 * Los movimientos ya capturados que esta regla cambiaría, del más nuevo al más viejo.
 *
 * Un movimiento es de esta regla solo si es la que MANDA sobre él: si otra regla más específica
 * lo atrapa, aquí no sale. Así lo que se ofrece arreglar es exactamente lo que pasaría si ese
 * aviso llegara hoy.
 */
export function movimientosDeLaRegla(datos, clave) {
  const regla = (datos.reglas || []).find((r) => r.clave === clave);
  if (!regla) return [];
  const encontrados = [];
  for (const [mes, lista] of Object.entries(datos.movimientos || {})) {
    for (const m of lista) {
      if (yaCumpleLaRegla(regla, m)) continue;
      const manda = reglaPara(datos, m.nota);
      if (!manda || manda.regla.clave !== clave) continue;
      encontrados.push({ ...m, mes });
    }
  }
  return encontrados.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

/**
 * Aplica la regla a lo ya capturado — a todo, o solo a los `ids` que la persona eligió.
 * Devuelve datos nuevos; no muta lo recibido.
 *
 * Una regla de categoría solo cambia la categoría. Una de pago convierte el gasto en el pago
 * de esa tarjeta, que es lo que era desde el principio. El monto, la fecha y la nota no se
 * tocan: son lo que pasó.
 */
export function aplicarReglaA(datos, clave, ids = null) {
  const regla = (datos.reglas || []).find((r) => r.clave === clave);
  if (!regla) return datos;
  const elegidos = new Set(movimientosDeLaRegla(datos, clave)
    .map((m) => m.id)
    .filter((id) => !ids || ids.includes(id)));
  if (!elegidos.size) return datos;

  const movimientos = {};
  for (const [mes, lista] of Object.entries(datos.movimientos || {})) {
    movimientos[mes] = lista.map((m) => {
      if (!elegidos.has(m.id)) return m;
      return regla.accion === ACCIONES_REGLA.PAGO
        ? { ...m, tipo: TIPOS.PAGO, categoria: null, tarjetaId: regla.tarjetaId }
        : { ...m, categoria: regla.categoriaId };
    });
  }
  return { ...datos, movimientos };
}
