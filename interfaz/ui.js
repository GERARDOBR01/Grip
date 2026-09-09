// Interfaz — render directo, sin framework y sin dependencias.
//
// Un estado, una función que dibuja, y delegación de eventos. No hay nada que instalar ni
// nada que se pueda pudrir: el HTML que funciona hoy funciona igual dentro de cinco años.
//
// Regla de la pantalla: ningún número aparece sin su contexto. Si el motor devolvió
// SIN_DATOS_SUFICIENTES, aquí se ve el hueco declarado con lo que falta capturar — nunca
// un cero disfrazado de dato.

import { formatear, aCentavos } from "../motor/dinero.js";
import { hoyISO, mesDe, cicloDe, vencimientoEnMes, sumarDias } from "../motor/ciclo.js";
import {
  TIPOS, FRECUENCIAS, agregarMovimiento, eliminarMovimiento, movimientosEntre, categoriaPorId, idNuevo, datosVacios,
  ORIGENES, ESTADOS_BANDEJA, marcarBorrado, purgarBorrados,
} from "../motor/modelo.js";
import { resumenPresupuesto, topesVariables, topeVigente } from "../motor/presupuesto.js";
import { panelHoy, capacidadPorCiclo, estadoColchon, ahorroLibre } from "../motor/ahorro.js";
import { resumenMetas, exigenciaTotal } from "../motor/metas.js";
import { proximosVencimientos, totalFijosMensual, movimientoDeFijo, venceEnMes, montoMensualizado } from "../motor/fijos.js";
import { planDeDeuda, siPagarasMas } from "../motor/deudas.js";
import {
  recibirAviso, pendientes, ilegibles, aceptarEntrada, descartarEntrada, deshacerEntrada, resumenBandeja,
  impactoPendiente, purgarBandeja,
} from "../motor/bandeja.js";
import { reglasAprendidas, olvidar } from "../motor/aprendizaje.js";
import { porRegistrar, subieronDePrecio, fijoDesdeRecurrente, totalRecurrenteMensual } from "../motor/recurrentes.js";
import { tendenciaPorCiclo, resumenTendencia, quincenasDeColchon } from "../motor/tendencia.js";
import { nombreDeBanco, bancosQueAvisan, bancosParciales } from "../motor/reglas-banco.js";
import { abrirAlmacen, MODOS } from "../almacen/almacen.js";
import { exportar, importar, nombreDeRespaldo, respaldoPendiente } from "../almacen/archivo.js";

const app = {
  datos: datosVacios(),
  almacen: null,
  vista: "hoy",
  hoy: hoyISO(),
  aviso: null,
  bloqueado: false,
  filtro: { texto: "", tipo: "" },
  // Lo que la persona eligió en la bandeja antes de aceptar, por entrada. Vive solo en la
  // pantalla: si cierra la app sin aceptar, no queda rastro de una decisión a medias.
  eleccion: {},
  // Cuántas entradas de la bandeja se pintan. Sube cuando la persona pide ver más.
  verBandeja: 25,
  // Lo que lleva escrito en la caja de pegar. Vive en el estado y no solo en el DOM porque
  // cualquier re-dibujo —un guardado, o que otro dispositivo escriba— lo borraría a media
  // captura. Perder lo que alguien acaba de pegar es la clase de detalle que hace que una
  // app se deje de usar.
  borrador: "",
};

const VISTAS = [
  { id: "hoy", icono: "⌂", nombre: "Hoy" },
  { id: "bandeja", icono: "⇊", nombre: "Bandeja" },
  { id: "presupuesto", icono: "▤", nombre: "Presupuesto" },
  { id: "metas", icono: "◎", nombre: "Metas" },
  { id: "fijos", icono: "⏱", nombre: "Fijos" },
  { id: "ajustes", icono: "⚙", nombre: "Ajustes" },
];

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// --- Utilidades de pantalla ---

function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function monto(centavos, opciones) {
  return centavos === null || centavos === undefined ? "—" : formatear(centavos, opciones);
}

function fechaCorta(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES_CORTOS[m - 1]}`;
}

function fechaLarga(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

/** El veredicto tal como lo devolvió el motor: estado, motivo y fuente. */
function veredictoHTML(v) {
  if (!v) return "";
  const falta = v.datos && v.datos.falta ? `<div class="rotulo" style="width:100%">→ ${esc(v.datos.falta)}</div>` : "";
  return `<div class="veredicto"><span class="marca ${esc(v.estado)}">${esc(v.estado)}</span>
    <span>${esc(v.motivo)}</span><span class="fuente">fuente: ${esc(v.fuente)}</span>${falta}</div>`;
}

function tarjetaCifra({ rotulo, valor, clase = "", extra = "", veredicto }) {
  return `<div class="tarjeta">
    <div class="rotulo">${esc(rotulo)}</div>
    <div class="cifra ${clase}">${valor}</div>
    ${extra}
    ${veredictoHTML(veredicto)}
  </div>`;
}

function vacio(texto) {
  return `<div class="vacio">${esc(texto)}</div>`;
}

// --- Render ---

function render() {
  const raiz = document.getElementById("raiz");
  const ciclo = cicloDe(app.hoy, app.datos.perfil.cortes);
  const estado = app.almacen ? app.almacen.estado() : { modo: MODOS.LOCAL, tipoLocal: "—" };
  const sincronizado = estado.modo === MODOS.SINCRONIZADO;
  // El globo cuenta TODO lo que espera respuesta, ilegibles incluidas: si no aparecen aquí,
  // no existen para nadie y volvemos al punto de partida, solo que con la entrada guardada.
  const resumen = resumenBandeja(app.datos);
  const esperando = resumen.pendientes + resumen.ilegibles;

  const etiquetaEstado = sincronizado
    ? "Sincronizado"
    : estado.modo === MODOS.EFIMERO
      ? "Sin guardar"
      : "Solo este dispositivo";

  raiz.innerHTML = `
    <header class="barra"><div class="envoltura">
      <div>
        <h1>${esc(document.title || "Finanzas")}</h1>
        <div class="ciclo">${esc(ciclo.etiqueta)} · ${fechaCorta(ciclo.inicio)} – ${fechaCorta(ciclo.fin)}</div>
      </div>
      <button class="estado" data-accion="ver-estado">
        <i class="punto ${sincronizado ? "vivo" : ""}"></i>${esc(etiquetaEstado)}
      </button>
    </div></header>

    <main class="envoltura">
      ${app.aviso ? `<div class="aviso ${app.bloqueado ? "malo" : ""}">${esc(app.aviso)}
        <div class="acciones"><button class="boton chico tenue" data-accion="cerrar-aviso">Entendido</button></div></div>` : ""}
      ${vistaActual()}
      <div class="pie">Tus datos viven en este dispositivo${sincronizado ? " y en tu cuenta" : ""}. Nunca en el repositorio.</div>
    </main>

    ${app.vista === "bandeja" ? "" : `<button class="flotante" data-accion="capturar" aria-label="Capturar gasto">+</button>`}

    <nav class="nav"><div class="envoltura">
      ${VISTAS.map((v) => {
        // El contador solo existe si hay algo que hacer. Un globo en cero es ruido.
        const globo = v.id === "bandeja" && esperando > 0 ? `<i class="globo">${esperando}</i>` : "";
        return `<button data-accion="ir" data-vista="${v.id}" aria-current="${app.vista === v.id || (app.vista === 'historial' && v.id === 'hoy')}">
        <span>${v.icono}${globo}</span>${esc(v.nombre)}</button>`;
      }).join("")}
    </div></nav>`;
}

function vistaActual() {
  if (app.vista === "bandeja") return vistaBandeja();
  if (app.vista === "historial") return vistaHistorial();
  if (app.vista === "presupuesto") return vistaPresupuesto();
  if (app.vista === "metas") return vistaMetas();
  if (app.vista === "fijos") return vistaFijos();
  if (app.vista === "ajustes") return vistaAjustes();
  return vistaHoy();
}

// --- Vista: Hoy ---

function nombreCiclo(ciclo) {
  return ciclo.total > 1 ? "quincena" : "mensualidad";
}

/**
 * Qué se le dice a la persona sobre dónde viven sus datos.
 *
 * Son DOS preguntas y antes se contestaban con una sola frase optimista: si sobrevive a cerrar
 * la pestaña, y si el navegador se comprometió a no borrarlo cuando ande corto de espacio. Lo
 * segundo hay que pedirlo y puede negarse — Safari borra el almacenamiento de scripts a los 7
 * días sin interacción, y ahí se va un historial entero. Cuando no está concedido, se dice, y
 * se dice también qué hacer: instalarla en la pantalla de inicio y bajar un respaldo.
 */
function textoDelAlmacenamiento(estado) {
  if (estado.modo === MODOS.EFIMERO) {
    return "Este navegador no deja guardar nada: al cerrar la pestaña se pierde lo capturado. Descarga un respaldo antes de cerrar.";
  }

  const donde =
    estado.modo === MODOS.SINCRONIZADO
      ? "Lo que capturas aquí aparece también en tus otros dispositivos, y una copia queda en éste."
      : `Todo se guarda en este dispositivo (${estado.tipoLocal}). Para pasarlo a otro lado, usa el respaldo en Ajustes.`;

  const permanencia = estado.persistente
    ? "El navegador se comprometió a no borrarlo aunque ande corto de espacio."
    : "Ojo: el navegador NO concedió almacenamiento permanente, así que el sistema puede borrarlo si se " +
      "queda sin espacio o si pasan semanas sin abrir la app. Instálala en tu pantalla de inicio para que " +
      "sea mucho menos probable, y baja un respaldo de vez en cuando.";

  return [donde, permanencia, estado.motivo].filter(Boolean).join(" ");
}

function vistaHoy() {
  const { datos, hoy } = app;
  const panel = panelHoy(datos, hoy);
  const vencimientos = proximosVencimientos(datos, hoy, 10);
  const recientes = movimientosEntre(datos, panel.ciclo.inicio, hoy).slice(0, 6);

  const primeraVez = datos.perfil.ingresoQuincenal === null && Object.keys(datos.movimientos).length === 0;
  const arranque = primeraVez
    ? `<div class="aviso">
        <b>Empieza por aquí.</b> Con tu ingreso quincenal y tus pagos fijos, los paneles se encienden.
        Son tres minutos; lo demás lo puedes ir capturando sobre la marcha.
        <div class="acciones">
          <button class="boton chico" data-accion="editar-ingreso">Mi ingreso</button>
          <button class="boton chico tenue" data-accion="nuevo-fijo">Agregar un fijo</button>
        </div>
      </div>`
    : "";

  const principal =
    panel.disponible === null
      ? tarjetaCifra({
          rotulo: `Disponible en esta ${nombreCiclo(panel.ciclo)}`,
          valor: "—",
          clase: "vacia",
          veredicto: panel.veredicto,
        })
      : tarjetaCifra({
          rotulo: `Disponible en esta ${nombreCiclo(panel.ciclo)}`,
          valor: monto(panel.disponible),
          clase: panel.disponible < 0 ? "mal" : "",
          extra: `<div class="rotulo">quedan ${panel.ciclo.diasRestantes} de ${panel.ciclo.dias} días · ya gastaste ${monto(panel.gasto.total)}${
            panel.fijos.pendiente > 0 ? ` · fijos por pagar ${monto(panel.fijos.pendiente)}` : ""
          }</div>
          ${panel.ingresos.origen === "perfil"
            ? `<div class="rotulo">Cuenta con ${monto(panel.ingresos.monto)} de ingreso <b>estimado de tu perfil</b> — todavía no capturas el depósito de este ciclo.</div>`
            : ""}`,
          veredicto: panel.veredicto,
        });

  const porDia =
    panel.porDia === null
      ? `<div class="tarjeta"><div class="rotulo">Por día</div><div class="cifra vacia">—</div></div>`
      : `<div class="tarjeta"><div class="rotulo">Por día</div>
          <div class="cifra ${panel.porDia < 0 ? "mal" : ""}">${monto(panel.porDia)}</div>
          <div class="rotulo">hasta el ${fechaCorta(panel.ciclo.fin)}</div></div>`;

  const capacidad =
    panel.capacidad.monto === null
      ? `<div class="tarjeta"><div class="rotulo">Cierre proyectado</div><div class="cifra vacia">—</div>
          <div class="rotulo">${esc(panel.capacidad.veredicto.motivo)}</div></div>`
      : `<div class="tarjeta"><div class="rotulo">Cierre proyectado</div>
          <div class="cifra ${panel.capacidad.monto < 0 ? "mal" : ""}">${monto(panel.capacidad.monto)}</div>
          <div class="rotulo">a ${monto(panel.capacidad.ritmoDiario)} por día</div></div>`;

  const listaVencimientos = vencimientos.length
    ? `<div class="titulo-seccion">Por pagar</div><div class="tarjeta">${vencimientos
        .map(
          (v) => `<div class="fila apilada">
            <div class="linea"><div class="nombre">${esc(v.fijo.nombre)}</div><div class="monto">${monto(v.monto)}</div></div>
            <div class="sub">${v.vencido ? `venció hace ${Math.abs(v.dias)} día(s)` : v.dias === 0 ? "vence hoy" : `en ${v.dias} día(s)`} · ${fechaCorta(v.fecha)}</div>
            <div class="acciones-fila">
              <button class="boton chico" data-accion="pagar-fijo" data-id="${esc(v.fijo.id)}" data-fecha="${esc(v.fecha)}">Pagué</button>
            </div>
          </div>`,
        )
        .join("")}</div>`
    : "";

  const totalMovimientos = Object.values(datos.movimientos).reduce((t, l) => t + l.length, 0);
  const listaMovimientos = recientes.length
    ? `<div class="titulo-seccion">Últimos movimientos</div><div class="tarjeta">${recientes.map(filaMovimiento).join("")}
        <div class="acciones"><button class="boton tenue" data-accion="ver-historial">Ver el historial (${totalMovimientos})</button></div></div>`
    : `<div class="titulo-seccion">Últimos movimientos</div><div class="tarjeta">${vacio("Nada capturado en este ciclo todavía. El botón + es para eso.")}
        ${totalMovimientos ? `<div class="acciones"><button class="boton tenue" data-accion="ver-historial">Ver el historial (${totalMovimientos})</button></div>` : ""}</div>`;

  // La lección de Mint: tener exportador no salva a nadie; haberlo usado, sí. No bloquea,
  // no regaña, y no aparece si no hay nada nuevo que perder.
  const pendienteRespaldo = respaldoPendiente(datos, hoy);
  const respaldoBanner = pendienteRespaldo
    ? `<div class="aviso">
        <b>${pendienteRespaldo.nunca
            ? `Llevas ${pendienteRespaldo.movimientos} movimientos y ningún respaldo.`
            : `Hace ${pendienteRespaldo.dias} días del último respaldo.`}</b>
        Vive todo en este dispositivo: si el navegador hace limpieza, se va. Es un toque.
        <div class="acciones"><button class="boton chico" data-accion="exportar">Bajar respaldo</button></div>
      </div>`
    : "";

  const espera = pendientes(datos);
  const bandejaBanner = espera.length
    ? `<div class="aviso">
        <b>${espera.length} ${espera.length === 1 ? "movimiento espera" : "movimientos esperan"} tu confirmación.</b>
        Son ${monto(impactoPendiente(datos).gasto)} en gastos que todavía no cuentan aquí.
        <div class="acciones"><button class="boton chico" data-accion="ir" data-vista="bandeja">Revisar</button></div>
      </div>`
    : "";

  // El aviso que de verdad ahorra dinero: una suscripción que subió sin avisar.
  const subidas = subieronDePrecio(datos, hoy);
  const avisoSubidas = subidas.length
    ? `<div class="titulo-seccion">Te subieron de precio</div><div class="tarjeta">${subidas
        .map((r) => `<div class="fila apilada">
          <div class="linea"><div class="nombre">${esc(r.nombre)}</div><div class="monto mal">+${monto(r.monto - r.montoAnterior)}</div></div>
          <div class="sub">${esc(r.veredicto.motivo)}</div>
        </div>`).join("")}</div>`
    : "";

  const colchon = estadoColchon(datos);
  const aguante = quincenasDeColchon(datos, hoy);
  const tarjetaColchon =
    colchon.objetivo === null && colchon.acumulado === 0
      ? "" // sin objetivo y sin nada apartado, no hay nada que enseñar todavía
      : `<div class="titulo-seccion">Fondo de emergencia</div>
         <div class="tarjeta">
           <div class="cifra" style="font-size:28px">${monto(colchon.acumulado)}${
             colchon.objetivo !== null ? `<span class="rotulo"> de ${monto(colchon.objetivo)}</span>` : ""
           }</div>
           ${colchon.objetivo !== null
             ? `<div class="barra-progreso"><i class="${esc(colchon.veredicto.estado)}" style="width:${Math.min(
                 Math.round((colchon.acumulado * 100) / colchon.objetivo), 100)}%"></i></div>`
             : ""}
           ${veredictoHTML(colchon.veredicto)}
           ${veredictoHTML(aguante.veredicto)}
           <div class="acciones"><button class="boton chico tenue" data-accion="editar-colchon">
             ${colchon.objetivo === null ? "Definir mi fondo" : "Cambiar objetivo"}</button></div>
         </div>`;

  return `${arranque}${bandejaBanner}${principal}<div class="duo">${porDia}${capacidad}</div>${avisoSubidas}${listaVencimientos}${tarjetaColchon}${respaldoBanner}${listaMovimientos}`;
}

// --- Vista: Bandeja ---

const CONFIANZA_TEXTO = { alta: "Lo leí completo", media: "Revísalo", baja: "Confírmalo" };

/** Cuántas fichas caben antes de que elegir cueste más que escribir. */
const FICHAS_VISIBLES = 6;

/**
 * Cuántas entradas se dibujan de una vez.
 * El puente puede traer cuarenta de golpe después de unas vacaciones, y pintarlas todas son
 * cientos de botones en una sola pasada — en un teléfono eso se siente.
 */
const ENTRADAS_POR_TANDA = 25;

/**
 * Las categorías que conviene ofrecer de un toque: la que ya está puesta, y después las que
 * esta persona más usa. El resto siguen ahí, en "Editar" — pero no estorbando.
 */
function categoriasACalce(elegida) {
  const uso = new Map();
  for (const lista of Object.values(app.datos.movimientos)) {
    for (const m of lista) if (m.categoria) uso.set(m.categoria, (uso.get(m.categoria) || 0) + 1);
  }
  const orden = opcionesCategorias().sort((a, b) => (uso.get(b.valor) || 0) - (uso.get(a.valor) || 0));
  const puesta = orden.filter((c) => c.valor === elegida);
  return [...puesta, ...orden.filter((c) => c.valor !== elegida)].slice(0, FICHAS_VISIBLES);
}

function tarjetaEntrada(entrada) {
  const elegida = app.eleccion[entrada.id] !== undefined ? app.eleccion[entrada.id] : entrada.movimiento.categoria;
  const esGasto = entrada.movimiento.tipo === TIPOS.GASTO;
  const signo = esGasto ? "−" : "+";

  const contexto = [
    fechaCorta(entrada.movimiento.fecha),
    entrada.banco ? nombreDeBanco(entrada.banco) || entrada.banco : null,
    entrada.ultimos4 ? `••${entrada.ultimos4}` : null,
    entrada.origen === ORIGENES.CORREO ? "de tu correo" : entrada.origen === ORIGENES.COMPARTIDO ? "compartido" : null,
  ].filter(Boolean).join(" · ");

  // Las categorías van como fichas para que aceptar sea un toque, no un formulario. Ésa es
  // toda la diferencia entre una bandeja que se usa a diario y una que se abandona.
  const fichas = esGasto
    ? `<div class="chips apretados">${categoriasACalce(elegida).map((c) => `
        <button class="chip" aria-pressed="${c.valor === elegida}" data-accion="elegir-categoria"
          data-id="${esc(entrada.id)}" data-categoria="${esc(c.valor)}">${esc(c.etiqueta)}</button>`).join("")}</div>`
    : "";

  const alerta = entrada.posibleTraspaso
    ? `<div class="rotulo aviso-linea">Parece un movimiento entre tus propias cuentas. Si lo es, descártalo: no es un gasto.</div>`
    : entrada.aviso
      ? `<div class="rotulo aviso-linea">${esc(entrada.aviso)}</div>`
      : "";

  return `<div class="tarjeta entrada">
    <div class="linea">
      <div class="nombre grande">${esc(entrada.comercio || entrada.movimiento.nota || "Movimiento")}</div>
      <div class="monto ${esGasto ? "" : "bien"}">${signo}${monto(entrada.movimiento.monto)}</div>
    </div>
    <div class="sub">${esc(contexto)} · <span class="marca-confianza ${esc(entrada.confianza)}">${esc(CONFIANZA_TEXTO[entrada.confianza])}</span></div>
    ${alerta}
    ${fichas}
    <div class="acciones-fila">
      ${entrada.reemplaza
        ? `<button class="boton chico" data-accion="reemplazar-entrada" data-id="${esc(entrada.id)}">Reemplazar</button>`
        : ""}
      <button class="boton chico${entrada.reemplaza ? " tenue" : ""}" data-accion="aceptar-entrada" data-id="${esc(entrada.id)}">
        ${entrada.reemplaza ? "Sumar aparte" : "Aceptar"}</button>
      <button class="boton chico tenue" data-accion="editar-entrada" data-id="${esc(entrada.id)}">Editar</button>
      <button class="boton chico tenue" data-accion="descartar-entrada" data-id="${esc(entrada.id)}">Descartar</button>
    </div>
  </div>`;
}

function vistaBandeja() {
  const espera = pendientes(app.datos);
  const sinLeer = ilegibles(app.datos);
  const impacto = impactoPendiente(app.datos);

  const pegar = `<div class="tarjeta">
    <div class="titulo-tarjeta">Pega el aviso de tu banco</div>
    <div class="rotulo">Copia el correo o la notificación y pégalo aquí. Saco el monto, la fecha y el
      comercio; tú confirmas. Funciona con cualquier banco, lo reconozca o no.</div>
    <textarea id="aviso" class="campo area" rows="3" data-accion-input="borrador-aviso"
      placeholder="Compra por $189.00 en ... el 09/09/2026">${esc(app.borrador)}</textarea>
    <div class="acciones"><button class="boton" data-accion="leer-aviso">Leer</button></div>
  </div>`;

  // Los que llegaron y no supe leer. Van ARRIBA de todo: son los únicos donde, si nadie hace
  // nada, se pierde un gasto de verdad. Cada uno pide dos datos y ya.
  const seccionSinLeer = sinLeer.length
    ? `<div class="titulo-seccion">No supe leer ${sinLeer.length === 1 ? "este" : `estos ${sinLeer.length}`}</div>
       <div class="rotulo" style="margin:0 0 8px">Llegaron de tus bancos y no entendí el formato. Dime cuánto
         y dónde, y además aprendo: el siguiente de ese lugar ya entra solo.</div>
       ${sinLeer.slice(0, app.verBandeja).map(tarjetaIlegible).join("")}`
    : "";

  if (!espera.length) {
    return `${seccionSinLeer}${pegar}${sinLeer.length ? "" : `<div class="tarjeta">${vacio("Todo al día. Nada espera tu confirmación.")}</div>`}`;
  }

  const resumen = `<div class="tarjeta">
    <div class="rotulo">${esc(impacto.veredicto.motivo)}</div>
    <div class="cifra" style="font-size:26px">−${monto(impacto.gasto)}${
      impacto.ingreso ? ` <span class="rotulo">y +${monto(impacto.ingreso)} de ingreso</span>` : ""}</div>
    <div class="rotulo">es lo que cambiaría si aceptas todo</div>
  </div>`;

  const visibles = espera.slice(0, app.verBandeja);
  const faltan = espera.length - visibles.length;
  const masBoton = faltan
    ? `<div class="acciones"><button class="boton tenue" data-accion="ver-mas-bandeja">
        Ver ${faltan} ${faltan === 1 ? "más" : "más"}</button></div>`
    : "";

  return `${seccionSinLeer}${resumen}${visibles.map(tarjetaEntrada).join("")}${masBoton}${pegar}`;
}

/**
 * Un aviso que llegó y no se pudo leer. Pide lo mínimo: cuánto y dónde.
 *
 * Antes esto ni existía — el correo se contaba como "ilegible" y se tiraba, así que con ocho
 * de once bancos cuyo formato nadie ha visto, ahí se iba dinero real sin dejar rastro. Se
 * enseña la primera línea del aviso para poder reconocerlo; el cuerpo no se guarda.
 */
function tarjetaIlegible(entrada) {
  const banco = entrada.banco ? nombreDeBanco(entrada.banco) : "un banco";
  return `<div class="tarjeta">
    <div class="fila apilada">
      <div class="linea"><div class="nombre">${esc(entrada.resumen || `Aviso de ${banco}`)}</div></div>
      <div class="sub">llegó el ${fechaCorta(entrada.recibido)}${entrada.banco ? ` · ${esc(banco)}` : ""}</div>
    </div>
    <div class="duo">
      <div class="campo"><label for="ileg-monto-${esc(entrada.id)}">Cuánto</label>
        <input id="ileg-monto-${esc(entrada.id)}" inputmode="decimal" class="monto" placeholder="0.00"></div>
      <div class="campo"><label for="ileg-nota-${esc(entrada.id)}">Dónde</label>
        <input id="ileg-nota-${esc(entrada.id)}" type="text" placeholder="OXXO, Uber, la tienda…"></div>
    </div>
    <div class="acciones">
      <button class="boton" data-accion="guardar-ilegible" data-id="${esc(entrada.id)}">Guardar</button>
      <button class="boton tenue" data-accion="descartar-entrada" data-id="${esc(entrada.id)}">No era un gasto</button>
    </div>
  </div>`;
}

function filaMovimiento(m) {
  const categoria = categoriaPorId(app.datos, m.categoria);
  const signo = m.tipo === TIPOS.INGRESO || m.tipo === TIPOS.RETIRO ? "+" : m.tipo === TIPOS.AHORRO ? "→" : "−";
  const nombre =
    m.tipo === TIPOS.INGRESO ? "Ingreso"
    : m.tipo === TIPOS.AHORRO ? "Apartado"
    : m.tipo === TIPOS.RETIRO ? "Retiro de lo apartado"
    : categoria ? categoria.nombre : "Gasto";
  const icono =
    m.tipo === TIPOS.INGRESO ? "↓" : m.tipo === TIPOS.AHORRO ? "◎" : m.tipo === TIPOS.RETIRO ? "↑" : categoria ? categoria.emoji : "•";

  return `<div class="fila">
    <div class="emoji">${esc(icono)}</div>
    <button class="crece toque" data-accion="editar-movimiento" data-id="${esc(m.id)}">
      <div class="nombre">${esc(m.nota || nombre)}</div>
      <div class="sub">${fechaCorta(m.fecha)}${m.nota ? ` · ${esc(nombre)}` : ""}</div>
    </button>
    <div class="monto">${signo}${formatear(m.monto)}</div>
    <button class="boton chico tenue" data-accion="borrar-movimiento" data-id="${esc(m.id)}" aria-label="Borrar">✕</button>
  </div>`;
}

// --- Vista: Historial ---
//
// Mes por mes, con lo que entró, lo que salió y lo que se apartó. Sin gráficas: los números
// y sus movimientos, que es lo que se necesita para revisar y corregir.

/**
 * La tendencia, en SVG escrito a mano. Sin librería de gráficas: son seis barras y una línea
 * de cero, y meter una dependencia para eso sería cambiar durabilidad por nada.
 */
function graficaTendencia(puntos) {
  const ANCHO = 300, ALTO = 96, BASE = 56, MAXIMO = 40;
  const tope = Math.max(...puntos.map((p) => Math.abs(p.saldo)), 1);
  const paso = ANCHO / puntos.length;
  const grosor = Math.min(paso - 10, 28);

  const barras = puntos.map((p, i) => {
    const centro = paso * i + paso / 2;
    const alto = Math.max(Math.round((Math.abs(p.saldo) * MAXIMO) / tope), p.hayDatos ? 2 : 0);
    const y = p.saldo >= 0 ? BASE - alto : BASE;
    const clase = !p.hayDatos ? "sin-datos" : p.saldo >= 0 ? "bien" : "mal";
    return `<rect x="${(centro - grosor / 2).toFixed(1)}" y="${y}" width="${grosor.toFixed(1)}" height="${alto}"
      rx="3" class="${clase}${p.completo ? "" : " encurso"}"/>
      <text x="${centro.toFixed(1)}" y="${ALTO - 4}" text-anchor="middle" class="etiqueta">${esc(p.corta)}</text>`;
  }).join("");

  return `<svg class="tendencia" viewBox="0 0 ${ANCHO} ${ALTO}" role="img"
      aria-label="Lo que sobró en cada una de las últimas ${puntos.length} quincenas">
    <line x1="0" y1="${BASE}" x2="${ANCHO}" y2="${BASE}" class="cero"/>
    ${barras}
  </svg>`;
}

function tarjetaTendencia() {
  const { puntos, veredicto: v } = resumenTendencia(app.datos, app.hoy, 6);
  if (!puntos.some((p) => p.hayDatos)) return "";
  return `<div class="titulo-seccion">¿Voy mejorando?</div>
    <div class="tarjeta">
      <div class="rotulo">Lo que sobró en cada quincena — la última todavía va corriendo</div>
      ${graficaTendencia(puntos)}
      ${veredictoHTML(v)}
    </div>`;
}

function vistaHistorial() {
  const filtro = app.filtro || { texto: "", tipo: "" };
  const meses = Object.keys(app.datos.movimientos).sort().reverse();
  if (!meses.length) {
    return `<div class="tarjeta">${vacio("Todavía no hay nada capturado.")}
      <button class="boton tenue" data-accion="ir" data-vista="hoy">Volver</button></div>`;
  }

  // Filtrado en memoria: el texto busca en la nota y en el nombre de la categoría.
  const pasa = (m) => {
    if (filtro.tipo && m.tipo !== filtro.tipo) return false;
    if (!filtro.texto) return true;
    const categoria = categoriaPorId(app.datos, m.categoria);
    const donde = `${m.nota || ""} ${categoria ? categoria.nombre : ""}`.toLowerCase();
    return donde.includes(filtro.texto.toLowerCase());
  };

  let encontrados = 0;
  let sumaFiltrada = 0;

  const bloques = meses
    .map((mes) => {
      const lista = app.datos.movimientos[mes].filter(pasa);
      if (!lista.length) return "";
      encontrados += lista.length;
      sumaFiltrada += lista.reduce((t, m) => t + (m.tipo === TIPOS.GASTO ? m.monto : 0), 0);
      const suman = (filtro) => lista.reduce((t, m) => (filtro(m) ? t + m.monto : t), 0);
      const gastos = suman((m) => m.tipo === TIPOS.GASTO);
      const ingresos = suman((m) => m.tipo === TIPOS.INGRESO);
      const ahorros = suman((m) => m.tipo === TIPOS.AHORRO);
      const [anio, numero] = mes.split("-").map(Number);

      return `<div class="titulo-seccion">${MESES[numero - 1]} ${anio}</div>
        <div class="tarjeta">
          <div class="fila" style="border-bottom:1px solid var(--borde)">
            <div class="crece"><div class="sub">${lista.length} movimiento(s)</div></div>
            <div class="monto" style="font-size:13px">
              ${ingresos ? `<span style="color:var(--bien)">+${monto(ingresos)}</span> ` : ""}−${monto(gastos)}${ahorros ? ` · →${monto(ahorros)}` : ""}
            </div>
          </div>
          ${lista.map(filaMovimiento).join("")}
        </div>`;
    })
    .join("");

  const chipsTipo = [
    { valor: "", etiqueta: "Todo" },
    { valor: TIPOS.GASTO, etiqueta: "Gastos" },
    { valor: TIPOS.INGRESO, etiqueta: "Ingresos" },
    { valor: TIPOS.AHORRO, etiqueta: "Apartados" },
    { valor: TIPOS.RETIRO, etiqueta: "Retiros" },
  ];

  const buscador = `<div class="tarjeta plana">
      <input id="buscador" type="search" placeholder="Buscar por nota o categoría"
             value="${esc(filtro.texto)}" data-accion-input="filtrar-texto">
      <div class="chips" style="margin-top:10px">
        ${chipsTipo
          .map(
            (c) => `<button class="chip" data-accion="filtrar-tipo" data-tipo="${esc(c.valor)}"
              aria-pressed="${filtro.tipo === c.valor}">${esc(c.etiqueta)}</button>`,
          )
          .join("")}
      </div>
      ${filtro.texto || filtro.tipo
        ? `<div class="rotulo" style="margin-top:10px">${encontrados} movimiento(s)${
            sumaFiltrada ? ` · ${monto(sumaFiltrada)} en gastos` : ""
          }</div>`
        : ""}
    </div>`;

  return `<div class="acciones" style="margin:0 0 10px"><button class="boton tenue" data-accion="ir" data-vista="hoy">← Volver a Hoy</button></div>
    ${tarjetaTendencia()}
    ${buscador}
    ${bloques || `<div class="tarjeta">${vacio("Nada coincide con esa búsqueda.")}</div>`}`;
}

// --- Vista: Presupuesto ---

function vistaPresupuesto() {
  const filas = resumenPresupuesto(app.datos, app.hoy);
  const mes = mesDe(app.hoy);

  if (!filas.length) {
    return `<div class="tarjeta">${vacio("Sin topes ni gastos este mes. Ponle tope a una categoría para tener contra qué comparar.")}
      <button class="boton" data-accion="editar-topes">Poner topes</button></div>`;
  }

  const cuerpo = filas
    .map((f) => {
      const pct = f.veredicto.datos.pct;
      const ancho = Math.min(pct === null || pct === undefined ? 0 : pct, 100);
      return `<div class="fila" style="border-bottom:0;padding-bottom:4px">
          <div class="emoji">${esc(f.categoria.emoji)}</div>
          <div class="crece">
            <div class="nombre">${esc(f.categoria.nombre)}</div>
            <div class="sub">${f.tope === null ? "sin tope" : `${monto(f.gastado)} de ${monto(f.tope)}`}</div>
            <div class="barra-progreso"><i class="${esc(f.veredicto.estado)}" style="width:${ancho}%"></i></div>
          </div>
          <button class="boton chico tenue" data-accion="editar-tope" data-id="${esc(f.categoria.id)}">
            ${f.tope === null ? "Poner tope" : monto(f.tope)}
          </button>
        </div>
        <div class="veredicto" style="margin:0 0 14px 42px;border-top:0;padding-top:2px">
          <span class="marca ${esc(f.veredicto.estado)}">${esc(f.veredicto.estado)}</span>
          <span>${esc(f.veredicto.motivo)}</span></div>`;
    })
    .join("");

  const topes = topesVariables(app.datos, mes);
  const nota = topes.completo
    ? ""
    : `<div class="aviso">Estas categorías todavía no tienen tope: ${esc(
        topes.sinTope.map((id) => (categoriaPorId(app.datos, id) || {}).nombre || id).join(", "),
      )}. Sin tope no hay semáforo, y tampoco entran en tu capacidad de ahorro.</div>`;

  return `${nota}<div class="tarjeta">${cuerpo}</div>
    <div class="acciones"><button class="boton tenue" data-accion="nueva-categoria">Nueva categoría</button></div>`;
}

// --- Vista: Metas ---

function vistaMetas() {
  const capacidad = capacidadPorCiclo(app.datos, app.hoy, topesVariables(app.datos, mesDe(app.hoy)));
  const planes = resumenMetas(app.datos, app.hoy, capacidad.monto);

  const cabecera = tarjetaCifra({
    rotulo: "Capacidad de ahorro por quincena",
    valor: monto(capacidad.monto),
    clase: capacidad.monto === null ? "vacia" : capacidad.monto < 0 ? "mal" : "",
    extra:
      capacidad.monto === null
        ? ""
        : `<div class="rotulo">ingreso ${monto(capacidad.ingreso)} − fijos ${monto(capacidad.fijosCiclo)} − presupuesto ${monto(capacidad.variableCiclo)}</div>`,
    veredicto: capacidad.veredicto,
  });

  if (!planes.length) {
    return `${cabecera}<div class="tarjeta">${vacio("Sin metas todavía. Una meta es un monto y una fecha; el resto lo calcula la app.")}
      <button class="boton" data-accion="nueva-meta">Crear una meta</button></div>`;
  }

  const total = exigenciaTotal(planes, capacidad.monto);
  const tarjetas = planes
    .map((p) => {
      const pct = p.objetivo ? Math.min(Math.round((p.ahorrado * 100) / p.objetivo), 100) : 0;
      const alternativa = p.veredicto.datos && p.veredicto.datos.alternativa;
      const salida =
        alternativa && alternativa.tipo === "mover-fecha"
          ? `<div class="rotulo" style="margin-top:8px">Con ${monto(alternativa.aportacionPosible)} por quincena, la fecha realista es el ${fechaLarga(
              alternativa.fechaRealista,
            )}.</div>`
          : "";

      return `<div class="tarjeta">
        <div class="fila" style="border-bottom:0;padding:0">
          <div class="crece"><div class="nombre">${esc(p.meta.nombre)}</div>
            <div class="sub">${monto(p.ahorrado)} de ${monto(p.objetivo)}${p.meta.fechaLimite ? ` · para el ${fechaCorta(p.meta.fechaLimite)}` : ""}</div></div>
          <button class="boton chico" data-accion="apartar" data-id="${esc(p.meta.id)}">Apartar</button>
        </div>
        <div class="barra-progreso"><i class="${esc(p.veredicto.estado)}" style="width:${pct}%"></i></div>
        <div class="cifra" style="font-size:26px;margin-top:12px">${monto(p.requerido)}<span class="rotulo"> por quincena</span></div>
        ${veredictoHTML(p.veredicto)}${salida}
        <div class="acciones"><button class="boton chico tenue" data-accion="editar-meta" data-id="${esc(p.meta.id)}">Editar</button>
        <button class="boton chico peligro" data-accion="borrar-meta" data-id="${esc(p.meta.id)}">Borrar</button></div>
      </div>`;
    })
    .join("");

  const suma =
    planes.length > 1
      ? `<div class="tarjeta plana"><div class="rotulo">Todas tus metas juntas piden</div>
          <div class="cifra" style="font-size:26px">${monto(total.requerido)}</div>${veredictoHTML(total.veredicto)}</div>`
      : "";

  return `${cabecera}${suma}<div class="titulo-seccion">Metas</div>${tarjetas}
    <div class="acciones"><button class="boton tenue" data-accion="nueva-meta">Nueva meta</button></div>`;
}

// --- Vista: Fijos y deudas ---

/** "cada mes" · "cada año · toca en marzo" */
function comoFrecuencia(fijo) {
  const frecuencia = fijo.frecuencia || 1;
  if (frecuencia === 1) return "cada mes";
  const etiqueta = (FRECUENCIAS.find((f) => f.meses === frecuencia) || {}).etiqueta || `cada ${frecuencia} meses`;
  const ancla = fijo.mesAncla ? ` · toca en ${MESES[Number(fijo.mesAncla.slice(5, 7)) - 1]}` : "";
  return `${etiqueta.toLowerCase()}${ancla}`;
}

/**
 * Qué pasaría pagando un poco más al mes. Suele ser el número que más mueve la aguja y la
 * app ya lo calculaba: solo que nadie lo veía.
 */
function tarjetaPagarMas(datos, deuda, plan) {
  if (plan.meses === null || !plan.pago.monto) return "";

  const opciones = [50000, 100000, 200000]
    .map((extra) => siPagarasMas(datos, deuda, extra))
    .filter((r) => r && r.mesesMenos > 0);
  if (!opciones.length) return "";

  const mejor = opciones[0];
  return `<div class="rotulo" style="margin-top:10px">
    Pagando ${monto(mejor.extra)} más al mes la liquidas
    <b>${mejor.mesesMenos} ${mejor.mesesMenos === 1 ? "mes" : "meses"} antes</b>
    y te ahorras ${monto(mejor.interesesMenos)} de intereses.</div>`;
}

function vistaFijos() {
  const { datos, hoy } = app;
  const total = totalFijosMensual(datos, hoy);
  const descubiertas = porRegistrar(datos, hoy);
  const recurrente = totalRecurrenteMensual(datos, hoy);

  // Encontradas solas en el historial. No se registran sin permiso: se proponen.
  const propuestas = descubiertas.length
    ? `<div class="titulo-seccion">Esto se repite y no lo tienes aquí</div>
       <div class="tarjeta">${descubiertas.map((r) => `
        <div class="fila apilada">
          <div class="linea"><div class="nombre">${esc(r.nombre)}</div><div class="monto">${monto(r.monto)}</div></div>
          <div class="sub">${esc(r.veredicto.motivo)}</div>
          <div class="acciones-fila">
            <button class="boton chico" data-accion="fijar-recurrente" data-clave="${esc(r.clave)}">Hacerlo fijo</button>
          </div>
        </div>`).join("")}
        <div class="rotulo">${esc(recurrente.veredicto.motivo)}</div>
       </div>`
    : "";

  const fijos = datos.fijos.length
    ? datos.fijos
        .map((f) => {
          const pagado = (datos.movimientos[mesDe(hoy)] || []).some((m) => m.fijoId === f.id);
          const deuda = f.deudaId ? datos.deudas.find((d) => d.id === f.deudaId) : null;
          const mensual = montoMensualizado(f);
          // Dos líneas a propósito: en un teléfono, nombre + monto + dos botones en la misma
          // fila deja el nombre partido a la mitad.
          return `<div class="fila apilada">
            <div class="linea"><div class="nombre">${esc(f.nombre)}</div><div class="monto">${monto(f.monto)}</div></div>
            <div class="sub">día ${f.diaCorte} · ${esc(comoFrecuencia(f))}${pagado ? " · pagado este mes" : ""}${
              deuda ? ` · abona a ${esc(deuda.nombre)}` : ""
            }${(f.frecuencia || 1) > 1 && mensual !== null ? ` · ${monto(mensual)} al mes` : ""}</div>
            <div class="acciones-fila">
              ${!pagado && f.monto !== null && venceEnMes(f, mesDe(hoy))
                ? `<button class="boton chico" data-accion="pagar-fijo" data-id="${esc(f.id)}"
                     data-fecha="${esc(vencimientoEnMes(mesDe(hoy), f.diaCorte))}">Pagué</button>`
                : ""}
              <button class="boton chico tenue" data-accion="editar-fijo" data-id="${esc(f.id)}">Editar</button>
            </div>
          </div>`;
        })
        .join("")
    : vacio("Sin pagos fijos capturados.");

  const deudas = datos.deudas.length
    ? datos.deudas
        .map((d) => {
          const plan = planDeDeuda(datos, d);
          return `<div class="tarjeta">
            <div class="fila" style="border-bottom:0;padding:0">
              <div class="crece"><div class="nombre">${esc(d.nombre)}</div>
                <div class="sub">${plan.pagos} pago(s) · abonado ${monto(plan.pagado)}${
                  plan.pago.origen === "fijo" ? ` · ${monto(plan.pago.monto)} al mes` : ""
                }</div></div>
              <div class="monto">${monto(plan.saldo)}</div>
            </div>
            ${veredictoHTML(plan.veredicto)}
            ${tarjetaPagarMas(datos, d, plan)}
            <div class="acciones">
              <button class="boton chico" data-accion="pagar-deuda" data-id="${esc(d.id)}">Registrar pago</button>
              <button class="boton chico tenue" data-accion="editar-deuda" data-id="${esc(d.id)}">Editar</button>
            </div>
          </div>`;
        })
        .join("")
    : `<div class="tarjeta">${vacio("Sin deudas capturadas.")}</div>`;

  return `${tarjetaCifra({
    rotulo: "Comprometido cada mes",
    valor: monto(total.mensualizado),
    extra:
      total.esteMes !== total.mensualizado
        ? `<div class="rotulo">Este mes en concreto se pagan ${monto(total.esteMes)}: el promedio reparte los pagos que no son mensuales.</div>`
        : "",
    veredicto: total.veredicto,
  })}
    ${propuestas}
    <div class="titulo-seccion">Pagos fijos</div><div class="tarjeta">${fijos}</div>
    <div class="acciones"><button class="boton tenue" data-accion="nuevo-fijo">Nuevo fijo</button></div>
    <div class="titulo-seccion">Deudas</div>${deudas}
    <div class="acciones"><button class="boton tenue" data-accion="nueva-deuda">Nueva deuda</button></div>`;
}

// --- Vista: Ajustes ---

function vistaAjustes() {
  const { perfil } = app.datos;
  const estado = app.almacen ? app.almacen.estado() : {};
  const movimientos = Object.values(app.datos.movimientos).reduce((t, l) => t + l.length, 0);

  // Lo que la app aprendió tiene que poder mirarse y borrarse. Una app que decide por ti sin
  // enseñarte con qué regla lo decidió es una caja negra, y esto toca tu dinero.
  // El puente se descubre, no se importa: si alguien borró almacen/puente-correo.js, esto da
  // undefined, la sección no se pinta, y la app no se entera de que faltaba nada.
  const hayPuente = typeof traerAvisos === "function" && typeof configuracionDelPuente === "function";
  const puente = hayPuente ? configuracionDelPuente() : null;
  const seccionPuente = hayPuente
    ? `<div class="titulo-seccion">Traer de mi correo</div>
       <div class="tarjeta">
         <div class="rotulo">Un script tuyo, dentro de tu cuenta de Google, le pasa a Grip los
           avisos de tus bancos. Las instrucciones están en la carpeta <code>puente/</code> del
           repositorio. La dirección y el token se guardan solo en este dispositivo.</div>
         <div class="fila"><div class="crece">
           <div class="nombre">${puente.url ? "Puente configurado" : "Sin configurar"}</div>
           <div class="sub">${puente.url ? esc(puente.url.slice(0, 42)) + "…" : "pega la dirección que termina en /exec"}</div>
         </div>
         <button class="boton chico tenue" data-accion="configurar-puente">${puente.url ? "Cambiar" : "Configurar"}</button></div>
         ${puente.url ? `<div class="acciones"><button class="boton" data-accion="traer-del-puente">Traer ahora</button></div>` : ""}
         <div class="rotulo" style="margin-top:10px"><b>Llegan completos:</b>
           ${esc(bancosQueAvisan().map((b) => b.nombre).join(", "))}.</div>
         ${bancosParciales().map((b) => `<div class="rotulo aviso-linea">
           <b>${esc(b.nombre)}:</b> ${esc(b.nota)}. Para lo que no llegue, compártele el aviso a
           Grip desde el celular.</div>`).join("")}
       </div>`
    : "";

  const reglas = reglasAprendidas(app.datos);
  const loAprendido = reglas.length
    ? `<div class="titulo-seccion">Lo que aprendí de ti</div>
       <div class="tarjeta">
         <div class="rotulo">Cuando un aviso venga de estos lugares, le pongo esta categoría sola.</div>
         ${reglas.map((r) => {
           const categoria = categoriaPorId(app.datos, r.categoriaId);
           return `<div class="fila">
             <div class="crece"><div class="nombre">${esc(r.clave)}</div>
               <div class="sub">${esc(categoria ? `${categoria.emoji} ${categoria.nombre}` : r.categoriaId)}${r.veces > 1 ? ` · ${r.veces} veces` : ""}</div></div>
             <button class="boton chico tenue" data-accion="olvidar-regla" data-clave="${esc(r.clave)}">Olvidar</button>
           </div>`;
         }).join("")}
       </div>`
    : "";

  return `<div class="tarjeta">
      <div class="fila"><div class="crece"><div class="nombre">Ingreso por quincena</div>
        <div class="sub">lo que entra cada 15 días</div></div>
        <button class="boton chico tenue" data-accion="editar-ingreso">${monto(perfil.ingresoQuincenal)}</button></div>
      <div class="fila"><div class="crece"><div class="nombre">Días de corte</div>
        <div class="sub">${perfil.cortes.length ? `quincenal (día ${perfil.cortes.join(", ")} y fin de mes)` : "mensual"}</div></div>
        <button class="boton chico tenue" data-accion="editar-cortes">Cambiar</button></div>
      <div class="fila"><div class="crece"><div class="nombre">Fondo de emergencia</div>
        <div class="sub">cuánto quieres tener guardado para imprevistos</div></div>
        <button class="boton chico tenue" data-accion="editar-colchon">${monto(perfil.colchonObjetivo)}</button></div>
      <div class="fila"><div class="crece"><div class="nombre">Tema</div>
        <div class="sub">claro, oscuro o el del sistema</div></div>
        <button class="boton chico tenue" data-accion="cambiar-tema">Cambiar</button></div>
    </div>

    ${seccionPuente}
    ${loAprendido}

    <div class="titulo-seccion">Tus datos</div>
    <div class="tarjeta">
      <div class="fila"><div class="crece"><div class="nombre">${movimientos} movimiento(s) guardado(s)</div>
        <div class="sub">${esc(estado.modo === MODOS.SINCRONIZADO ? "en este dispositivo y sincronizados" : `en este dispositivo (${estado.tipoLocal || "—"})`)}</div></div></div>
      <div class="acciones">
        <button class="boton tenue" data-accion="exportar">Descargar respaldo</button>
        <button class="boton tenue" data-accion="importar">Importar</button>
      </div>
      <div class="acciones"><button class="boton peligro" data-accion="borrar-todo">Borrar todo</button></div>
      <div class="rotulo" style="margin-top:10px">El respaldo es un JSON con todo dentro. Es tuyo y sirve para llevártelo a donde quieras.</div>
    </div>`;
}

// --- Hojas (formularios) ---

let cerrarHoja = null;

function abrirHoja({ titulo, campos, textoGuardar = "Guardar", alGuardar, extra = "", peligro = false }) {
  const contenedor = document.getElementById("hojas");

  contenedor.innerHTML = `<div class="velo" data-velo="1"><form class="hoja" novalidate>
      <h2>${esc(titulo)}</h2>
      <div id="error-hoja"></div>
      ${campos.map(campoHTML).join("")}
      ${extra}
      <div class="acciones">
        <button type="button" class="boton tenue" data-accion="cerrar-hoja">Cancelar</button>
        <button type="submit" class="boton${peligro ? " peligro" : ""}">${esc(textoGuardar)}</button>
      </div>
    </form></div>`;

  const formulario = contenedor.querySelector("form");
  cerrarHoja = () => {
    contenedor.innerHTML = "";
    cerrarHoja = null;
  };

  contenedor.querySelector(".velo").addEventListener("click", (e) => {
    if (e.target.dataset.velo) cerrarHoja();
  });

  // Lo que hay escrito ahora mismo, sin validar: sirve para no perder lo tecleado cuando
  // la hoja cambia de forma (elegir "Ingreso" quita las categorías, por ejemplo).
  const leerCrudo = () => {
    const valores = {};
    for (const campo of campos) {
      const nodo = formulario.querySelector(`[data-clave="${campo.clave}"]`);
      if (nodo) valores[campo.clave] = campo.tipo === "chips" ? nodo.dataset.valor || "" : nodo.value;
    }
    return valores;
  };

  formulario.querySelectorAll(".chips").forEach((grupo) => {
    const campo = campos.find((c) => c.clave === grupo.dataset.clave);
    grupo.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        grupo.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
        chip.setAttribute("aria-pressed", "true");
        grupo.dataset.valor = chip.dataset.valor;
        if (campo && campo.alCambiar) campo.alCambiar(chip.dataset.valor, leerCrudo());
      });
    });
  });

  formulario.addEventListener("submit", async (e) => {
    e.preventDefault();
    const valores = {};
    for (const campo of campos) {
      const nodo = formulario.querySelector(`[data-clave="${campo.clave}"]`);
      const crudo = campo.tipo === "chips" ? nodo.dataset.valor || "" : nodo.value.trim();

      if (campo.tipo === "monto") {
        const centavos = aCentavos(crudo);
        if (centavos === null && campo.requerido) return error(`Falta ${campo.etiqueta.toLowerCase()}.`);
        valores[campo.clave] = centavos;
      } else if (campo.tipo === "numero") {
        valores[campo.clave] = crudo === "" ? null : Number(crudo);
      } else {
        if (!crudo && campo.requerido) return error(`Falta ${campo.etiqueta.toLowerCase()}.`);
        valores[campo.clave] = crudo || null;
      }
    }

    let problema = null;
    try {
      problema = await alGuardar(valores);
    } catch (e) {
      problema = (e && e.message) || "No se pudo guardar.";
    }
    if (problema) return error(problema);
    if (cerrarHoja) cerrarHoja();
  });

  const primero = formulario.querySelector("input:not([type=hidden])");
  if (primero) primero.focus();

  function error(texto) {
    formulario.querySelector("#error-hoja").innerHTML = `<div class="aviso malo">${esc(texto)}</div>`;
  }
}

/**
 * Confirmación propia. No se usa `confirm()` del navegador: en un contexto aislado
 * (un iframe restringido, por ejemplo) lanza SecurityError y se lleva la acción por delante.
 */
function confirmar({ titulo, mensaje, textoBoton, alConfirmar }) {
  abrirHoja({
    titulo,
    campos: [],
    textoGuardar: textoBoton,
    peligro: true,
    extra: `<p class="rotulo" style="margin:0 0 4px">${esc(mensaje)}</p>`,
    alGuardar: alConfirmar,
  });
}

function campoHTML(campo) {
  const id = `campo-${campo.clave}`;
  const valor = campo.valor === null || campo.valor === undefined ? "" : campo.valor;

  if (campo.tipo === "chips") {
    return `<div class="campo"><label>${esc(campo.etiqueta)}</label>
      <div class="chips" data-clave="${campo.clave}" data-valor="${esc(valor)}">
        ${campo.opciones
          .map(
            (o) => `<button type="button" class="chip" data-valor="${esc(o.valor)}" aria-pressed="${o.valor === valor}">
              ${esc(o.etiqueta)}</button>`,
          )
          .join("")}
      </div></div>`;
  }

  if (campo.tipo === "select") {
    return `<div class="campo"><label for="${id}">${esc(campo.etiqueta)}</label>
      <select id="${id}" data-clave="${campo.clave}">
        ${campo.opciones.map((o) => `<option value="${esc(o.valor)}" ${o.valor === valor ? "selected" : ""}>${esc(o.etiqueta)}</option>`).join("")}
      </select></div>`;
  }

  const tipos = { monto: "text", texto: "text", fecha: "date", numero: "number", mes: "month" };
  const extras =
    campo.tipo === "monto"
      ? 'inputmode="decimal" class="monto" placeholder="0.00"'
      : campo.tipo === "numero"
        ? 'inputmode="numeric"'
        : "";

  return `<div class="campo"><label for="${id}">${esc(campo.etiqueta)}</label>
    <input id="${id}" data-clave="${campo.clave}" type="${tipos[campo.tipo] || "text"}" value="${esc(valor)}" ${extras}>
    ${campo.ayuda ? `<div class="rotulo" style="margin-top:5px">${esc(campo.ayuda)}</div>` : ""}</div>`;
}

function opcionesCategorias() {
  return app.datos.categorias.filter((c) => !c.archivada).map((c) => ({ valor: c.id, etiqueta: `${c.emoji} ${c.nombre}` }));
}

/** Días que se conserva un aviso ya resuelto antes de tirarlo. */
const DIAS_DE_BANDEJA = 60;

/** Días que se conserva una lápida. Más que un aviso, a propósito: tiene que sobrevivir a que
 *  el otro dispositivo pase meses sin abrirse, o resucitaría lo que se borró aquí. */
const DIAS_DE_LAPIDA = 180;

/**
 * Vacía de la bandeja lo ya resuelto y viejo, cada vez que se abre la app.
 *
 * Sin esto la bandeja crece para siempre, y no es un problema estético: todo lo que no son
 * movimientos viaja junto en UN documento cuando hay sincronización, y ese documento tiene
 * tope. Medido, cada entrada pesa ~458 B; sin purgar, la sincronización se rompería alrededor
 * de las 570 entradas — cosa de un año trayendo correos.
 *
 * Lo PENDIENTE nunca se tira, por viejo que sea: eso sigue siendo trabajo sin hacer.
 */
async function tirarLoViejo() {
  if (!app.almacen || app.bloqueado) return;
  const antes = (app.datos.bandeja || []).length;
  const limpio = purgarBorrados(
    purgarBandeja(app.datos, sumarDias(app.hoy, -DIAS_DE_BANDEJA)),
    sumarDias(app.hoy, -DIAS_DE_LAPIDA),
  );
  const lapidasAntes = (app.datos.borrados || []).length;
  if (limpio.bandeja.length === antes && limpio.borrados.length === lapidasAntes) return;
  try {
    app.datos = await app.almacen.guardar(limpio);
  } catch (e) {
    app.datos = limpio; // que no se pueda guardar la limpieza no debe tumbar el arranque
  }
}

/**
 * Lo que llegó por "Compartir" desde el celular.
 *
 * Con la app instalada en Android, compartirle un correo del banco la abre con el texto en
 * la dirección. Se lee, cae en la bandeja, y la dirección se limpia: si después recarga la
 * página, no se vuelve a leer el mismo aviso y a duplicarlo.
 *
 * Es la única vía que sirve para bancos que solo notifican dentro de su app, como Nu.
 */
async function atenderCompartido() {
  let texto = "";
  try {
    const params = new URLSearchParams(location.search);
    texto = [params.get("texto"), params.get("titulo"), params.get("enlace")].filter(Boolean).join("\n").trim();
    if (texto) history.replaceState(null, "", location.pathname);
  } catch (e) {
    return; // en un contexto sin acceso a la dirección esto simplemente no aplica
  }
  if (!texto) return;

  app.vista = "bandeja";
  const { datos, entrada, duplicado, error } = recibirAviso(app.datos, texto, "", ORIGENES.COMPARTIDO, app.hoy);

  // El orden importa: lo primero es si hubo ENTRADA, no si hubo error. Un aviso que no se
  // supo leer deja entrada igual —esperando que digas cuánto y dónde— y preguntar por el
  // error antes salía de aquí sin guardarla, o sea tirando lo que se acababa de rescatar.
  if (!entrada) {
    app.aviso = error
      ? `No pude leer lo que compartiste: ${error.motivo}`
      : duplicado ? duplicado.motivo : "Ese aviso ya estaba.";
    return render();
  }
  if (error) app.aviso = "No supe leer ese aviso, pero lo guardé: dime cuánto y dónde.";
  try {
    await guardar(datos);
  } catch (e) {
    // `guardar` ya avisó y revirtió. Que falle el disco no debe tirar el arranque.
  }
}

// --- Acciones ---

async function guardar(datos) {
  if (!app.almacen) throw new Error("La app todavía está abriendo tus datos. Intenta otra vez en un segundo.");

  const previos = app.datos;
  app.datos = datos; // optimista: la pantalla responde al instante
  render();

  try {
    app.datos = await app.almacen.guardar(datos);
    app.aviso = null;
  } catch (e) {
    // Nada de fallar en silencio: se revierte la pantalla y se dice qué pasó.
    app.datos = previos;
    app.aviso = `No se pudo guardar: ${e.message}`;
    app.bloqueado = true;
    render();
    throw e;
  }
  render();
}

const acciones = {
  ir(el) {
    app.vista = el.dataset.vista;
    if (app.vista === "bandeja") app.verBandeja = ENTRADAS_POR_TANDA;
    render();
  },

  "cerrar-aviso"() {
    app.aviso = null;
    render();
  },

  "ver-estado"() {
    app.aviso = textoDelAlmacenamiento(app.almacen.estado());
    render();
  },

  capturar() {
    hojaMovimiento();
  },

  async "leer-aviso"() {
    const caja = document.getElementById("aviso");
    const texto = (caja ? caja.value : app.borrador).trim();
    if (!texto) {
      app.aviso = "Pega primero el texto del aviso.";
      return render();
    }
    const { datos, entrada, duplicado, error } = recibirAviso(app.datos, texto, "", ORIGENES.PEGADO, app.hoy);
    if (error) {
      app.aviso = `${error.motivo} ${error.datos.falta ? `→ ${error.datos.falta}` : ""}`.trim();
      return render();
    }
    if (!entrada) {
      app.aviso = duplicado ? duplicado.motivo : "Ese aviso ya estaba.";
      return render();
    }
    app.aviso = duplicado ? duplicado.motivo : null;
    app.borrador = ""; // ya está en la bandeja: dejarlo ahí invitaría a leerlo dos veces
    await guardar(datos);
  },

  "configurar-puente"() {
    const actual = configuracionDelPuente();
    abrirHoja({
      titulo: "Puente de correo",
      textoGuardar: "Guardar",
      extra: `<p class="rotulo" style="margin:0 0 4px">Déjalo en blanco para desconectarlo. Borrar
        esto no borra nada de lo que ya está capturado.</p>`,
      campos: [
        { clave: "url", etiqueta: "Dirección del puente (…/exec)", tipo: "texto", valor: actual.url },
        { clave: "token", etiqueta: "Token", tipo: "texto", valor: actual.token },
      ],
      async alGuardar(v) {
        if (!guardarConfiguracionDelPuente({ url: v.url, token: v.token })) {
          return "Este navegador no deja guardar ajustes en el dispositivo.";
        }
        render();
        return null;
      },
    });
  },

  async "traer-del-puente"(el) {
    const config = configuracionDelPuente();
    el.disabled = true;
    el.textContent = "Buscando…";

    const { avisos, error } = await traerAvisos({ url: config.url, token: config.token, dias: 3 });
    if (error) {
      app.aviso = error;
      return render();
    }

    // Se leen todos y se guarda UNA vez: un guardado por correo dejaría la pantalla
    // parpadeando y multiplicaría las escrituras por nada.
    let datos = app.datos;
    let nuevos = 0, repetidos = 0, sinLeer = 0;
    for (const aviso of avisos) {
      const texto = [aviso.asunto, aviso.texto].filter(Boolean).join("\n");
      const paso = recibirAviso(datos, texto, aviso.remitente || "", ORIGENES.CORREO, app.hoy);

      // Lo que importa es si hubo ENTRADA, no si hubo error. Un aviso que no se pudo leer
      // ahora deja entrada igual, esperando que digas cuánto y dónde; antes se contaba como
      // "ilegible" y el correo se tiraba aquí mismo, con el gasto adentro.
      if (!paso.entrada) {
        repetidos++;
        continue;
      }
      datos = paso.datos;
      if (paso.entrada.estado === ESTADOS_BANDEJA.ILEGIBLE) sinLeer++;
      else nuevos++;
    }

    const total = nuevos + sinLeer;
    app.vista = "bandeja";
    app.aviso = total
      ? `${nuevos} ${nuevos === 1 ? "aviso nuevo" : "avisos nuevos"} en la bandeja.` +
        (sinLeer ? ` ${sinLeer} que no supe leer y ${sinLeer === 1 ? "espera" : "esperan"} tus datos.` : "") +
        (repetidos ? ` ${repetidos} ya los tenías.` : "")
      : avisos.length
        ? `Revisé ${avisos.length} ${avisos.length === 1 ? "correo" : "correos"} y no hay nada nuevo.`
        : "No encontré avisos de tus bancos en los últimos días.";

    if (total) await guardar(datos);
    else render();
  },

  async "fijar-recurrente"(el) {
    const encontrada = porRegistrar(app.datos, app.hoy).find((r) => r.clave === el.dataset.clave);
    if (!encontrada) return;
    const fijo = fijoDesdeRecurrente(encontrada);
    await guardar({ ...app.datos, fijos: [...app.datos.fijos, { ...fijo, id: idNuevo("fijo") }] });
  },

  async "olvidar-regla"(el) {
    await guardar(olvidar(app.datos, el.dataset.clave));
  },

  "ver-mas-bandeja"() {
    app.verBandeja += ENTRADAS_POR_TANDA;
    render();
  },

  "elegir-categoria"(el) {
    app.eleccion = { ...app.eleccion, [el.dataset.id]: el.dataset.categoria };
    render();
  },

  async "reemplazar-entrada"(el) {
    return acciones["aceptar-entrada"](el, true);
  },

  async "aceptar-entrada"(el, reemplazar = false) {
    const id = el.dataset.id;
    const cambios = app.eleccion[id] !== undefined ? { categoria: app.eleccion[id] } : {};
    if (reemplazar) cambios.reemplazar = true;
    const { datos, error } = aceptarEntrada(app.datos, id, cambios, app.hoy);
    if (error) {
      app.aviso = error;
      return render();
    }
    const { [id]: quitada, ...resto } = app.eleccion;
    app.eleccion = resto;
    await guardar(datos);
  },

  "editar-entrada"(el) {
    const entrada = app.datos.bandeja.find((e) => e.id === el.dataset.id);
    if (!entrada) return;
    const categoria = app.eleccion[entrada.id] !== undefined ? app.eleccion[entrada.id] : entrada.movimiento.categoria;
    hojaMovimiento({
      tipo: entrada.movimiento.tipo,
      entradaId: entrada.id,
      valores: {
        monto: comoCampo(entrada.movimiento.monto),
        categoria,
        nota: entrada.movimiento.nota,
        fecha: entrada.movimiento.fecha,
      },
    });
  },

  async "guardar-ilegible"(el) {
    const id = el.dataset.id;
    const entrada = app.datos.bandeja.find((e) => e.id === id);
    if (!entrada) return;

    const centavos = aCentavos((document.getElementById(`ileg-monto-${id}`) || {}).value || "");
    const nota = ((document.getElementById(`ileg-nota-${id}`) || {}).value || "").trim();

    // Sin monto no hay movimiento que registrar. Se dice y se deja la entrada donde está, en
    // vez de aceptar un cero disfrazado de dato.
    if (!Number.isFinite(centavos) || centavos <= 0) {
      app.aviso = "Falta el monto: es lo único que no puedo adivinar.";
      return render();
    }

    const { datos, error } = aceptarEntrada(app.datos, id, {
      monto: centavos,
      nota: nota || (entrada.banco ? nombreDeBanco(entrada.banco) : "Sin nombre"),
      categoria: "otros",
    }, app.hoy);

    if (error) {
      app.aviso = error;
      return render();
    }
    app.aviso = nota
      ? `Guardado. Y ya aprendí: el siguiente aviso de ${nota} entra con su categoría.`
      : "Guardado.";
    await guardar(datos);
  },

  "descartar-entrada"(el) {
    const entrada = app.datos.bandeja.find((e) => e.id === el.dataset.id);
    if (!entrada) return;
    // Una entrada ilegible no trae movimiento: pedirle el monto aquí tumbaba la pantalla.
    const que = entrada.movimiento
      ? `${entrada.comercio || "Este movimiento"} por ${monto(entrada.movimiento.monto)}`
      : `${entrada.resumen || "Este aviso"}`;
    confirmar({
      titulo: "Descartar",
      mensaje: `${que} no se registrará, y no vuelvo a preguntar por él.`,
      textoBoton: "Descartar",
      alConfirmar: async () => {
        await guardar(descartarEntrada(app.datos, entrada.id));
        return null;
      },
    });
  },

  async "deshacer-entrada"(el) {
    await guardar(deshacerEntrada(app.datos, el.dataset.id));
  },

  "editar-movimiento"(el) {
    const movimiento = buscarMovimiento(el.dataset.id);
    if (movimiento) hojaMovimiento({ tipo: movimiento.tipo, movimiento });
  },

  "ver-historial"() {
    app.vista = "historial";
    app.filtro = { texto: "", tipo: "" };
    render();
  },

  "filtrar-tipo"(el) {
    app.filtro = { ...(app.filtro || { texto: "" }), tipo: el.dataset.tipo };
    render();
    const caja = document.getElementById("buscador");
    if (caja) caja.focus();
  },

  "editar-ingreso"() {
    abrirHoja({
      titulo: "Ingreso por quincena",
      campos: [
        {
          clave: "monto", etiqueta: "Cuánto entra cada quincena", tipo: "monto",
          valor: app.datos.perfil.ingresoQuincenal === null ? "" : (app.datos.perfil.ingresoQuincenal / 100).toFixed(2),
          requerido: true, ayuda: "Si varía, pon lo que entra seguro. Lo de más se captura como ingreso extra.",
        },
      ],
      async alGuardar(v) {
        await guardar({ ...app.datos, perfil: { ...app.datos.perfil, ingresoQuincenal: v.monto } });
      },
    });
  },

  "editar-colchon"() {
    const fijos = totalFijosMensual(app.datos, app.hoy);
    const referencia = fijos.mensualizado > 0 ? `Tres meses de tus fijos actuales son ${formatear(fijos.mensualizado * 3)}.` : "";
    abrirHoja({
      titulo: "Fondo de emergencia",
      campos: [
        {
          clave: "monto", etiqueta: "Cuánto quieres tener guardado", tipo: "monto",
          valor: comoCampo(app.datos.perfil.colchonObjetivo),
          ayuda: `${referencia} Déjalo vacío para quitar el objetivo.`.trim(),
        },
      ],
      async alGuardar(v) {
        await guardar({ ...app.datos, perfil: { ...app.datos.perfil, colchonObjetivo: v.monto } });
      },
    });
  },

  "editar-cortes"() {
    abrirHoja({
      titulo: "Cómo entra tu dinero",
      campos: [
        {
          clave: "modo", etiqueta: "Ritmo", tipo: "chips", valor: app.datos.perfil.cortes.length ? "quincenal" : "mensual",
          opciones: [{ valor: "quincenal", etiqueta: "Quincenal (15 y fin de mes)" }, { valor: "mensual", etiqueta: "Mensual" }],
        },
      ],
      async alGuardar(v) {
        await guardar({ ...app.datos, perfil: { ...app.datos.perfil, cortes: v.modo === "mensual" ? [] : [15] } });
      },
    });
  },

  "cambiar-tema"() {
    const actual = document.documentElement.dataset.tema || "sistema";
    const siguiente = actual === "sistema" ? "claro" : actual === "claro" ? "oscuro" : "sistema";
    if (siguiente === "sistema") delete document.documentElement.dataset.tema;
    else document.documentElement.dataset.tema = siguiente;
    try { localStorage.setItem("finanzas:tema", siguiente); } catch (e) {}
    app.aviso = `Tema: ${siguiente}.`;
    render();
  },

  "editar-tope"(el) {
    const categoria = categoriaPorId(app.datos, el.dataset.id);
    const mes = mesDe(app.hoy);

    abrirHoja({
      titulo: categoria.nombre,
      campos: [
        { clave: "nombre", etiqueta: "Nombre", tipo: "texto", valor: categoria.nombre, requerido: true },
        { clave: "emoji", etiqueta: "Emoji", tipo: "texto", valor: categoria.emoji },
        {
          clave: "tope", etiqueta: "Tope mensual", tipo: "monto",
          valor: comoCampo(topeVigente(app.datos, mes, categoria.id)),
          ayuda: "Déjalo vacío para quitarle el tope. Sin tope no hay semáforo.",
        },
        {
          clave: "alcance", etiqueta: "Ese tope aplica", tipo: "chips", valor: "siempre",
          opciones: [
            { valor: "siempre", etiqueta: "De aquí en adelante" },
            { valor: "mes", etiqueta: "Solo este mes" },
          ],
        },
      ],
      extra: `<button type="button" class="boton chico peligro" data-accion="archivar-categoria" data-id="${esc(categoria.id)}">
        Archivar esta categoría</button>`,
      async alGuardar(v) {
        const categorias = app.datos.categorias.map((c) =>
          c.id === categoria.id
            ? { ...c, nombre: v.nombre, emoji: v.emoji || "•", tope: v.alcance === "mes" ? c.tope : v.tope }
            : c,
        );

        // Un tope "solo este mes" no toca el catálogo: el histórico de los otros meses
        // queda exactamente como estaba.
        const presupuestos = { ...app.datos.presupuestos };
        if (v.alcance === "mes") {
          const delMes = { ...(presupuestos[mes] || {}) };
          if (v.tope === null) delete delMes[categoria.id];
          else delMes[categoria.id] = v.tope;
          presupuestos[mes] = delMes;
        }

        await guardar({ ...app.datos, categorias, presupuestos });
      },
    });
  },

  "archivar-categoria"(el) {
    const categoria = categoriaPorId(app.datos, el.dataset.id);
    confirmar({
      titulo: `¿Archivar "${categoria.nombre}"?`,
      mensaje: "Deja de aparecer al capturar, pero los gastos que ya tiene se conservan en tu historial.",
      textoBoton: "Sí, archivar",
      alConfirmar: async () => {
        const categorias = app.datos.categorias.map((c) => (c.id === categoria.id ? { ...c, archivada: true } : c));
        await guardar({ ...app.datos, categorias });
      },
    });
  },

  "editar-topes"() {
    app.vista = "presupuesto";
    render();
  },

  "nueva-categoria"() {
    abrirHoja({
      titulo: "Nueva categoría",
      campos: [
        { clave: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true },
        { clave: "emoji", etiqueta: "Emoji", tipo: "texto", valor: "•" },
        { clave: "tope", etiqueta: "Tope mensual (opcional)", tipo: "monto" },
        {
          clave: "clase", etiqueta: "Tipo", tipo: "chips", valor: "variable",
          opciones: [{ valor: "variable", etiqueta: "Variable" }, { valor: "fija", etiqueta: "Fija" }],
        },
      ],
      async alGuardar(v) {
        const id = `cat_${v.nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        if (categoriaPorId(app.datos, id)) return "Ya existe una categoría con ese nombre.";
        const categorias = [...app.datos.categorias, { id, nombre: v.nombre, emoji: v.emoji || "•", clase: v.clase, tope: v.tope, archivada: false }];
        await guardar({ ...app.datos, categorias });
      },
    });
  },

  "nueva-meta"() {
    hojaMeta(null);
  },

  "editar-meta"(el) {
    hojaMeta(app.datos.metas.find((m) => m.id === el.dataset.id));
  },

  "borrar-meta"(el) {
    const meta = app.datos.metas.find((m) => m.id === el.dataset.id);
    confirmar({
      titulo: `¿Borrar "${meta ? meta.nombre : "la meta"}"?`,
      mensaje: "Lo que ya apartaste no se borra: sigue contando como ahorro.",
      textoBoton: "Sí, borrar la meta",
      alConfirmar: async () => {
        await guardar(marcarBorrado(
          { ...app.datos, metas: app.datos.metas.filter((m) => m.id !== el.dataset.id) },
          el.dataset.id,
        ));
      },
    });
  },

  apartar(el) {
    hojaMovimiento({ tipo: TIPOS.AHORRO, valores: { metaId: el.dataset.id } });
  },

  "nuevo-fijo"() {
    hojaFijo(null);
  },

  "editar-fijo"(el) {
    hojaFijo(app.datos.fijos.find((f) => f.id === el.dataset.id));
  },

  async "pagar-fijo"(el) {
    const fijo = app.datos.fijos.find((f) => f.id === el.dataset.id);
    if (fijo.monto === null) return acciones["editar-fijo"](el);

    // La fecha del pago es la del vencimiento, no la de hoy: registrarlo tarde no debe
    // moverlo de ciclo ni descuadrar la quincena en la que de verdad salió el dinero.
    const vencimiento = el.dataset.fecha || app.hoy;
    const { datos, error } = agregarMovimiento(app.datos, movimientoDeFijo(fijo, vencimiento));
    if (error) return;
    await guardar(datos);
  },

  "borrar-fijo"(el) {
    const fijo = app.datos.fijos.find((f) => f.id === el.dataset.id);
    confirmar({
      titulo: `¿Borrar "${fijo ? fijo.nombre : "el fijo"}"?`,
      mensaje: "Deja de contar en lo comprometido del mes. Los pagos que ya registraste no se borran.",
      textoBoton: "Sí, borrar el fijo",
      alConfirmar: async () => {
        await guardar(marcarBorrado(
          { ...app.datos, fijos: app.datos.fijos.filter((f) => f.id !== el.dataset.id) },
          el.dataset.id,
        ));
      },
    });
  },

  "borrar-deuda"(el) {
    const deuda = app.datos.deudas.find((d) => d.id === el.dataset.id);
    confirmar({
      titulo: `¿Borrar "${deuda ? deuda.nombre : "la deuda"}"?`,
      mensaje: "Los pagos que le registraste siguen en tu historial como gastos.",
      textoBoton: "Sí, borrar la deuda",
      alConfirmar: async () => {
        await guardar(marcarBorrado(
          { ...app.datos, deudas: app.datos.deudas.filter((d) => d.id !== el.dataset.id) },
          el.dataset.id,
        ));
      },
    });
  },

  "nueva-deuda"() {
    hojaDeuda(null);
  },

  "editar-deuda"(el) {
    hojaDeuda(app.datos.deudas.find((d) => d.id === el.dataset.id));
  },

  "pagar-deuda"(el) {
    const deuda = app.datos.deudas.find((d) => d.id === el.dataset.id);
    abrirHoja({
      titulo: `Pago a ${deuda.nombre}`,
      campos: [
        { clave: "monto", etiqueta: "Cuánto pagaste", tipo: "monto", requerido: true },
        { clave: "fecha", etiqueta: "Fecha", tipo: "fecha", valor: app.hoy, requerido: true },
      ],
      async alGuardar(v) {
        const { datos, error } = agregarMovimiento(app.datos, {
          fecha: v.fecha, monto: v.monto, tipo: TIPOS.GASTO, categoria: "deuda", deudaId: deuda.id, nota: `Pago: ${deuda.nombre}`,
        });
        if (error) return error;
        await guardar(datos);
      },
    });
  },

  async "borrar-movimiento"(el) {
    await guardar(eliminarMovimiento(app.datos, el.dataset.id));
  },

  async exportar() {
    const texto = exportar(app.datos);
    const nombre = nombreDeRespaldo(app.hoy);

    // Hay visores donde un enlace de descarga no hace absolutamente nada. Si el anfitrión
    // sabe entregar archivos, que lo entregue él; si no, el enlace de toda la vida, que es
    // lo que funciona con la app abierta desde el disco.
    const entregado =
      typeof descargarEnAnfitrion === "function" ? await descargarEnAnfitrion({ nombre, texto }) : false;

    if (!entregado) {
      const enlace = document.createElement("a");
      enlace.href = URL.createObjectURL(new Blob([texto], { type: "application/json" }));
      enlace.download = nombre;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
    }

    // Queda anotado: es lo que apaga el recordatorio y lo que hace que vuelva en 30 días.
    await guardar({ ...app.datos, ultimoRespaldo: new Date().toISOString() });
    app.aviso = `Respaldo listo: ${nombre}. Es un JSON con todo dentro; guárdalo donde tú quieras.`;
    render();
  },

  importar() {
    const entrada = document.createElement("input");
    entrada.type = "file";
    entrada.accept = "application/json,.json";
    entrada.addEventListener("change", async () => {
      const archivo = entrada.files[0];
      if (!archivo) return;
      const resultado = importar(await archivo.text());
      if (!resultado.ok) {
        app.aviso = resultado.motivo;
        app.bloqueado = true;
        return render();
      }
      await guardar(resultado.datos);
      app.aviso = "Respaldo importado.";
      app.bloqueado = false;
      render();
    });
    entrada.click();
  },

  "borrar-todo"() {
    confirmar({
      titulo: "¿Borrar TODO?",
      mensaje: "Esto no se puede deshacer. Si lo quieres conservar, descarga primero un respaldo.",
      textoBoton: "Sí, borrar todo",
      alConfirmar: async () => {
        await app.almacen.borrarTodo();
        app.bloqueado = false;
        await guardar(datosVacios(app.hoy));
        app.aviso = "Todo borrado.";
        render();
      },
    });
  },

  "cerrar-hoja"() {
    if (cerrarHoja) cerrarHoja();
  },
};

/** Centavos a lo que se teclea en un campo: 123456 → "1234.56". */
function comoCampo(centavos) {
  return centavos === null || centavos === undefined ? "" : (centavos / 100).toFixed(2);
}

function buscarMovimiento(id) {
  for (const lista of Object.values(app.datos.movimientos)) {
    const encontrado = lista.find((m) => m.id === id);
    if (encontrado) return encontrado;
  }
  return null;
}

const TIPOS_CAPTURA = [
  { valor: TIPOS.GASTO, etiqueta: "Gasto" },
  { valor: TIPOS.INGRESO, etiqueta: "Ingreso" },
  { valor: TIPOS.AHORRO, etiqueta: "Apartar" },
  { valor: TIPOS.RETIRO, etiqueta: "Retirar" },
];

/**
 * Un solo formulario para las tres cosas que mueven dinero: gasto, ingreso y apartado.
 * Cambia de forma según lo que elijas (un ingreso no tiene categoría), conservando lo que
 * ya tecleaste. También sirve para CORREGIR un movimiento: conserva su id, así que editar
 * no es borrar y volver a capturar.
 */
function hojaMovimiento(config = {}) {
  const { movimiento = null, valores = {}, entradaId = null } = config;
  const tipo = config.tipo || TIPOS.GASTO;
  const editando = Boolean(movimiento);

  const heredar = (clave, porDefecto) =>
    valores[clave] !== undefined ? valores[clave] : movimiento ? movimiento[clave] : porDefecto;

  const campos = [
    {
      clave: "tipo", etiqueta: "Qué es", tipo: "chips", valor: tipo, opciones: TIPOS_CAPTURA,
      // Al cambiar de tipo se vuelve a abrir la hoja con los campos que corresponden.
      alCambiar: (nuevo, actuales) => hojaMovimiento({ tipo: nuevo, movimiento, entradaId, valores: { ...actuales, tipo: nuevo } }),
    },
    {
      clave: "monto", etiqueta: "Monto", tipo: "monto", requerido: true,
      valor: valores.monto !== undefined ? valores.monto : movimiento ? comoCampo(movimiento.monto) : "",
    },
  ];

  if (tipo === TIPOS.GASTO) {
    campos.push({
      clave: "categoria", etiqueta: "Categoría", tipo: "chips",
      valor: heredar("categoria", "super") || "super", opciones: opcionesCategorias(),
    });
  }

  if (tipo === TIPOS.AHORRO || tipo === TIPOS.RETIRO) {
    const metas = app.datos.metas.map((m) => ({ valor: m.id, etiqueta: m.nombre }));
    campos.push({
      clave: "metaId",
      etiqueta: tipo === TIPOS.AHORRO ? "¿Para qué lo apartas?" : "¿De dónde lo sacas?",
      valor: heredar("metaId", "") || "",
      tipo: "chips",
      opciones: [{ valor: "", etiqueta: "Fondo de emergencia" }, ...metas],
    });
  }

  campos.push(
    { clave: "nota", etiqueta: "Nota (opcional)", tipo: "texto", valor: heredar("nota", "") || "" },
    { clave: "fecha", etiqueta: "Fecha", tipo: "fecha", valor: heredar("fecha", app.hoy), requerido: true },
  );

  const nombres = { [TIPOS.GASTO]: "gasto", [TIPOS.INGRESO]: "ingreso", [TIPOS.AHORRO]: "apartado", [TIPOS.RETIRO]: "retiro" };

  abrirHoja({
    titulo: editando ? "Corregir movimiento" : `Capturar ${nombres[tipo]}`,
    textoGuardar: editando ? "Guardar cambios" : "Guardar",
    extra: editando
      ? `<button type="button" class="boton chico peligro" data-accion="borrar-movimiento" data-id="${esc(movimiento.id)}">Borrar este movimiento</button>`
      : "",
    campos,
    async alGuardar(v) {
      // Editar algo que vino de la bandeja no crea un movimiento suelto: acepta la entrada
      // con las correcciones. Así la bandeja se vacía y la app aprende de lo que corrigió.
      if (entradaId) {
        const { datos, error } = aceptarEntrada(app.datos, entradaId, {
          fecha: v.fecha, monto: v.monto, tipo: v.tipo || tipo,
          categoria: (v.tipo || tipo) === TIPOS.GASTO ? v.categoria : null,
          nota: v.nota, metaId: v.metaId || null,
        }, app.hoy);
        if (error) return error;
        await guardar(datos);
        return null;
      }
      const base = editando ? eliminarMovimiento(app.datos, movimiento.id) : app.datos;
      const { datos, error } = agregarMovimiento(base, {
        id: editando ? movimiento.id : undefined,
        fecha: v.fecha,
        monto: v.monto,
        tipo: v.tipo || tipo,
        categoria: (v.tipo || tipo) === TIPOS.GASTO ? v.categoria || "otros" : null,
        metaId: [TIPOS.AHORRO, TIPOS.RETIRO].includes(v.tipo || tipo) ? v.metaId : null,
        nota: v.nota,
        fijoId: editando ? movimiento.fijoId : null,
        deudaId: editando ? movimiento.deudaId : null,
      });
      if (error) return error;
      await guardar(datos);
    },
  });
}

function hojaMeta(meta) {
  abrirHoja({
    titulo: meta ? `Editar ${meta.nombre}` : "Nueva meta",
    campos: [
      { clave: "nombre", etiqueta: "Para qué", tipo: "texto", valor: meta ? meta.nombre : "", requerido: true },
      {
        clave: "objetivo", etiqueta: "Cuánto necesitas", tipo: "monto",
        valor: meta && meta.objetivo !== null ? (meta.objetivo / 100).toFixed(2) : "", requerido: true,
      },
      {
        clave: "fechaLimite", etiqueta: "Para cuándo", tipo: "fecha", valor: meta ? meta.fechaLimite : "",
        ayuda: "Sin fecha no hay cuánto por quincena: la app te lo dirá en vez de inventarlo.",
      },
    ],
    async alGuardar(v) {
      const nueva = {
        id: meta ? meta.id : idNuevo("meta"),
        nombre: v.nombre, objetivo: v.objetivo, fechaLimite: v.fechaLimite, prioridad: 1, lograda: false,
      };
      const metas = meta ? app.datos.metas.map((m) => (m.id === meta.id ? nueva : m)) : [...app.datos.metas, nueva];
      await guardar({ ...app.datos, metas });
    },
  });
}

function hojaFijo(fijo, valores = {}) {
  const frecuencia = Number(valores.frecuencia !== undefined ? valores.frecuencia : fijo ? fijo.frecuencia : 1) || 1;
  const campos = [
    { clave: "nombre", etiqueta: "Qué es", tipo: "texto", valor: valores.nombre !== undefined ? valores.nombre : fijo ? fijo.nombre : "", requerido: true },
    {
      clave: "monto", etiqueta: "Cuánto", tipo: "monto",
      valor: valores.monto !== undefined ? valores.monto : fijo ? comoCampo(fijo.monto) : "",
      ayuda: "Si todavía no lo sabes, déjalo vacío: la app lo contará como pendiente por capturar.",
    },
    {
      clave: "frecuencia", etiqueta: "Cada cuánto se paga", tipo: "chips", valor: String(frecuencia),
      opciones: FRECUENCIAS.map((f) => ({ valor: String(f.meses), etiqueta: f.etiqueta })),
      // Si deja de ser mensual, la hoja pide en qué mes toca: sin eso no se sabe cuándo cae.
      alCambiar: (nuevo, actuales) => hojaFijo(fijo, { ...actuales, frecuencia: nuevo }),
    },
  ];

  if (frecuencia > 1) {
    campos.push({
      clave: "mesAncla", etiqueta: "¿En qué mes toca?", tipo: "mes",
      valor: valores.mesAncla !== undefined ? valores.mesAncla : fijo && fijo.mesAncla ? fijo.mesAncla : mesDe(app.hoy),
      ayuda: "A partir de ese mes se repite con la frecuencia que elegiste.",
    });
  }

  campos.push(
    { clave: "diaCorte", etiqueta: "Qué día se paga", tipo: "numero", valor: valores.diaCorte !== undefined ? valores.diaCorte : fijo ? fijo.diaCorte : 1, requerido: true },
    { clave: "categoria", etiqueta: "Categoría", tipo: "chips", valor: valores.categoria !== undefined ? valores.categoria : fijo ? fijo.categoria : "servicios", opciones: opcionesCategorias() },
  );

  if (app.datos.deudas.length) {
    campos.push({
      clave: "deudaId", etiqueta: "¿Este pago abona a una deuda?", tipo: "chips",
      valor: valores.deudaId !== undefined ? valores.deudaId : fijo && fijo.deudaId ? fijo.deudaId : "",
      opciones: [{ valor: "", etiqueta: "No" }, ...app.datos.deudas.map((d) => ({ valor: d.id, etiqueta: d.nombre }))],
    });
  }

  abrirHoja({
    titulo: fijo ? `Editar ${fijo.nombre}` : "Nuevo pago fijo",
    campos,
    extra: fijo
      ? `<button type="button" class="boton chico peligro" data-accion="borrar-fijo" data-id="${esc(fijo.id)}">Borrar este fijo</button>`
      : "",
    async alGuardar(v) {
      const cada = Number(v.frecuencia) || 1;
      const nuevo = {
        id: fijo ? fijo.id : idNuevo("fijo"),
        nombre: v.nombre, monto: v.monto, diaCorte: Math.min(Math.max(Number(v.diaCorte) || 1, 1), 31),
        frecuencia: cada,
        mesAncla: cada > 1 ? v.mesAncla || mesDe(app.hoy) : null,
        deudaId: v.deudaId || null,
        categoria: v.categoria || "servicios", activo: true,
      };
      const fijos = fijo ? app.datos.fijos.map((f) => (f.id === fijo.id ? nuevo : f)) : [...app.datos.fijos, nuevo];
      await guardar({ ...app.datos, fijos });
    },
  });
}

function hojaDeuda(deuda) {
  abrirHoja({
    titulo: deuda ? `Editar ${deuda.nombre}` : "Nueva deuda",
    campos: [
      { clave: "nombre", etiqueta: "A quién", tipo: "texto", valor: deuda ? deuda.nombre : "", requerido: true },
      {
        clave: "montoOriginal", etiqueta: "Cuánto debías al inicio", tipo: "monto",
        valor: deuda && deuda.montoOriginal !== null ? (deuda.montoOriginal / 100).toFixed(2) : "", requerido: true,
      },
      {
        clave: "tasaAnual", etiqueta: "Tasa anual % (opcional)", tipo: "numero", valor: deuda ? deuda.tasaAnual : "",
        ayuda: "Sin tasa, la app reporta el saldo SIN intereses y lo dice. No se inventa ninguna.",
      },
    ],
    extra: deuda
      ? `<button type="button" class="boton chico peligro" data-accion="borrar-deuda" data-id="${esc(deuda.id)}">Borrar esta deuda</button>`
      : "",
    async alGuardar(v) {
      const nueva = {
        id: deuda ? deuda.id : idNuevo("deuda"),
        nombre: v.nombre, montoOriginal: v.montoOriginal, tasaAnual: v.tasaAnual, diaCorte: deuda ? deuda.diaCorte : 1, activa: true,
      };
      const deudas = deuda ? app.datos.deudas.map((d) => (d.id === deuda.id ? nueva : d)) : [...app.datos.deudas, nueva];
      await guardar({ ...app.datos, deudas });
    },
  });
}

// --- Arranque ---

export async function arrancar() {
  try {
    const tema = localStorage.getItem("finanzas:tema");
    if (tema && tema !== "sistema") document.documentElement.dataset.tema = tema;
  } catch (e) {}

  document.addEventListener("input", (e) => {
    if (e.target.dataset.accionInput === "borrador-aviso") {
      app.borrador = e.target.value; // sin re-dibujar: escribir no debe repintar la pantalla
      return;
    }
    if (e.target.dataset.accionInput !== "filtrar-texto") return;
    // Se guarda el texto y se re-dibuja solo la lista: volver a pintar todo en cada tecla
    // le quitaría el foco al buscador.
    app.filtro = { ...(app.filtro || { tipo: "" }), texto: e.target.value };
    const posicion = e.target.selectionStart;
    render();
    const caja = document.getElementById("buscador");
    if (caja) {
      caja.focus();
      caja.setSelectionRange(posicion, posicion);
    }
  });

  document.addEventListener("click", (e) => {
    const boton = e.target.closest("[data-accion]");
    if (!boton) return;
    const accion = acciones[boton.dataset.accion];
    if (accion) accion(boton);
  });

  render(); // pinta de inmediato: la app no espera al almacenamiento para existir

  try {
    app.almacen = await abrirAlmacen();
    const { datos, aviso, bloqueado } = await app.almacen.cargar();
    app.datos = datos;
    app.aviso = aviso;
    app.bloqueado = Boolean(bloqueado);
  } catch (e) {
    app.aviso = `No se pudo abrir el almacenamiento: ${e.message} Puedes seguir usando la app, pero descarga un respaldo antes de cerrar.`;
  }

  // Si ya se sabe que esto no va a guardar, se dice de entrada — no cuando ya se perdió algo.
  const estado = app.almacen ? app.almacen.estado() : null;
  if (estado && estado.modo === MODOS.EFIMERO && !app.aviso) {
    app.aviso = estado.motivo || "Este navegador no deja guardar datos: descarga un respaldo antes de cerrar la pestaña.";
  }
  await tirarLoViejo();
  render();
  await atenderCompartido();

  // Si otro dispositivo escribe, esta pantalla se entera.
  app.almacen.suscribir(async () => {
    const fresco = await app.almacen.cargar();
    app.datos = fresco.datos;
    render();
  });

  // Si la app queda abierta y cambia el día, el ciclo se recalcula solo.
  setInterval(() => {
    const ahora = hoyISO();
    if (ahora !== app.hoy) {
      app.hoy = ahora;
      render();
    }
  }, 60000);
}
