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
import { pendientes } from "./bandeja.js";
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
