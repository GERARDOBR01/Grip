// Adaptador del puente de correo — OPCIONAL Y BORRABLE.
//
// Igual que el adaptador del anfitrión: nadie lo importa. La app pregunta en tiempo de
// ejecución si estas funciones existen, y si no, no pasa nada — la bandeja se sigue llenando
// pegando o compartiendo. Borra este archivo, arma, y la app queda exactamente igual.
// Hay una prueba que falla si eso deja de ser cierto.
//
// Del otro lado vive puente/Codigo.gs, un script en la cuenta de Google de la persona.
//
// Detalle que decide el diseño: se manda POST con Content-Type "text/plain". Suena raro para
// algo que manda JSON, y es a propósito. Un POST con "application/json" es una petición que
// el navegador precede de un OPTIONS de permiso, y Apps Script no contesta OPTIONS: la
// llamada moriría siempre. Con "text/plain" es una petición simple, sin permiso previo, y
// pasa. El contenido sigue siendo JSON; lo que cambia es la etiqueta.

const CLAVE = "grip:puente";
// La bitácora va en su propia llave, aparte de la configuración: cambiar el token no debe
// borrar la memoria de hasta dónde se había leído.
const CLAVE_BITACORA = "grip:puente:ultima";
const ESPERA_MAXIMA = 15000;

/** localStorage puede LANZAR con solo tocarlo (iframes sin permiso). Nunca se accede pelón. */
function almacenLocal() {
  try {
    return globalThis.localStorage || null;
  } catch (e) {
    return null;
  }
}

/**
 * La configuración vive SOLO en este dispositivo, nunca en el documento de datos.
 * Si viviera con los movimientos, el token viajaría a donde viajen los datos — y una llave
 * que se sincroniza sola deja de ser una llave.
 */
export function configuracionDelPuente() {
  const almacen = almacenLocal();
  if (!almacen) return { url: "", token: "", disponible: false };
  try {
    const crudo = almacen.getItem(CLAVE);
    const guardado = crudo ? JSON.parse(crudo) : {};
    return { url: guardado.url || "", token: guardado.token || "", disponible: true };
  } catch (e) {
    return { url: "", token: "", disponible: true };
  }
}

export function guardarConfiguracionDelPuente({ url, token }) {
  const almacen = almacenLocal();
  if (!almacen) return false;
  try {
    if (!url && !token) almacen.removeItem(CLAVE);
    else almacen.setItem(CLAVE, JSON.stringify({ url: String(url || "").trim(), token: String(token || "").trim() }));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Cuándo se trajo por última vez y cómo fue: `{ dia, sello, error }` o null.
 *
 * `dia` es hasta dónde se leyó con ÉXITO —de ahí sale la ventana de la próxima traída—, y
 * `sello` es cuándo se intentó, con error o sin él, que es lo que decide si toca volver a
 * intentar. Son dos cosas distintas a propósito: si el puente lleva tres días caído, no hay
 * que reintentar cada minuto, pero cuando por fin conteste tiene que traer los tres días.
 */
export function ultimaTraida() {
  const almacen = almacenLocal();
  if (!almacen) return null;
  try {
    const crudo = almacen.getItem(CLAVE_BITACORA);
    if (!crudo) return null;
    const guardado = JSON.parse(crudo);
    return {
      dia: guardado.dia || "",
      sello: Number(guardado.sello) || 0,
      error: guardado.error || "",
    };
  } catch (e) {
    return null;
  }
}

/** Anota el intento. En un fallo, `dia` NO avanza: el hueco sigue pendiente de leerse. */
export function anotarTraida({ exito, dia = "", error = "" } = {}) {
  const almacen = almacenLocal();
  if (!almacen) return false;
  const previa = ultimaTraida();
  try {
    almacen.setItem(CLAVE_BITACORA, JSON.stringify({
      dia: exito ? dia : (previa ? previa.dia : ""),
      sello: Date.now(),
      error: exito ? "" : String(error || ""),
    }));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Pide al puente los avisos de los últimos días.
 * NUNCA lanza: devuelve `{ avisos, error }`. Que el correo no responda no puede tumbar la app.
 */
export async function traerAvisos({ url, token, dias = 3 } = {}) {
  if (!url || !token) return { avisos: [], error: "Falta la dirección del puente o el token." };

  const cancelador = typeof AbortController === "function" ? new AbortController() : null;
  const reloj = cancelador ? setTimeout(() => cancelador.abort(), ESPERA_MAXIMA) : null;

  try {
    const respuesta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // petición simple: sin OPTIONS previo
      body: JSON.stringify({ token, dias }),
      redirect: "follow", // Apps Script responde con un salto a googleusercontent
      signal: cancelador ? cancelador.signal : undefined,
    });

    if (!respuesta.ok) return { avisos: [], error: `El puente respondió ${respuesta.status}.` };

    const datos = await respuesta.json();
    if (datos.error) return { avisos: [], error: datos.error };
    if (!Array.isArray(datos.avisos)) return { avisos: [], error: "El puente respondió algo que no entiendo." };

    return { avisos: datos.avisos, error: null };
  } catch (e) {
    const motivo = e && e.name === "AbortError"
      ? "El puente tardó demasiado en responder."
      : "No se pudo hablar con el puente. Revisa la dirección y tu conexión.";
    return { avisos: [], error: motivo };
  } finally {
    if (reloj) clearTimeout(reloj);
  }
}

/**
 * Habla con el puente y traduce el fallo a algo accionable.
 *
 * Existe porque el puente vive en la cuenta de Google de la persona, no aquí, y cuando algo
 * falla el error de red no dice nada útil. Sin esto, "no se pudo hablar con el puente" deja a
 * cualquiera sin saber si le falta pegar la URL, si el token está mal, o si a Google se le
 * acabó el permiso. Un diagnóstico que no dice qué mover no sirve de nada.
 */
export async function probarPuente({ url, token } = {}) {
  if (!url) return { ok: false, motivo: "Falta la dirección. Es la que termina en /exec." };
  if (!/\/exec\s*$/.test(url)) {
    return {
      ok: false,
      motivo: "Esa dirección no termina en /exec. La que sirve es la de la IMPLEMENTACIÓN, " +
        "no la del editor del script.",
    };
  }
  if (!token) return { ok: false, motivo: "Falta el token: la frase que inventaste en el script." };

  const { avisos, error } = await traerAvisos({ url, token, dias: 1 });

  if (error) {
    if (/token/i.test(error)) {
      return { ok: false, motivo: "El puente contesta, pero rechaza el token. Tiene que ser IDÉNTICO al del script." };
    }
    if (/\b(401|403)\b/.test(error)) {
      return {
        ok: false,
        motivo: "Google no deja entrar. En la implementación, 'Quién tiene acceso' debe decir " +
          "Cualquier usuario, y 'Ejecutar como' debe decir Yo.",
      };
    }
    if (/\b404\b/.test(error)) {
      return { ok: false, motivo: "En esa dirección no hay nada. Si editaste el script, haz una implementación NUEVA: la URL cambia." };
    }
    if (/no entiendo/i.test(error)) {
      return { ok: false, motivo: "Contesta algo que no es JSON. Suele ser que Apps Script está pidiendo permisos: ábrela en el navegador y acéptalos." };
    }
    return { ok: false, motivo: error };
  }

  return {
    ok: true,
    motivo: avisos.length
      ? `El puente funciona: encontró ${avisos.length} ${avisos.length === 1 ? "aviso" : "avisos"} del último día.`
      : "El puente funciona. No encontró avisos del último día, que puede ser normal — revisa que REMITENTES tenga tus bancos.",
    avisos: avisos.length,
  };
}

/**
 * Le deja al puente el resumen para el correo diario. Son cuatro cifras, no los movimientos.
 *
 * Silencioso a propósito: esto ocurre al guardar, y que el correo diario no se actualice no
 * puede interrumpir a nadie ni ensuciar la pantalla. Si falla, el correo lo dirá por su cuenta
 * —va sellado con su fecha— y eso es mejor que una alerta que nadie pidió.
 */
export async function depositarResumen({ url, token, resumen } = {}) {
  if (!url || !token || !resumen) return false;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token, accion: "resumen", resumen }),
      redirect: "follow",
    });
    return true;
  } catch (e) {
    return false;
  }
}
