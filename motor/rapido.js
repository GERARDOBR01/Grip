// Captura rápida — lo que nunca va a llegar por correo.
//
// En México la mitad del gasto no deja rastro digital: los tacos, el OXXO de la esquina, el
// camión, las propinas, la señora de la fruta. El puente no lo va a ver nunca, y si eso no
// entra, los números mienten hacia abajo y la app pierde la autoridad que la hace útil —que
// es la otra forma de morirse, más lenta que perder datos pero igual de definitiva.
//
// La respuesta no es un catálogo de montos inventado por mí. Es SU historial: la gente que
// gasta en efectivo repite cantidades, y esas cantidades son distintas para cada quien. Si
// todavía no hay historial, aquí no se propone nada y aparece el botón de siempre: inventarle
// un "$50 · comida" a alguien que nunca ha gastado eso es la misma clase de mentira que un
// cero disfrazado de dato.

import { TIPOS } from "./modelo.js";
import { hoyISO, sumarDias, comparar } from "./ciclo.js";

/** Cuánto hacia atrás se mira. Lo de hace medio año ya no dice cómo gastas hoy. */
const DIAS_DE_HISTORIA = 90;

/** Cuántas veces tiene que repetirse un monto para que valga la pena ofrecerlo. */
const REPETICIONES_MINIMAS = 2;

/**
 * Los montos que más repite, con la categoría que más les pone.
 *
 * Devuelve `[]` cuando no hay de dónde sacarlos, que es una respuesta válida y no un vacío
 * que haya que rellenar.
 */
export function montosFrecuentes(datos, iso = hoyISO(), cuantos = 3) {
  const desde = sumarDias(iso, -DIAS_DE_HISTORIA);

  const cuenta = new Map();
  for (const lista of Object.values(datos.movimientos || {})) {
    for (const m of lista) {
      if (m.tipo !== TIPOS.GASTO) continue;
      if (comparar(m.fecha, desde) < 0) continue;
      // Los movimientos que nacieron de un fijo no son captura rápida: ya se pagan solos.
      if (m.fijoId) continue;

      const previo = cuenta.get(m.monto) || { monto: m.monto, veces: 0, categorias: new Map(), ultima: "" };
      previo.veces++;
      previo.categorias.set(m.categoria, (previo.categorias.get(m.categoria) || 0) + 1);
      if (comparar(m.fecha, previo.ultima) > 0) previo.ultima = m.fecha;
      cuenta.set(m.monto, previo);
    }
  }

  return [...cuenta.values()]
    .filter((c) => c.veces >= REPETICIONES_MINIMAS)
    // Más repetido primero; a igual repetición, lo más reciente, que es lo que sigue vigente.
    .sort((a, b) => b.veces - a.veces || comparar(b.ultima, a.ultima))
    .slice(0, cuantos)
    .map((c) => ({
      monto: c.monto,
      veces: c.veces,
      categoriaId: categoriaDominante(c.categorias),
    }));
}

function categoriaDominante(categorias) {
  let mejor = null;
  let masVeces = 0;
  for (const [categoriaId, veces] of categorias) {
    if (categoriaId && veces > masVeces) {
      mejor = categoriaId;
      masVeces = veces;
    }
  }
  return mejor;
}

/**
 * La categoría que le tocaría a un gasto de este monto, según lo que ha hecho antes.
 * `null` cuando no hay con qué decidirlo — y entonces se pregunta, no se adivina.
 */
export function categoriaProbable(datos, centavos, iso = hoyISO()) {
  const encontrado = montosFrecuentes(datos, iso, 20).find((f) => f.monto === centavos);
  return encontrado ? encontrado.categoriaId : null;
}
