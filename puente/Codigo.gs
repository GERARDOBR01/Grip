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
 *   · No cubre a los bancos que solo avisan dentro de su app. Nu es el caso: sus
 *     notificaciones nunca llegan por correo. Para esos, comparte el aviso a la app.
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
 *
 * Para dejar de usarlo: Implementaciones → Archivar. O borra el proyecto. La app ni se entera.
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

  // Cualquier corrida de 6 dígitos o más se reduce a sus últimos 4. Tarjetas y cuentas
  // completas no tienen por qué salir de Gmail para que la app sepa cuánto gastaste.
  texto = texto.replace(/\d{6,}/g, function (n) { return "****" + n.slice(-4); });

  return texto.trim().slice(0, MAXIMO_CARACTERES);
}

function responder(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}
