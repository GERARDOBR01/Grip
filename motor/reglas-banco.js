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
// IMPORTANTE, y no es un detalle técnico: hay bancos que NUNCA van a estar aquí porque no
// mandan correo por cada movimiento. Nu es el caso claro: sus avisos viven solo dentro de su
// app. Para esos, la vía es compartir o pegar el texto a mano. Prometer lo contrario sería
// venderle a alguien una automatización que no existe.

export const BANCOS = [
  {
    id: "banorte",
    nombre: "Banorte",
    remitentes: [/@banorte\.com$/i, /banorte/i],
    // Manda alerta por cada operación, pero solo si el titular la activa en su banca en línea.
    avisaCadaMovimiento: true,
  },
  {
    id: "santander",
    nombre: "Santander",
    remitentes: [/@santander\.com\.mx$/i, /santander/i],
    avisaCadaMovimiento: true,
  },
  {
    id: "banamex",
    nombre: "Banamex",
    remitentes: [/@banamex\.com$/i, /@banamex\.com\.mx$/i, /banamex|citibanamex/i],
    avisaCadaMovimiento: true,
  },
  {
    id: "hsbc",
    nombre: "HSBC",
    remitentes: [/@hsbc\.com\.mx$/i, /hsbc/i],
    // Solo avisa por operaciones grandes. Los gastos chicos NO llegan por correo.
    avisaCadaMovimiento: false,
    limiteConocido: 150000, // $1,500.00 — debajo de esto no manda nada
  },
  {
    id: "mercadopago",
    nombre: "Mercado Pago",
    remitentes: [/@mercadopago\.com(\.mx)?$/i, /mercadopago|mercadolibre/i],
    avisaCadaMovimiento: true,
  },
  {
    id: "didi",
    nombre: "DiDi",
    remitentes: [/@didiglobal\.com$/i, /didi/i],
    avisaCadaMovimiento: true,
  },
  {
    id: "spin",
    nombre: "Spin by OXXO",
    remitentes: [/@spin(byoxxo)?\.com(\.mx)?$/i, /spin.?by.?oxxo|oxxo/i],
    avisaCadaMovimiento: true,
  },
  {
    id: "klar",
    nombre: "Klar",
    remitentes: [/@klar\.mx$/i, /klar/i],
    avisaCadaMovimiento: true,
  },
  {
    id: "stori",
    nombre: "Stori",
    remitentes: [/@storicard\.com$/i, /stori/i],
    avisaCadaMovimiento: true,
  },
  {
    id: "hey",
    nombre: "Hey Banco",
    remitentes: [/@hey\.inc$/i, /hey ?banco/i],
    avisaCadaMovimiento: true,
  },
  {
    id: "nu",
    nombre: "Nu",
    remitentes: [/@nu\.com\.mx$/i, /\bnu\b|nubank/i],
    // Nu lo dice en su propia documentación: sus notificaciones nunca llegan por correo ni
    // SMS, solo dentro de su app. Lo que llegue por aquí serán estados de cuenta, no compras.
    avisaCadaMovimiento: false,
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

/** Los que sí sirven para automatizar. Se usa para no prometer de más en la pantalla. */
export function bancosQueAvisan() {
  return BANCOS.filter((b) => b.avisaCadaMovimiento);
}

/** El nombre como se escribe, a partir del id que se guardó. */
export function nombreDeBanco(id) {
  const banco = BANCOS.find((b) => b.id === id);
  return banco ? banco.nombre : null;
}
