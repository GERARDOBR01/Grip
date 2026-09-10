// Avisos del sistema — y lo que honestamente pueden y no pueden hacer.
//
// Hasta aquí la app no avisaba nada: si no la abrías, no te enterabas de que vencía la luz.
// Esto lo arregla a medias, y conviene decir cuál es la mitad.
//
// Lo que sí: mientras la app esté abierta o la abras, te avisa de lo que decide
// motor/recordatorios.js — un fijo que vence mañana, avisos que llevan días esperando. Y si
// la dejas abierta —en un celular es lo normal—, vuelve a mirar cada hora.
//
// Lo que NO, y no se va a fingir que sí: despertarse sola con la app cerrada. Un PWA no puede
// hacerlo de forma fiable. Periodic Background Sync no existe en iOS y en Chromium pide app
// instalada y uso frecuente; Notification Triggers nunca salió del experimento. Implementarlo
// significaría meter el almacén y el motor dentro del service worker para que a lo mejor
// funcione en un navegador de tres. **Con la app cerrada, el canal que de verdad llega es el
// correo diario del puente**, y eso es lo que dice Ajustes en vez de prometer de más.
//
// El permiso NO se pide al abrir. Se pide desde Ajustes, cuando la persona lo enciende. Pedirlo
// de entrada es la forma más rápida de que te lo nieguen para siempre.

const CLAVE_AVISOS = "grip:avisos";

/** Cuántos días se recuerda lo ya avisado. Más allá, la clave del día ya no se repite. */
const DIAS_DE_MEMORIA = 14;

/** Cada cuánto se vuelve a mirar mientras la app sigue abierta. */
const MINUTOS_ENTRE_REVISIONES = 60;

function almacenDeAvisos() {
  try {
    return globalThis.localStorage || null;
  } catch (e) {
    return null; // localStorage puede LANZAR con solo tocarlo. Nunca se accede pelón.
  }
}

function leerAjusteDeAvisos() {
  const almacen = almacenDeAvisos();
  if (!almacen) return { encendidos: false, mandados: {} };
  try {
    const crudo = almacen.getItem(CLAVE_AVISOS);
    const guardado = crudo ? JSON.parse(crudo) : {};
    return {
      encendidos: Boolean(guardado.encendidos),
      mandados: guardado.mandados && typeof guardado.mandados === "object" ? guardado.mandados : {},
    };
  } catch (e) {
    return { encendidos: false, mandados: {} };
  }
}

function escribirAjusteDeAvisos(ajuste) {
  const almacen = almacenDeAvisos();
  if (!almacen) return false;
  try {
    almacen.setItem(CLAVE_AVISOS, JSON.stringify(ajuste));
    return true;
  } catch (e) {
    return false;
  }
}

/** ¿Puede este navegador, y quiere esta persona? Las dos cosas, que no son la misma. */
export function estadoDeAvisos() {
  const soportados = typeof Notification !== "undefined";
  const permiso = soportados ? Notification.permission : "unsupported";
  return {
    soportados,
    permiso,
    encendidos: leerAjusteDeAvisos().encendidos && permiso === "granted",
    negados: permiso === "denied",
  };
}

/**
 * Enciende los avisos. Devuelve `{ ok, motivo }` — nunca lanza y nunca insiste.
 * Si el navegador ya los tiene bloqueados, se dice, porque desde aquí no hay forma de
 * desbloquearlos y fingir que se intentó sería peor.
 */
export async function encenderAvisos() {
  if (typeof Notification === "undefined") {
    return { ok: false, motivo: "Este navegador no sabe mandar avisos." };
  }
  if (Notification.permission === "denied") {
    return { ok: false, motivo: "Los tienes bloqueados para este sitio. Se cambia desde los ajustes del navegador." };
  }

  let permiso = Notification.permission;
  if (permiso !== "granted") {
    try {
      permiso = await Notification.requestPermission();
    } catch (e) {
      return { ok: false, motivo: "No se pudo pedir el permiso." };
    }
  }
  if (permiso !== "granted") return { ok: false, motivo: "Sin permiso no hay avisos, y así se queda." };

  escribirAjusteDeAvisos({ ...leerAjusteDeAvisos(), encendidos: true });
  return { ok: true, motivo: null };
}

/** Apagarlos tiene que ser tan fácil como encenderlos. No borra el permiso: deja de usarlo. */
export function apagarAvisos() {
  escribirAjusteDeAvisos({ ...leerAjusteDeAvisos(), encendidos: false });
}

/** Tira del registro lo que ya lleva semanas: esto no puede crecer para siempre. */
function podarMandados(mandados, iso) {
  const limite = new Date(`${iso}T00:00:00Z`).getTime() - DIAS_DE_MEMORIA * 86400000;
  const vivos = {};
  for (const [clave, dia] of Object.entries(mandados)) {
    const cuando = new Date(`${dia}T00:00:00Z`).getTime();
    if (Number.isFinite(cuando) && cuando >= limite) vivos[clave] = dia;
  }
  return vivos;
}

/**
 * El registro del service worker, o null.
 *
 * Los botones de la notificación SOLO existen a través del service worker: un `new
 * Notification()` suelto no los admite, porque nadie recogería el toque. Así que donde no haya
 * service worker —abierta desde el disco, por ejemplo— hay aviso pero no botones, y eso es una
 * caída limpia, no un error.
 */
async function registro() {
  try {
    if (!globalThis.navigator || !navigator.serviceWorker) return null;
    return await navigator.serviceWorker.ready;
  } catch (e) {
    return null;
  }
}

async function mostrarAviso(titulo, cuerpo) {
  const opciones = { body: cuerpo, icon: "./icono-192.png", badge: "./icono-192.png", tag: titulo };
  try {
    // Con service worker el aviso sobrevive a que cierres la pestaña; sin él —abierta desde el
    // disco, por ejemplo— se manda directo. Las dos formas pueden fallar y ninguna importa
    // tanto como para tumbar nada.
    if (globalThis.navigator && navigator.serviceWorker) {
      const registro = await navigator.serviceWorker.ready;
      if (registro && registro.showNotification) {
        await registro.showNotification(titulo, opciones);
        return true;
      }
    }
    new Notification(titulo, opciones);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Muestra lo que toque y no se haya mostrado ya. Devuelve cuántos mandó.
 *
 * `recordatorios` viene del motor: aquí no se decide qué es importante, solo se entrega.
 */
export async function avisarDe(recordatorios, iso) {
  const estado = estadoDeAvisos();
  if (!estado.encendidos || !recordatorios || !recordatorios.length) return 0;

  const ajuste = leerAjusteDeAvisos();
  const mandados = podarMandados(ajuste.mandados, iso);
  let mandé = 0;

  for (const r of recordatorios) {
    if (mandados[r.clave]) continue; // ya se dijo; repetirlo es exactamente cómo se apagan
    if (await mostrarAviso(r.titulo, r.cuerpo)) {
      mandados[r.clave] = iso;
      mandé++;
    }
  }

  escribirAjusteDeAvisos({ ...ajuste, mandados });
  return mandé;
}

/**
 * El globo sobre el ícono, con lo que espera en la bandeja.
 *
 * En Android la API no existe —el sistema pinta el globo solo cuando hay una notificación sin
 * leer—, en escritorio sí. Donde no exista, esto no hace nada y nadie se entera, que es
 * justo lo que se le pide a un adorno.
 */
export function ponerGlobo(cuantos) {
  try {
    if (!globalThis.navigator) return;
    if (cuantos > 0 && navigator.setAppBadge) navigator.setAppBadge(cuantos);
    else if (navigator.clearAppBadge) navigator.clearAppBadge();
  } catch (e) {
    // Un globo que no se pinta no es un problema de nadie.
  }
}

/** Cada cuánto conviene volver a mirar mientras la app siga abierta, en milisegundos. */
export const ESPERA_ENTRE_REVISIONES = MINUTOS_ENTRE_REVISIONES * 60000;

// ── La sombra como mesa de trabajo ─────────────────────────────────────────
//
// Lo que se publica aquí no es «te informo»: es «resuélvelo desde aquí». El service worker
// recoge el toque (lo genera herramientas/armar.mjs) y la app aplica la intención con el motor
// de siempre.

/**
 * Publica el aviso de una entrada de la bandeja, con su botón de aceptar cuando toca.
 *
 * El `tag` es el id de la entrada: publicar dos veces la misma no apila dos avisos, la
 * reemplaza. Sin eso, abrir la app tres veces dejaría tres avisos del mismo cargo.
 */
export async function avisarDeEntrada(aviso) {
  if (!aviso || !estadoDeAvisos().encendidos) return false;

  const registrado = await registro();
  if (!registrado || !registrado.showNotification) return false;

  const acciones = aviso.aceptable
    ? [{ action: "aceptar", title: "Aceptar" }, { action: "ver", title: "Ver" }]
    : [{ action: "ver", title: "Ver" }];

  try {
    await registrado.showNotification(aviso.titulo, {
      body: aviso.cuerpo,
      icon: "./icono-192.png",
      badge: "./icono-192.png",
      tag: aviso.clave,
      actions: acciones,
      data: { entradaId: aviso.entradaId, acuse: aviso.acuse },
    });
    return true;
  } catch (e) {
    return false;
  }
}

/** El tag de la barra: fijo, para que se reemplace a sí misma en vez de acumularse. */
const TAG_BARRA = "grip:barra";

/**
 * La barra que se queda en la sombra con tu número y un botón para anotar.
 *
 * Silenciosa a propósito: no vibra, no suena, no te llama. Está ahí para que la LEAS de reojo
 * entre las demás notificaciones, no para interrumpirte. Es la app sin abrir la app.
 */
export async function ponerBarra(barra) {
  if (!barra || !estadoDeAvisos().encendidos) return false;

  const registrado = await registro();
  if (!registrado || !registrado.showNotification) return false;

  try {
    await registrado.showNotification(barra.titulo, {
      body: barra.cuerpo,
      icon: "./icono-192.png",
      badge: "./icono-192.png",
      tag: TAG_BARRA,
      silent: true,
      renotify: false,
      requireInteraction: true, // que no se vaya sola: su gracia es quedarse
      actions: [
        // Donde el navegador ofrezca escribir en la sombra, se anota sin abrir nada. Donde no,
        // `type` se ignora y queda un botón normal que abre el teclado. Las dos cosas sirven.
        { action: "anotar", type: "text", title: "Anotar gasto", placeholder: "120 tacos" },
        { action: "abrir", title: "Abrir" },
      ],
      data: { entradaId: null, acuse: null },
    });
    return true;
  } catch (e) {
    return false;
  }
}

/** Quita la barra. Apagar los avisos tiene que quitarla de verdad, no solo dejar de moverla. */
export async function quitarBarra() {
  const registrado = await registro();
  if (!registrado || !registrado.getNotifications) return;
  try {
    for (const n of await registrado.getNotifications({ tag: TAG_BARRA })) n.close();
  } catch (e) {}
}
