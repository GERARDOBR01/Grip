// Ciclos — el calendario del dinero, no el del almanaque.
//
// El mes natural no sirve para decidir si hoy puedes gastar: lo que manda es cuánto falta
// para el próximo pago. Aquí el ciclo por defecto es quincenal (días 1–15 y 16–fin de mes),
// pero los días de corte son configurables: `cortes: []` da ciclos mensuales y `[10, 25]`
// da cualquier otro patrón de pago.
//
// Las fechas son cadenas "AAAA-MM-DD" en horario local. Nada de objetos Date en el modelo:
// una zona horaria mal aplicada mueve un gasto de quincena y descuadra todo el ciclo.

/** La fecha de hoy en horario local, como "AAAA-MM-DD". */
export function hoyISO(fecha = new Date()) {
  const a = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${a}-${m}-${d}`;
}

/** La hora del reloj del dispositivo, como "HH:MM". */
export function horaAhora(fecha = new Date()) {
  return `${String(fecha.getHours()).padStart(2, "0")}:${String(fecha.getMinutes()).padStart(2, "0")}`;
}

/**
 * ¿Es una fecha de verdad, en formato "AAAA-MM-DD"?
 *
 * Comprueba el CALENDARIO, no solo la forma. Antes solo miraba la forma, y por ahí entraban
 * `2026-02-31` y `9999-99-99` — de un JSON editado a mano, de un respaldo de otra app, de una
 * fecha mal leída en una captura. No se quedaban quietos: `cicloDe("2026-02-31")` devolvía
 * `diasRestantes: -2` sobre un ciclo de 13 días, y con eso "te queda por día" salía negativo;
 * y un movimiento fechado en el 9999 se sentaba para siempre en lo alto de todas las listas.
 *
 * Un dato que no se puede creer se rechaza en la puerta, no se cuela y se administra después.
 */
export function esISO(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [anio, mes, dia] = iso.split("-").map(Number);
  if (anio < 1900 || mes < 1 || mes > 12) return false;
  return dia >= 1 && dia <= diasEnMes(anio, mes);
}

export function partes(iso) {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return { anio, mes, dia };
}

export function armarISO(anio, mes, dia) {
  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function diasEnMes(anio, mes) {
  return new Date(anio, mes, 0).getDate();
}

/**
 * La hora del reloj como "HH:MM", o "" si no es una hora válida.
 * Se guarda a propósito sin segundos ni zona: lo que importa es si gastas a las 2 de la tarde
 * o a las 9 de la mañana, no el instante exacto.
 */
export function horaValida(texto) {
  const encontrada = String(texto || "").match(/^([01]\d|2[0-3]):([0-5]\d)/);
  return encontrada ? `${encontrada[1]}:${encontrada[2]}` : "";
}

/** Los minutos desde medianoche, para poder comparar horas restando. */
export function minutosDelDia(hora) {
  const limpia = horaValida(hora);
  if (!limpia) return null;
  return Number(limpia.slice(0, 2)) * 60 + Number(limpia.slice(3, 5));
}

/** 0 = domingo … 6 = sábado. El sábado no se gasta como el martes. */
export function diaDeSemana(iso) {
  const { anio, mes, dia } = partes(iso);
  return new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
}

/** "AAAA-MM" — la llave con la que se agrupan los movimientos. */
export function mesDe(iso) {
  return iso.slice(0, 7);
}

export function comparar(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function entre(iso, desde, hasta) {
  return iso >= desde && iso <= hasta;
}

export function sumarDias(iso, n) {
  const { anio, mes, dia } = partes(iso);
  const d = new Date(anio, mes - 1, dia + n);
  return hoyISO(d);
}

export function sumarMeses(iso, n) {
  const { anio, mes, dia } = partes(iso);
  const total = (anio * 12) + (mes - 1) + n;
  const nuevoAnio = Math.floor(total / 12);
  const nuevoMes = (total % 12) + 1;
  return armarISO(nuevoAnio, nuevoMes, Math.min(dia, diasEnMes(nuevoAnio, nuevoMes)));
}

/** Meses de diferencia entre dos "AAAA-MM" (b − a). */
export function mesesEntre(a, b) {
  const [anioA, mesA] = a.split("-").map(Number);
  const [anioB, mesB] = b.split("-").map(Number);
  return (anioB - anioA) * 12 + (mesB - mesA);
}

/** Días de diferencia entre dos fechas (b − a). */
export function diasEntre(a, b) {
  const pa = partes(a);
  const pb = partes(b);
  const ma = Date.UTC(pa.anio, pa.mes - 1, pa.dia);
  const mb = Date.UTC(pb.anio, pb.mes - 1, pb.dia);
  return Math.round((mb - ma) / 86400000);
}

/** Los cortes limpios: enteros 1..30, ordenados y sin repetidos. */
function cortesValidos(cortes) {
  const lista = Array.isArray(cortes) ? cortes : [15];
  return [...new Set(lista.filter((c) => Number.isInteger(c) && c >= 1 && c <= 30))].sort((a, b) => a - b);
}

/**
 * El ciclo al que pertenece una fecha.
 * Devuelve inicio, fin, cuántos días tiene, cuántos van y cuántos faltan (hoy incluido:
 * si hoy es el último día del ciclo, queda 1 día, no 0 — todavía puedes gastar hoy).
 */
export function cicloDe(iso, cortes = [15]) {
  const { anio, mes, dia } = partes(iso);
  const ultimo = diasEnMes(anio, mes);
  const limites = cortesValidos(cortes).filter((c) => c < ultimo);

  let inicioDia = 1;
  let finDia = ultimo;
  let indice = 0;

  for (let i = 0; i < limites.length; i++) {
    if (dia <= limites[i]) {
      finDia = limites[i];
      break;
    }
    inicioDia = limites[i] + 1;
    indice = i + 1;
  }

  const inicio = armarISO(anio, mes, inicioDia);
  const fin = armarISO(anio, mes, finDia);
  const dias = finDia - inicioDia + 1;

  // Cinturón además del tirante. `esISO` ya no deja pasar un 31 de febrero, pero `cicloDe`
  // también se llama con fechas armadas al vuelo, y de lo que sale de aquí se dividen los
  // números que la app enseña en grande. Un "te queda por día" negativo, o un ciclo donde van
  // más días de los que tiene, no es un número raro: es una resta que miente en pantalla.
  const transcurridos = Math.min(Math.max(dia - inicioDia + 1, 1), dias);

  return {
    inicio,
    fin,
    dias,
    diasTranscurridos: transcurridos,
    diasRestantes: Math.min(Math.max(finDia - dia + 1, 1), dias),
    indice,
    total: limites.length + 1,
    etiqueta: limites.length === 0 ? "mes" : `quincena ${indice + 1}`,
  };
}

/** El ciclo siguiente al de una fecha. */
export function cicloSiguiente(iso, cortes = [15]) {
  const actual = cicloDe(iso, cortes);
  return cicloDe(sumarDias(actual.fin, 1), cortes);
}

/**
 * Cuántos ciclos CIERRAN entre dos fechas, inclusive.
 * Es el número de oportunidades reales de apartar dinero antes de una fecha límite:
 * lo que divide el faltante de una meta.
 */
export function ciclosHasta(desdeISO, hastaISO, cortes = [15]) {
  if (hastaISO < desdeISO) return 0;

  let ciclo = cicloDe(desdeISO, cortes);
  let cuenta = 0;
  // Tope de seguridad: ~80 años de quincenas. Una fecha absurda no cuelga la app.
  for (let i = 0; i < 2000 && ciclo.fin <= hastaISO; i++) {
    cuenta += 1;
    ciclo = cicloDe(sumarDias(ciclo.fin, 1), cortes);
  }
  return cuenta;
}

/** La fecha del próximo día de pago (el fin del ciclo actual) y cuántos días faltan. */
export function proximoPago(iso, cortes = [15]) {
  const ciclo = cicloDe(iso, cortes);
  return { fecha: ciclo.fin, dias: diasEntre(iso, ciclo.fin) };
}

/**
 * La fecha de un vencimiento mensual dentro de un mes dado.
 * Un cargo el día 31 en febrero cae el 28: se recorre al último día, no se pierde.
 */
export function vencimientoEnMes(mes, diaCorte) {
  const [anio, m] = mes.split("-").map(Number);
  const ultimo = diasEnMes(anio, m);
  return armarISO(anio, m, Math.min(Math.max(diaCorte, 1), ultimo));
}
