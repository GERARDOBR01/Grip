// Captura rápida — lo que nunca va a llegar por correo.
//
// En México la mitad del gasto no deja rastro digital: los tacos, el OXXO de la esquina, el
// camión, las propinas, la señora de la fruta. Y no es media: Banxico dice que el 78% de la
// gente paga en efectivo la mayor parte de sus pagos, y el 76% de las compras de hasta $500.
// Si eso no entra, los números mienten hacia abajo y la app pierde la autoridad que la hace
// útil — que es la otra forma de morirse, más lenta que perder datos pero igual de definitiva.
//
// La respuesta no es un catálogo de montos inventado por mí. Es SU historial: la gente que
// gasta en efectivo repite cantidades, y esas cantidades son distintas para cada quien. Si
// todavía no hay historial, aquí no se propone nada y aparece el botón de siempre: inventarle
// un "$50 · comida" a alguien que nunca ha gastado eso es la misma clase de mentira que un
// cero disfrazado de dato.
//
// ── Lo que se adapta, y por qué así ──
//
// Antes esto exigía que se repitiera el monto EXACTO. Con eso, alguien que gasta $47, $48 y
// $50 en el mismo puesto de tacos no tenía sugerencias: para la app eran tres cosas distintas
// que pasaron una vez cada una. Ahora los montos parecidos cuentan juntos, pero **lo que se
// ofrece es siempre un monto que esa persona gastó de verdad**, nunca un promedio: un botón
// que mete $48 cuando nunca gastaste $48 es un dato inventado con otro nombre.
//
// Y pesa el contexto, porque nadie gasta igual a todas horas: lo reciente vale más que lo de
// hace tres meses, el sábado se parece al sábado, y las 2 de la tarde se parecen a las 2 de la
// tarde. Todo determinista y todo sacado de su propio historial — se puede explicar cada
// número sin apelar a ningún modelo.

import { TIPOS } from "./modelo.js";
import { hoyISO, sumarDias, comparar, diasEntre, diaDeSemana, minutosDelDia } from "./ciclo.js";

/** Cuánto hacia atrás se mira. Lo de hace medio año ya no dice cómo gastas hoy. */
const DIAS_DE_HISTORIA = 90;

/** Cuántas veces tiene que repetirse un hábito para que valga la pena ofrecerlo. */
const REPETICIONES_MINIMAS = 2;

/** A los 30 días un gasto pesa la mitad; a los 60, la cuarta parte. */
const SEMIVIDA_DIAS = 30;

/** Dos montos son el mismo hábito si se separan menos que esto. */
const HOLGURA_RELATIVA = 0.08; // 8%
const HOLGURA_MINIMA = 500; // …o $5, lo que sea más grande: en montos chicos el % no alcanza

/** Cuánto premia coincidir en el día de la semana y en la hora. */
const BONO_MISMO_DIA = 1.5;
const BONO_MISMA_HORA = 1.8;
const MINUTOS_CERCA = 120; // dos horas arriba o abajo siguen siendo "a esta hora"

function holguraDe(centavos) {
  return Math.max(Math.round(centavos * HOLGURA_RELATIVA), HOLGURA_MINIMA);
}

/** Lo reciente manda: peso 1 hoy, 0.5 a los 30 días, 0.25 a los 60. */
function recencia(dias) {
  return 0.5 ** (Math.max(dias, 0) / SEMIVIDA_DIAS);
}

/**
 * Cuánto se parece este gasto pasado al momento en que estamos ahora.
 * Sin hora capturada no hay bono ni castigo: se ignora, que es distinto de suponer.
 */
function afinidad(movimiento, iso, hora) {
  let peso = 1;

  if (diaDeSemana(movimiento.fecha) === diaDeSemana(iso)) peso *= BONO_MISMO_DIA;

  const entonces = minutosDelDia(movimiento.hora);
  const ahora = minutosDelDia(hora);
  if (entonces !== null && ahora !== null && Math.abs(entonces - ahora) <= MINUTOS_CERCA) {
    peso *= BONO_MISMA_HORA;
  }

  return peso;
}

/** Los gastos en efectivo de los últimos meses, que son la materia prima de todo esto. */
function gastosRecientes(datos, iso) {
  const desde = sumarDias(iso, -DIAS_DE_HISTORIA);
  const salida = [];

  for (const lista of Object.values(datos.movimientos || {})) {
    for (const m of lista) {
      if (m.tipo !== TIPOS.GASTO) continue;
      if (comparar(m.fecha, desde) < 0) continue;
      // Los movimientos que nacieron de un fijo no son captura rápida: ya se pagan solos.
      if (m.fijoId) continue;
      salida.push(m);
    }
  }
  return salida;
}

/** El valor que más se repite; a empate, el más reciente. Nunca un promedio. */
function representante(gastos) {
  const cuenta = new Map();
  for (const m of gastos) {
    const previo = cuenta.get(m.monto) || { veces: 0, ultima: "" };
    previo.veces++;
    if (comparar(m.fecha, previo.ultima) > 0) previo.ultima = m.fecha;
    cuenta.set(m.monto, previo);
  }

  let mejor = null;
  for (const [monto, datos] of cuenta) {
    if (!mejor || datos.veces > mejor.veces ||
        (datos.veces === mejor.veces && comparar(datos.ultima, mejor.ultima) > 0)) {
      mejor = { monto, veces: datos.veces, ultima: datos.ultima };
    }
  }
  return mejor;
}

function categoriaDominante(gastos) {
  const cuenta = new Map();
  for (const m of gastos) {
    if (m.categoria) cuenta.set(m.categoria, (cuenta.get(m.categoria) || 0) + 1);
  }

  let mejor = null;
  let masVeces = 0;
  for (const [categoriaId, veces] of cuenta) {
    if (veces > masVeces) {
      mejor = categoriaId;
      masVeces = veces;
    }
  }
  return mejor;
}

/**
 * Junta los gastos parecidos en un solo hábito.
 *
 * Se recorren de mayor a menor y cada uno cae en el primer grupo cuyo representante le queda
 * cerca. No es sofisticado y no falta que lo sea: los montos de efectivo de una persona son
 * unas cuantas cantidades repetidas, no una nube que haya que analizar.
 */
function agrupar(gastos) {
  const grupos = [];

  for (const m of [...gastos].sort((a, b) => b.monto - a.monto)) {
    const grupo = grupos.find((g) => Math.abs(g.centro - m.monto) <= holguraDe(g.centro));
    if (grupo) {
      grupo.gastos.push(m);
    } else {
      grupos.push({ centro: m.monto, gastos: [m] });
    }
  }
  return grupos;
}

/**
 * Los montos que conviene ofrecer AHORA, con la categoría que más les pone.
 *
 * Devuelve `[]` cuando no hay de dónde sacarlos, que es una respuesta válida y no un vacío que
 * haya que rellenar. `hora` es opcional: sin ella funciona igual, solo que sin ese contexto.
 */
export function montosFrecuentes(datos, iso = hoyISO(), cuantos = 3, hora = "") {
  const candidatos = [];

  for (const grupo of agrupar(gastosRecientes(datos, iso))) {
    if (grupo.gastos.length < REPETICIONES_MINIMAS) continue;

    const cabeza = representante(grupo.gastos);
    if (!cabeza) continue;

    let peso = 0;
    for (const m of grupo.gastos) {
      peso += recencia(diasEntre(m.fecha, iso)) * afinidad(m, iso, hora);
    }

    candidatos.push({
      monto: cabeza.monto,
      veces: grupo.gastos.length,
      categoriaId: categoriaDominante(grupo.gastos),
      peso,
      ultima: grupo.gastos.reduce((v, m) => (comparar(m.fecha, v) > 0 ? m.fecha : v), ""),
    });
  }

  return candidatos
    .sort((a, b) => b.peso - a.peso || comparar(b.ultima, a.ultima))
    .slice(0, cuantos)
    .map(({ monto, veces, categoriaId }) => ({ monto, veces, categoriaId }));
}

/**
 * La categoría que le tocaría a un gasto de este monto, según lo que ha hecho antes.
 * `null` cuando no hay con qué decidirlo — y entonces se pregunta, no se adivina.
 */
export function categoriaProbable(datos, centavos, iso = hoyISO()) {
  const grupo = agrupar(gastosRecientes(datos, iso))
    .find((g) => Math.abs(g.centro - centavos) <= holguraDe(g.centro));
  return grupo ? categoriaDominante(grupo.gastos) : null;
}
