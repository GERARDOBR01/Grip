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

export function esISO(iso) {
  return typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso);
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
  const transcurridos = dia - inicioDia + 1;

  return {
    inicio,
    fin,
    dias,
    diasTranscurridos: transcurridos,
    diasRestantes: finDia - dia + 1,
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
