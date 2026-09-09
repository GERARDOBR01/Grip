// Campos — la estructura que comparten todos los avisos, en una tabla en vez de en código.
//
// Investigando por qué se rompen los lectores de avisos bancarios sale siempre la misma
// respuesta: se escriben POR BANCO. Cada banco su rama, cada rama su mantenimiento, y el día
// que uno cambia la plantilla —sin avisar, porque nadie avisa— esa rama deja de servir.
//
// Pero sí hay estructura general, y son dos capas distintas:
//
//   1. Las TRANSFERENCIAS tienen norma formal. El CEP del Banco de México fija los campos de
//      toda operación SPEI: fecha y hora, monto, clave de rastreo, banco emisor, banco
//      receptor, ordenante, beneficiario, concepto y referencia numérica. Por eso Santander
//      escribe "ABONO VÍA SPEI" y Nu manda destinatario, entidad y clave: los dos están
//      contando lo mismo con otras palabras.
//
//   2. Las COMPRAS con tarjeta no tienen norma, pero convergen. Las redes de autorización
//      empujan siempre lo mismo: monto y moneda, comercio, fecha y hora, últimos cuatro,
//      tipo de operación y folio de autorización.
//
// En las dos capas, lo que cambia de un banco a otro son las ETIQUETAS, no los campos. Así
// que esto es una tabla de campo × sinónimos, y los bancos dejan de ser un requisito para ser
// una pista. Agregar un banco es agregar renglones aquí, no escribir código — que es lo que
// convierte cada comprobante que llegue en cobertura permanente.

/** Escapa un sinónimo para meterlo en una expresión regular sin sorpresas. */
function literal(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Los campos, con sus sinónimos reales y qué forma tiene su valor.
 *
 * `exigeDosPuntos` separa dos clases de etiqueta, y la diferencia ya costó un error medido:
 * las inequívocas ("Establecimiento") pueden venir sin dos puntos porque el banco las manda en
 * una celda y el valor en la de al lado; las genéricas ("Nombre") los EXIGEN, porque si no, el
 * nombre del titular de la cuenta se lee como si fuera el comercio.
 */
export const CAMPOS = {
  // La llave de oro. Identifica una operación SPEI de forma única y es LA MISMA vista desde
  // el banco que manda y el que recibe. Con esto, dos avisos de una transferencia dejan de
  // ser dos movimientos sin tener que adivinar por monto y fecha.
  claveRastreo: {
    etiquetas: ["clave de rastreo", "clave rastreo", "clave de seguimiento", "clave de referencia", "tracking key"],
    valor: /[A-Za-z0-9]{6,30}/,
    exigeDigito: true,
    exigeDosPuntos: false,
  },

  // El folio de autorización. Suele viajar igual entre la preautorización y el cargo final,
  // que es justo el par que hoy se cuenta dos veces cuando el monto cambia.
  folio: {
    etiquetas: [
      "folio de autorizaci", "n[úu]mero de autorizaci", "clave de autorizaci", "c[óo]digo de autorizaci",
      "autorizaci[óo]n", "folio",
    ],
    valor: /\d{4,12}/,
    exigeDosPuntos: false,
  },

  // La referencia numérica NO sirve para identificar: dos operaciones distintas pueden
  // llevar la misma. Se lee para poder enseñarla, nunca para decidir si algo está repetido.
  referencia: {
    etiquetas: ["referencia num", "n[úu]mero de referencia", "referencia"],
    valor: /\d{1,20}/,
    exigeDosPuntos: true,
  },

  hora: {
    etiquetas: ["hora", "hora de operaci", "hora de la operaci"],
    valor: /\d{1,2}:\d{2}(?::\d{2})?/,
    exigeDosPuntos: false,
  },

  // Con quién fue la operación. Es el comercio en una compra y la persona o el banco en una
  // transferencia — el mismo hueco del CEP, con distintos nombres según quién lo llene.
  contraparte: {
    // Inequívocas: pueden venir sin dos puntos, en la celda de al lado.
    etiquetas: ["comercio", "establecimiento", "negocio", "beneficiario", "destinatario", "banco\\s+emisor"],
    // Genéricas: exigen dos puntos o se comen el nombre del titular.
    etiquetasDebiles: ["concepto(?:\\s+de\\s+pago)?", "entidad", "nombre", "ordenante"],
    exigeDosPuntos: false,
  },
};

/**
 * Busca un campo por sus etiquetas. Devuelve el valor crudo o `null`.
 *
 * Todos los cuantificadores van con tope. Sin RE2 —y este proyecto no tiene dependencias— la
 * defensa contra una entrada patológica es disciplina más medición, y hay una prueba que
 * falla si leer un texto adversario tarda de más.
 */
export function valorEtiquetado(texto, nombreCampo) {
  const campo = CAMPOS[nombreCampo];
  if (!campo || !campo.valor) return null;

  const separador = campo.exigeDosPuntos ? "\\s*[:\\-]\\s*" : "\\s*[:\\-]?\\s*\\n?\\s*";
  const etiquetas = campo.etiquetas.map((e) => (/[\\[\]().*+?]/.test(e) ? e : literal(e))).join("|");
  const patron = new RegExp(`(?:${etiquetas})${separador}(${campo.valor.source})`, "i");

  const encontrado = texto.match(patron);
  if (!encontrado) return null;

  const valor = encontrado[1];
  // Una clave de rastreo sin un solo dígito es una palabra que quedó pegada a la etiqueta.
  if (campo.exigeDigito && !/\d/.test(valor)) return null;
  return valor;
}

/**
 * Todas las etiquetas de contraparte, como las arma el lector.
 *
 * Vive aquí, con las demás, para que sumar un banco sea sumar sinónimos a la tabla. La lógica
 * de qué se hace con lo encontrado se queda en lectura.js, donde está medida.
 */
export function patronContraparte() {
  const fuertes = CAMPOS.contraparte.etiquetas.join("|");
  const debiles = CAMPOS.contraparte.etiquetasDebiles.join("|");
  return new RegExp(
    `(?:(?:${fuertes})\\s*[:\\-]?\\s*\\n?\\s*|(?:${debiles})\\s*[:\\-]\\s*)([^\\n|]{2,90})`,
    "gi",
  );
}
