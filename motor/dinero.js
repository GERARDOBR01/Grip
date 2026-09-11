// Dinero — todo monto vive como entero de centavos.
//
// Regla dura: en el modelo NUNCA hay coma flotante. 0.1 + 0.2 no es 0.3, y una app de
// finanzas que arrastra ese error termina mintiendo por unos centavos cada mes. Los
// montos entran, se guardan y se calculan como enteros; el punto decimal solo existe
// al momento de escribirlo en la pantalla.

/** Centavos que tiene un peso. */
export const CENTAVOS = 100;

/**
 * El techo de un monto: cien mil millones de pesos, en centavos.
 *
 * No es un límite de producto, es la frontera de la aritmética. Arriba de 2^53 centavos los
 * enteros de JavaScript dejan de ser exactos y empiezan a redondearse solos — o sea, justo el
 * error de coma flotante que la regla de centavos enteros existe para no tener. Un número así
 * no llega de nadie llevando su gasto: llega de un JSON editado a mano, de un respaldo de otra
 * app o de un OCR que leyó de más. Se rechaza con `null`, que en este motor quiere decir "no
 * hay dato", y no es lo mismo que cero.
 *
 * El tope está muy por debajo del límite exacto a propósito: deja margen para SUMAR miles de
 * montos sin acercarse siquiera. Lo que se guarda tiene que aguantar la aritmética de después,
 * no solo la de entrar.
 */
export const MONTO_MAXIMO = 100_000_000_000 * CENTAVOS;

/** ¿Este entero de centavos es un monto con el que se puede hacer cuentas exactas? */
export function montoUtilizable(centavos) {
  return Number.isFinite(centavos) && Math.abs(centavos) <= MONTO_MAXIMO;
}

/**
 * Convierte lo que escribió una persona a centavos enteros.
 * Acepta "1,234.50", "$1234.5", "1234", 1234.5. Devuelve null si no es un monto —
 * null significa "no hay dato", que no es lo mismo que cero.
 */
export function aCentavos(entrada) {
  if (typeof entrada === "number") {
    if (!Number.isFinite(entrada)) return null;
    const centavos = Math.round(entrada * CENTAVOS);
    return montoUtilizable(centavos) ? centavos : null;
  }
  if (typeof entrada !== "string") return null;

  const limpio = entrada.trim().replace(/[$\s]/g, "").replace(/,/g, "");
  if (!/\d/.test(limpio)) return null;
  if (!/^-?\d*(\.\d*)?$/.test(limpio)) return null;

  const negativo = limpio.startsWith("-");
  const [enteros, decimales = ""] = limpio.replace("-", "").split(".");
  const tres = (decimales + "000").slice(0, 3);

  let centavos = Number(enteros || "0") * CENTAVOS + Number(tres.slice(0, 2));
  if (Number(tres[2]) >= 5) centavos += 1;
  if (!montoUtilizable(centavos)) return null;

  return negativo ? -centavos : centavos;
}

/**
 * Escribe un monto para una persona: 123456 → "$1,234.56".
 * Formateo propio y no `Intl`, para que el resultado sea idéntico en el celular, en la
 * PC y en las pruebas, sin depender del idioma del dispositivo.
 */
export function formatear(centavos, opciones = {}) {
  const valor = Number.isFinite(centavos) ? Math.trunc(centavos) : 0;
  const absoluto = Math.abs(valor);
  const enteros = String(Math.floor(absoluto / CENTAVOS)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimales = String(absoluto % CENTAVOS).padStart(2, "0");

  const signo = valor < 0 ? "−" : opciones.signo && valor > 0 ? "+" : "";
  return `${signo}$${enteros}.${decimales}`;
}

/** Igual que `formatear` pero sin centavos, para los números grandes de los paneles. */
export function formatearCorto(centavos) {
  const valor = Number.isFinite(centavos) ? Math.round(centavos / CENTAVOS) : 0;
  const enteros = String(Math.abs(valor)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${valor < 0 ? "−" : ""}$${enteros}`;
}

/**
 * Reparte centavos en `partes` montos enteros que suman EXACTAMENTE el total.
 * Los centavos sobrantes van a las primeras partes: repartir(1000, 3) → [334, 333, 333].
 */
export function repartir(centavos, partes) {
  if (!Number.isInteger(partes) || partes <= 0) return [];
  const total = Math.trunc(centavos);
  const base = Math.trunc(total / partes);
  const resto = Math.abs(total) % partes;
  const paso = total < 0 ? -1 : 1;

  return Array.from({ length: partes }, (_, i) => base + (i < resto ? paso : 0));
}

/**
 * Prorrateo entero: qué parte de `centavos` corresponde a `numerador/denominador`.
 * Se usa para bajar un monto mensual al ciclo quincenal sin perder centavos.
 */
export function prorratear(centavos, numerador, denominador) {
  if (!denominador) return 0;
  return Math.round((Math.trunc(centavos) * numerador) / denominador);
}

/** Porcentaje entero de `parte` sobre `total`. Sin total no hay porcentaje: null. */
export function porcentaje(parte, total) {
  if (!total || total <= 0) return null;
  return Math.round((parte * 100) / total);
}

/**
 * Plural de verdad, no «día(s)».
 *
 * Vive aquí, en el motor, porque los motivos de los veredictos se escriben en el motor: son
 * frases que va a leer una persona, no códigos. Y «5 categoría(s) sin tope» es de esas cosas
 * pequeñas que delatan que lo escribió un programa y no alguien que quería que se entendiera.
 */
export function plural(cuantos, singular, muchos) {
  return `${cuantos} ${cuantos === 1 ? singular : muchos}`;
}
