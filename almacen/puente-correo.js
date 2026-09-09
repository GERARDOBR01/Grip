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
