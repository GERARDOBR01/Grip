/**
 * Grip — puente de correo.
 *
 * Esto NO es parte de la app. Es un script que vive en TU cuenta de Google, lo despliegas tú,
 * y lo borras cuando quieras. La app funciona igual sin él: sirve para no teclear.
 *
 * Qué hace: cuando la app se lo pide, busca en tu Gmail los avisos de los bancos de tu lista,
 * los limpia y devuelve el texto. Nada más. No guarda nada, no manda nada, no tiene memoria.
 *
 * Qué NO hace, y conviene saberlo antes de instalarlo:
 *   · No lee tu correo entero. Solo lo que empata con REMITENTES y con los días que se piden.
 *   · No devuelve el correo completo: corta el texto y tapa cualquier número largo dejando
 *     los últimos 4. Un número de tarjeta no sale de Gmail ni por accidente.
 *   · No cubre lo que el banco no manda por correo. Nu, por ejemplo, SÍ manda correo de las
 *     transferencias que envías —con monto, fecha, destinatario y clave de rastreo—, pero no
 *     de las compras con tarjeta: eso vive solo en su app. Para lo que no llegue, comparte el
 *     aviso a Grip desde el celular.
 *
 * ── Cómo instalarlo (10 minutos, una sola vez) ──
 *  1. Entra a script.google.com → Nuevo proyecto. Pega este archivo completo.
 *  2. Cambia TOKEN por una frase larga que inventes tú. Es la única llave del puente.
 *  3. Ajusta REMITENTES a tus bancos.
 *  4. Implementar → Nueva implementación → tipo "Aplicación web".
 *       Ejecutar como: Yo.   Quién tiene acceso: Cualquier usuario.
 *     ("Cualquier usuario" es necesario para que la app pueda llamarlo sin iniciar sesión;
 *      lo que protege el puente es el TOKEN, y la dirección es imposible de adivinar.)
 *  5. Copia la URL que termina en /exec y pégala en la app, en Ajustes, junto con tu token.
 *  6. Para el correo diario: en el editor elige la función `instalar` y dale a Ejecutar, una
 *     vez. Te pedirá permiso —es tu propio script pidiéndote leer tu correo y mandarte un
 *     mensaje— y deja el activador diario puesto. No hay que configurar nada a mano.
 *
 * Para dejar de usarlo: corre `desinstalar` y archiva la implementación. O borra el proyecto.
 * La app ni se entera.
 */

// ── Lo que tienes que cambiar ──────────────────────────────────────────────

var TOKEN = "cambia-esto-por-una-frase-larga-que-solo-tu-sepas";

// Solo se busca en el correo de estos remitentes. Entre menos, mejor.
var REMITENTES = [
  "notificaciones@banorte.com",
  "@mercadopago.com.mx",
  "@santander.com.mx",
];

// ── De aquí para abajo no hace falta tocar nada ────────────────────────────

var MAXIMO_CORREOS = 40;
var MAXIMO_CARACTERES = 1200;

function doPost(e) {
  var peticion = {};
  try {
    peticion = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (error) {
    return responder({ error: "La petición no es JSON." });
  }
  return atender(peticion);
}

// Existe para que puedas probarlo pegando la URL en el navegador con ?token=...
function doGet(e) {
  return atender((e && e.parameter) || {});
}

function atender(peticion) {
  if (peticion.token !== TOKEN) {
    return responder({ error: "Token incorrecto." });
  }

  // Guardar el resumen que manda la app. Son cuatro cifras, no tus movimientos.
  if (peticion.accion === "resumen") {
    return guardarResumen(peticion.resumen);
  }

  var dias = Math.min(Math.max(parseInt(peticion.dias, 10) || 3, 1), 30);
  var consulta = "(" + REMITENTES.map(function (r) { return "from:" + r; }).join(" OR ") + ")"
    + " newer_than:" + dias + "d";

  var avisos = [];
  var hilos = GmailApp.search(consulta, 0, MAXIMO_CORREOS);

  for (var i = 0; i < hilos.length; i++) {
    var mensajes = hilos[i].getMessages();
    for (var j = 0; j < mensajes.length; j++) {
      var mensaje = mensajes[j];
      avisos.push({
        remitente: mensaje.getFrom(),
        asunto: limpiar(mensaje.getSubject()),
        fecha: Utilities.formatDate(mensaje.getDate(), "America/Mexico_City", "yyyy-MM-dd"),
        texto: limpiar(mensaje.getPlainBody() || mensaje.getBody()),
      });
    }
  }

  return responder({ avisos: avisos, consultados: avisos.length, dias: dias });
}

/**
 * Deja el correo en texto plano, corto y sin números largos.
 * El tapado va ANTES del corte a propósito: si se cortara primero, un número podría quedar
 * partido justo donde nadie lo revisa.
 */
function limpiar(crudo) {
  var texto = String(crudo || "")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n");

  // Los identificadores de la OPERACIÓN se apartan antes de tapar nada: la clave de rastreo
  // del SPEI y el folio de autorización son lo que le permite a la app saber que dos avisos
  // son el mismo movimiento —y que una preautorización de $100 y su cargo real de $43 son una
  // compra, no dos—. Sin esto, el tapado de abajo se los comía y la app volvía a adivinar por
  // monto y fecha. No son números de tarjeta ni de cuenta: no abren nada.
  var apartados = [];
  texto = texto.replace(
    /((?:clave de rastreo|clave de seguimiento|folio de autorizaci[oó]n|n[uú]mero de autorizaci[oó]n|clave de autorizaci[oó]n|autorizaci[oó]n|folio)\s*[:\-]?\s*)([A-Za-z0-9]{4,30})/gi,
    function (todo, etiqueta, valor) {
      apartados.push(valor);
      return etiqueta + "\u0001" + (apartados.length - 1) + "\u0001";
    });

  // Cualquier corrida de 6 dígitos o más se reduce a sus últimos 4. Tarjetas y cuentas
  // completas no tienen por qué salir de Gmail para que la app sepa cuánto gastaste.
  texto = texto.replace(/\d{6,}/g, function (n) { return "****" + n.slice(-4); });

  // Y se devuelven a su sitio. Las marcas llevan uno o dos dígitos, así que el tapado de
  // arriba no las toca.
  texto = texto.replace(/\u0001(\d+)\u0001/g, function (todo, indice) { return apartados[Number(indice)]; });

  return texto.trim().slice(0, MAXIMO_CARACTERES);
}

// ── El resumen diario ──────────────────────────────────────────────────────
//
// Alguien sin tiempo no abre la app. Así que la app tiene que llegarle a él, y la única vía
// que no obliga a levantar un servidor es ésta: un correo que TÚ te mandas desde TU cuenta.
//
// Hay un problema honesto que resolver: este script NO conoce tus números. Viven en tu
// navegador. Lo que hace es guardar el último resumen que la app le dejó —disponible, por
// día, cierre proyectado— y mandarlo con SU FECHA. Si tiene días de viejo, el correo lo dice
// en vez de presentarlo como si fuera de hoy. Un número viejo disfrazado de actual es peor
// que no mandar nada.
//
// ── Para encenderlo (2 minutos) ──
//  1. En el editor, arriba, elige la función "enviarResumenDiario" y dale Ejecutar una vez.
//     Te va a pedir permiso para mandarte correo: es a ti mismo.
//  2. Reloj (Activadores) → Añadir activador.
//       Función: enviarResumenDiario.  Origen: Según tiempo.  Tipo: Temporizador diario.
//       Hora: la que quieras, por ejemplo 8am-9am.
//  Para apagarlo: borra el activador. Nada más.

var LLAVE_RESUMEN = "grip_resumen";

/** Cuántos días puede tener el resumen antes de que el correo avise que está viejo. */
var DIAS_ANTES_DE_AVISAR = 3;

function guardarResumen(resumen) {
  if (!resumen || typeof resumen !== "object") {
    return responder({ error: "No venía el resumen." });
  }
  PropertiesService.getUserProperties().setProperty(LLAVE_RESUMEN, JSON.stringify({
    disponible: resumen.disponible,
    porDia: resumen.porDia,
    cierre: resumen.cierre,
    finDeCiclo: resumen.finDeCiclo,
    pendientes: resumen.pendientes,
    guardado: Utilities.formatDate(new Date(), "America/Mexico_City", "yyyy-MM-dd"),
  }));
  return responder({ ok: true });
}

function enviarResumenDiario() {
  var crudo = PropertiesService.getUserProperties().getProperty(LLAVE_RESUMEN);
  if (!crudo) return; // la app todavía no ha dejado nada: no hay nada que contar

  var resumen = JSON.parse(crudo);
  var hoy = Utilities.formatDate(new Date(), "America/Mexico_City", "yyyy-MM-dd");
  var dias = Math.round((new Date(hoy) - new Date(resumen.guardado)) / 86400000);

  var lineas = [];
  if (dias > DIAS_ANTES_DE_AVISAR) {
    // Lo primero y en su propia línea: estos números son viejos.
    lineas.push("Ojo: estos números son del " + resumen.guardado + ". Abre Grip para ponerlos al día.");
    lineas.push("");
  }

  lineas.push("Te quedan " + pesos(resumen.disponible) + " para esta quincena.");
  if (resumen.porDia !== null && resumen.porDia !== undefined) {
    lineas.push("Son " + pesos(resumen.porDia) + " por día hasta el " + resumen.finDeCiclo + ".");
  }
  if (resumen.cierre !== null && resumen.cierre !== undefined) {
    lineas.push("Al ritmo que llevas, cierras en " + pesos(resumen.cierre) + ".");
  }
  if (resumen.pendientes) {
    lineas.push("");
    lineas.push(resumen.pendientes + " avisos esperan tu confirmación.");
  }

  MailApp.sendEmail(
    Session.getActiveUser().getEmail(),
    "Grip · " + pesos(resumen.disponible) + " para esta quincena",
    lineas.join("\n"),
  );
}

/** Centavos a pesos, para el correo. */
function pesos(centavos) {
  if (centavos === null || centavos === undefined) return "—";
  var signo = centavos < 0 ? "-" : "";
  var entero = Math.floor(Math.abs(centavos) / 100);
  var resto = String(Math.abs(centavos) % 100);
  if (resto.length < 2) resto = "0" + resto;
  return signo + "$" + entero.toLocaleString("en-US") + "." + resto;
}

function responder(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Encender y apagar el correo diario ─────────────────────────────────────
//
// Esto existe para que instalar el puente no incluya un paso de "ahora ve a Activadores y
// configura un temporizador diario". Ese paso se saltaba, y entonces el correo diario no
// llegaba nunca sin que nada lo dijera.

/** La hora a la que llega el correo diario. Cámbiala si te acomoda otra. */
var HORA_DEL_RESUMEN = 8;

/**
 * Deja el activador diario puesto. Correr esto dos veces no deja dos activadores: primero
 * quita los que ya había. Un correo duplicado cada mañana es de las cosas que hacen que la
 * gente apague todo.
 */
function instalar() {
  desinstalar();
  ScriptApp.newTrigger("enviarResumenDiario")
    .timeBased()
    .atHour(HORA_DEL_RESUMEN)
    .everyDays(1)
    .inTimezone("America/Mexico_City")
    .create();
  Logger.log("Listo: el resumen diario sale a las " + HORA_DEL_RESUMEN + ":00, hora de la Ciudad de México.");
}

/** Quita los activadores de este script. No borra nada más: ni el despliegue ni tu correo. */
function desinstalar() {
  var activadores = ScriptApp.getProjectTriggers();
  for (var i = 0; i < activadores.length; i++) {
    if (activadores[i].getHandlerFunction() === "enviarResumenDiario") {
      ScriptApp.deleteTrigger(activadores[i]);
    }
  }
  Logger.log("Activadores del resumen diario: quitados.");
}
