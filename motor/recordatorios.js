// Recordatorios — lo poco que merece interrumpirte.
//
// La app no avisaba nada: si no la abrías, no te enterabas de que vencía la luz. Rocket Money
// y Fintonic ganaron por esto, no por calcular mejor. Pero el mismo mecanismo es el que hace
// que la gente apague las notificaciones a los tres días y no las vuelva a encender nunca, así
// que aquí la pregunta no es "qué podríamos avisar" sino "qué justifica un golpe en la pantalla
// de alguien que no nos invitó".
//
// La respuesta son dos cosas, y las dos tienen algo que hacer al respecto:
//
//   · Un pago fijo que vence mañana o que ya se pasó. Llegar tarde cuesta dinero de verdad, y
//     es lo único aquí que un recordatorio evita.
//   · Avisos que llevan días esperando confirmación, cuando ya son varios. Uno de ayer no es
//     una urgencia; seis de la semana pasada son cuentas que ya no reflejan tu quincena.
//
// Lo que NO avisa, aunque se podría: que vas gastando de más. Eso está en la pantalla de Hoy y
// no cambia por saberlo a las nueve de la noche — sería alarmar sin ofrecer nada que hacer.
//
// Cada recordatorio trae una `clave` estable: es lo que permite no repetir el mismo dos veces.

import { proximosVencimientos } from "./fijos.js";
import { pendientes, sinNadaQueRevisar } from "./bandeja.js";
import { TIPOS, ESTADOS_BANDEJA, categoriaPorId } from "./modelo.js";
import { hoyISO, diasEntre } from "./ciclo.js";
import { formatear } from "./dinero.js";

/** Cuántos avisos sin confirmar hacen falta para que valga la pena decirlo. */
const AVISOS_PARA_MOLESTAR = 3;

/** Y cuántos días tiene que llevar esperando el más viejo. Lo de ayer no es una urgencia. */
const DIAS_ESPERANDO = 2;

/**
 * Qué habría que recordarle hoy a esta persona. `[]` es la respuesta más común y está bien.
 *
 * No sabe nada de navegadores ni de permisos: devuelve texto. Quién lo enseña —una
 * notificación, el correo diario, o nadie— es cosa de quien llame.
 */
export function recordatoriosDeHoy(datos, iso = hoyISO()) {
  const salida = [];

  // Solo lo de mañana o lo ya vencido. Un fijo que vence en diez días no es un recordatorio,
  // es una lista, y la lista ya está en la pantalla de Fijos.
  for (const v of proximosVencimientos(datos, iso, 1)) {
    salida.push({
      clave: `fijo:${v.fijo.id}:${v.mes}`,
      titulo: v.vencido
        ? `${v.fijo.nombre} se pasó de fecha`
        : v.dias === 0
          ? `Hoy vence ${v.fijo.nombre}`
          : `Mañana vence ${v.fijo.nombre}`,
      cuerpo: `${formatear(v.monto)}${v.vencido ? ` · venció el ${v.fecha}` : ""}`,
    });
  }

  const espera = pendientes(datos);
  if (espera.length >= AVISOS_PARA_MOLESTAR) {
    const masViejo = espera.reduce(
      (viejo, e) => (!viejo || e.recibido < viejo ? e.recibido : viejo),
      null,
    );
    if (masViejo && diasEntre(masViejo, iso) >= DIAS_ESPERANDO) {
      salida.push({
        // La clave lleva el día: si mañana siguen ahí, se vuelve a decir. Una vez al día.
        clave: `bandeja:${iso}`,
        titulo: `${espera.length} avisos esperan tu confirmación`,
        cuerpo: "Mientras no los aceptes, no cuentan en tus números.",
      });
    }
  }

  return salida;
}

// ── La notificación como mesa de trabajo ───────────────────────────────────
//
// Aquí está la jugada del proyecto, y no es leer la notificación del banco —eso ninguna app
// web puede hacerlo, y de todos modos la mitad de esas notificaciones ni traen el monto: «Nu ·
// Retiraste dinero de tu Cajita» y ya. La jugada es que la notificación de GRIP sea donde
// resuelves tu dinero, sin abrir nada.
//
// Aceptar un cargo hoy cuesta cinco pasos: desbloquear, abrir, ir a Bandeja, buscarlo, Aceptar.
// Con un botón en la sombra es uno. Esto decide qué dice ese aviso y —lo que más importa— si
// lleva botón de aceptar o no.

/** El texto que ve alguien que NO va a abrir la app. Devuelve null si no hay nada que decir. */
export function avisoDeEntrada(datos, entrada) {
  if (!entrada || entrada.estado !== ESTADOS_BANDEJA.PENDIENTE) return null;

  const quien = entrada.comercio || (entrada.movimiento && entrada.movimiento.nota) || "Un movimiento";
  const clave = `entrada:${entrada.id}`;

  // Sin monto no hay nada que aceptar de un toque: lo que falta lo pones tú, mirando.
  if (!entrada.movimiento || !entrada.movimiento.monto) {
    return {
      clave, entradaId: entrada.id, aceptable: false,
      titulo: "Llegó un aviso que no supe leer",
      cuerpo: `${quien} · dime cuánto y dónde`,
      acuse: null,
    };
  }

  const signo = entrada.movimiento.tipo === TIPOS.GASTO ? "−" : "+";
  const cifra = `${signo}${formatear(entrada.movimiento.monto)}`;
  const categoria = categoriaPorId(datos, entrada.movimiento.categoria);
  const aceptable = sinNadaQueRevisar(entrada);

  // El motivo va en el cuerpo cuando NO se puede aceptar de un toque. Un botón ausente sin
  // explicación se lee como un error de la app; con el motivo, se lee como cuidado.
  const porQueNo = entrada.posibleTraspaso
    ? "parece movimiento entre tus cuentas"
    : entrada.reemplaza
      ? "puede ser el cargo final de uno que ya tienes"
      : "tuve que suponer algo";

  return {
    clave,
    entradaId: entrada.id,
    aceptable,
    titulo: `${quien} · ${cifra}`,
    cuerpo: aceptable
      ? [categoria ? categoria.nombre : null, "de tu correo"].filter(Boolean).join(" · ")
      : `Ábrelo: ${porQueNo}`,
    acuse: aceptable ? `Aceptado · ${quien} ${cifra}` : null,
  };
}

/**
 * La línea que se queda en la sombra: tu dinero, sin abrir la app.
 *
 * Va sellada con su fecha por la misma razón que el correo diario: si llevas dos días sin
 * abrir, estos números son de hace dos días y decirlo cuesta una línea. Presentarlos como si
 * fueran de ahora sería mentir en la pantalla de bloqueo, que es peor que no decir nada.
 */
export function barraDeHoy(panel, iso = hoyISO()) {
  if (!panel) return null;

  // El sello va SIEMPRE, no solo cuando el número es viejo. El texto de una notificación se
  // congela cuando se publica: nadie puede volver a redactarlo cuando tú lo lees, tres días
  // después. Así que o lleva su fecha desde el principio, o miente en la pantalla de bloqueo
  // el día que no abras la app. Es la misma regla del correo diario.
  const sello = `al ${iso}`;

  if (panel.disponible === null) {
    return { titulo: "Grip", cuerpo: `Anota un gasto en dos segundos · ${sello}` };
  }

  return {
    titulo: `Te quedan ${formatear(panel.disponible)}`,
    cuerpo: panel.porDia === null
      ? `Hasta el ${panel.ciclo.fin} · ${sello}`
      : `${formatear(panel.porDia)} por día hasta el ${panel.ciclo.fin} · ${sello}`,
  };
}
