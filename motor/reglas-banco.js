// Reglas por banco — lo que convierte "entendí algo" en "entendí bien".
//
// El lector (lectura.js) funciona SIN esta tabla: saca monto, fecha y comercio de cualquier
// texto. Esta tabla solo sube la confianza cuando reconoce de quién viene el aviso y qué
// palabras usa ese banco para decir "te cobré" o "te depositaron".
//
// Los remitentes son públicos y verificables. Los patrones del cuerpo se quedan cortos a
// propósito: escribir una expresión regular para un correo que nunca vi es inventar. Cada
// banco se afina cuando llega un correo real suyo, tapado, y con su prueba al lado.
//
// IMPORTANTE, y no es un detalle técnico: no todos los bancos avisan de todo por correo, y
// decir de más aquí es venderle a alguien una automatización que no existe. Cada banco declara
// QUÉ avisa, no solo si avisa — porque "manda correos" y "manda correo por cada compra" son
// cosas distintas, y confundirlas ya me costó afirmar algo falso sobre Nu.
//
// `avisa` es una de tres: "todo", "parcial" o "nada"; `nota` dice exactamente qué esperar.

export const BANCOS = [
  {
    id: "banorte",
    nombre: "Banorte",
    remitentes: [/@banorte\.com$/i, /banorte/i],
    // Manda alerta por cada operación, pero solo si el titular la activa en su banca en línea.
    avisa: "todo",
  },
  {
    id: "santander",
    nombre: "Santander",
    remitentes: [/@santander\.com\.mx$/i, /santander/i],
    avisa: "todo",
  },
  {
    id: "banamex",
    nombre: "Banamex",
    remitentes: [/@banamex\.com$/i, /@banamex\.com\.mx$/i, /banamex|citibanamex/i],
    avisa: "todo",
  },
  {
    id: "hsbc",
    nombre: "HSBC",
    remitentes: [/@hsbc\.com\.mx$/i, /hsbc/i],
    // Solo avisa por operaciones grandes: los gastos chicos NO llegan por correo.
    avisa: "parcial",
    nota: "solo avisa de operaciones arriba de $1,500 — los gastos chicos no llegan",
    limiteConocido: 150000,
  },
  {
    id: "mercadopago",
    nombre: "Mercado Pago",
    remitentes: [/@mercadopago\.com(\.mx)?$/i, /mercadopago|mercadolibre/i],
    avisa: "todo",
  },
  {
    id: "didi",
    nombre: "DiDi",
    remitentes: [/@didiglobal\.com$/i, /didi/i],
    avisa: "todo",
  },
  {
    id: "spin",
    nombre: "Spin by OXXO",
    remitentes: [/@spin(byoxxo)?\.com(\.mx)?$/i, /spin.?by.?oxxo|oxxo/i],
    avisa: "todo",
  },
  {
    id: "klar",
    nombre: "Klar",
    remitentes: [/@klar\.mx$/i, /klar/i],
    avisa: "todo",
  },
  {
    id: "stori",
    nombre: "Stori",
    remitentes: [/@storicard\.com$/i, /stori/i],
    avisa: "todo",
  },
  {
    id: "hey",
    nombre: "Hey Banco",
    remitentes: [/@hey\.inc$/i, /hey ?banco/i],
    avisa: "todo",
  },
  {
    id: "nu",
    nombre: "Nu",
    remitentes: [/@nu\.com\.mx$/i, /\bnu\b|nubank/i],
    // Corregido con un comprobante real en la mano: Nu SÍ manda correo de las transferencias
    // que envías, con monto, fecha, destinatario y entidad. Lo que no manda es aviso de cada
    // compra con tarjeta: eso vive solo en su app. Antes aquí decía que no mandaba nada, y era
    // falso — la app llegó a afirmarlo en pantalla.
    avisa: "parcial",
    nota: "manda correo de las transferencias que envías, pero no de las compras con tarjeta",
  },
];

/** Qué banco mandó esto. `null` si no lo reconoce — que es un resultado válido, no un error. */
export function bancoDeRemitente(remitente) {
  const texto = String(remitente || "").trim();
  if (!texto) return null;
  for (const banco of BANCOS) {
    if (banco.remitentes.some((patron) => patron.test(texto))) return banco;
  }
  return null;
}

/** Los que avisan de todo por correo: con esos el puente cubre solo. */
export function bancosQueAvisan() {
  return BANCOS.filter((b) => b.avisa === "todo");
}

/** Los que avisan a medias. Son los que hay que explicar, no esconder. */
export function bancosParciales() {
  return BANCOS.filter((b) => b.avisa === "parcial");
}

/** El nombre como se escribe, a partir del id que se guardó. */
export function nombreDeBanco(id) {
  const banco = BANCOS.find((b) => b.id === id);
  return banco ? banco.nombre : null;
}
