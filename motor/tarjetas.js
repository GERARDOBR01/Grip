// Tarjetas de crédito — donde se pierde el control, y por qué.
//
// Una tarjeta no es una deuda. Una deuda es un saldo que solo baja: original menos pagos. Una
// tarjeta es revolvente y el saldo SUBE con cada compra, así que `saldoDeuda` mentiría desde
// el primer día. Por eso viven aparte.
//
// Y todo lo demás cuelga de una distinción que casi nadie tiene clara, que ningún banco
// explica y que es la razón por la que se pagan intereses creyendo que se iba al corriente:
//
//   · EL CORTE cierra el periodo. Lo que compraste hasta ese día es lo que te van a cobrar.
//   · LA FECHA LÍMITE es cuándo hay que pagarlo, y es SEMANAS DESPUÉS.
//   · Lo que compras después del corte NO va en ese estado de cuenta: va en el siguiente.
//
// De ahí salen las dos cifras que esta pantalla enseña por encima de todas: cuánto hay que
// pagar para no generar intereses, y para cuándo. El saldo total —el número que enseñan los
// bancos— es el dato equivocado para decidir, porque incluye compras que todavía no se cobran.
//
// La regla de la casa se respeta entera: SIN TASA CAPTURADA NO SE PROYECTA NINGÚN INTERÉS, y
// sin saldo inicial capturado no hay saldo, porque una tarjeta que nace en $0.00 miente.

import { formatear, plural, porcentaje } from "./dinero.js";
import {
  hoyISO, mesDe, sumarDias, sumarMeses, diasEntre, vencimientoEnMes, armarISO, partes,
} from "./ciclo.js";
import { TIPOS } from "./modelo.js";
import { proyectarSaldo, comoPlazo } from "./deudas.js";
import { mensualidadEnMes, ultimoMes, comprometidoAMeses } from "./plazos.js";
import { ESTADOS, SEVERIDADES, veredicto, sinDatos } from "./veredicto.js";

/** Arriba de esto, la utilización empieza a pesar en el historial de crédito. */
export const UTILIZACION_SANA = 30;

/** Y arriba de esto la tarjeta ya va casi topada. */
export const UTILIZACION_ALTA = 80;

/** Cuántos días antes de la fecha límite se considera que ya urge. */
export const DIAS_URGENTE = 3;

// ── El calendario de la tarjeta ────────────────────────────────────────────

/**
 * El periodo de corte al que pertenece una fecha: cuándo empezó, cuándo cierra y cuándo se
 * paga. Este es el periodo ABIERTO — lo que compres hoy cae aquí y se cobra hasta su corte.
 *
 * La fecha límite se DERIVA en vez de configurarse de más: es la primera aparición del día
 * límite estrictamente posterior al corte. Con eso funciona igual "corta el 5, se paga el 25
 * del mismo mes" que "corta el 28, se paga el 17 del siguiente", sin preguntarle a nadie cuál
 * de los dos casos tiene.
 *
 * El recorte de los meses cortos sale gratis de `vencimientoEnMes`: un corte el 31 cae el 28
 * en febrero, igual que ya hacen los pagos fijos. No se pierde, se recorre.
 */
export function periodoDeCorte(tarjeta, iso) {
  const esteMes = vencimientoEnMes(mesDe(iso), tarjeta.diaCorte);
  const corte = iso <= esteMes ? esteMes : vencimientoEnMes(mesDe(sumarMeses(iso, 1)), tarjeta.diaCorte);
  const anterior = vencimientoEnMes(mesDe(sumarMeses(corte, -1)), tarjeta.diaCorte);
  const inicio = sumarDias(anterior, 1);

  const mismoMes = vencimientoEnMes(mesDe(corte), tarjeta.diaLimite);
  const limite = mismoMes > corte ? mismoMes : vencimientoEnMes(mesDe(sumarMeses(corte, 1)), tarjeta.diaLimite);

  return { inicio, corte, limite, dias: diasEntre(inicio, corte) + 1 };
}

/** El periodo anterior a otro: el que ya cerró y por tanto el que hay que pagar. */
export function periodoAnterior(tarjeta, periodo) {
  return periodoDeCorte(tarjeta, sumarDias(periodo.inicio, -1));
}

// ── El saldo ──────────────────────────────────────────────────────────────

/** Los movimientos de una tarjeta, de cualquier tipo, hasta una fecha. */
function movimientosDeTarjeta(datos, tarjetaId, desde, hasta) {
  const salida = [];
  for (const lista of Object.values(datos.movimientos)) {
    for (const m of lista) {
      if (m.tarjetaId !== tarjetaId) continue;
      if (m.fecha <= desde || m.fecha > hasta) continue;
      salida.push(m);
    }
  }
  return salida.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

/** Los cargos (compras) de una tarjeta entre dos fechas. */
export function cargosEntre(datos, tarjeta, desde, hasta) {
  return movimientosDeTarjeta(datos, tarjeta.id, desde, hasta).filter((m) => m.tipo === TIPOS.GASTO);
}

/** Los pagos hechos a una tarjeta entre dos fechas. */
export function pagosEntre(datos, tarjeta, desde, hasta) {
  return movimientosDeTarjeta(datos, tarjeta.id, desde, hasta).filter((m) => m.tipo === TIPOS.PAGO);
}

/**
 * Lo que cargan las compras a meses de esta tarjeta en los cortes de un rango.
 * Cada mensualidad cae en el corte de su mes: así llega al estado de cuenta de verdad.
 */
function mensualidadesEntre(datos, tarjeta, desde, hasta) {
  let total = 0;
  for (const plazo of datos.plazos || []) {
    if (plazo.tarjetaId !== tarjeta.id || !plazo.activo || plazo.montoTotal === null) continue;
    let mes = plazo.primerCargo;
    const fin = ultimoMes(plazo);
    // Tope de seguridad: un plazo no pasa de 48 meses, pero el bucle no depende de eso.
    for (let i = 0; i <= 48 && mes <= fin; i++) {
      const fecha = vencimientoEnMes(mes, tarjeta.diaCorte);
      if (fecha > desde && fecha <= hasta) total += mensualidadEnMes(plazo, mes);
      mes = mesDe(sumarMeses(`${mes}-01`, 1));
    }
  }
  return total;
}

/** Las anualidades que cayeron en un rango. Cae en el corte de su mes, una vez al año. */
function anualidadesEntre(tarjeta, desde, hasta) {
  if (tarjeta.anualidad === null || tarjeta.mesAnualidad === null) return 0;
  let total = 0;
  for (let anio = partes(desde).anio; anio <= partes(hasta).anio; anio++) {
    const fecha = vencimientoEnMes(armarISO(anio, tarjeta.mesAnualidad, 1).slice(0, 7), tarjeta.diaCorte);
    if (fecha > desde && fecha <= hasta) total += tarjeta.anualidad;
  }
  return total;
}

/**
 * Lo que debes en esta tarjeta a una fecha: el saldo inicial, más todo lo cargado desde
 * entonces, menos todo lo abonado.
 *
 * Devuelve `null` —no cero— cuando falta el saldo inicial o su fecha. Sin esos dos datos no
 * se sabe qué parte de tu historial ya estaba contada y cuál no, y un saldo que empieza en
 * $0.00 el día que capturas la tarjeta es la mentira que contamina todo lo que cuelga de él.
 */
export function saldoTarjeta(datos, tarjeta, iso = hoyISO()) {
  if (tarjeta.saldoInicial === null || tarjeta.saldoInicialDesde === null) {
    return {
      saldo: null,
      cargos: 0,
      pagos: 0,
      veredicto: sinDatos(
        `"${tarjeta.nombre}" no tiene saldo inicial capturado — no hay saldo que calcular`,
        "captura cuánto debías hoy en esta tarjeta y desde qué fecha",
      ),
    };
  }

  const desde = tarjeta.saldoInicialDesde;
  const compras = cargosEntre(datos, tarjeta, desde, iso).reduce((t, m) => t + m.monto, 0);
  const meses = mensualidadesEntre(datos, tarjeta, desde, iso);
  const anualidades = anualidadesEntre(tarjeta, desde, iso);
  const abonos = pagosEntre(datos, tarjeta, desde, iso).reduce((t, m) => t + m.monto, 0);

  const cargos = compras + meses + anualidades;
  return {
    saldo: tarjeta.saldoInicial + cargos - abonos,
    cargos,
    pagos: abonos,
    compras,
    meses,
    anualidades,
    veredicto: veredicto(ESTADOS.VA_BIEN, SEVERIDADES.INFO, "saldo al día de hoy", { desde }),
  };
}

// ── El corte: la pantalla entera cuelga de aquí ────────────────────────────

/**
 * El estado de cuenta que toca pagar, con los números que ningún banco enseña juntos.
 *
 * `porPagar` es la cifra grande, y no el saldo: el saldo incluye lo que compraste después del
 * corte, que todavía no se cobra. Pagar el saldo completo no está mal, pero creer que hay que
 * pagarlo para no generar intereses es pagar de más por miedo; y creer que el saldo es lo que
 * vence es lo que hace que la gente pague de menos sin saberlo.
 */
export function estadoDeCorte(datos, tarjeta, iso = hoyISO()) {
  const abierto = periodoDeCorte(tarjeta, iso);
  const cerrado = periodoAnterior(tarjeta, abierto);
  const base = saldoTarjeta(datos, tarjeta, iso);

  const marco = {
    tarjeta,
    abierto,
    cerrado,
    corte: cerrado.corte,
    fechaLimite: cerrado.limite,
    proximoCorte: abierto.corte,
    diasParaPagar: diasEntre(iso, cerrado.limite),
    diasParaCorte: diasEntre(iso, abierto.corte),
    saldo: base.saldo,
  };

  if (base.saldo === null) {
    return { ...marco, saldoAlCorte: null, porPagar: null, desdeElCorte: 0, vencido: false, veredicto: base.veredicto };
  }

  const saldoAlCorte = saldoTarjeta(datos, tarjeta, cerrado.corte).saldo;
  const abonado = pagosEntre(datos, tarjeta, cerrado.corte, iso).reduce((t, m) => t + m.monto, 0);
  const porPagar = Math.max(saldoAlCorte - abonado, 0);
  // Lo que llevas gastado desde el corte: NO se cobra en este estado de cuenta, va en el que
  // cierra el día `proximoCorte`. Es el dato que regala semanas de plazo a quien lo entiende.
  const desdeElCorte = cargosEntre(datos, tarjeta, cerrado.corte, iso).reduce((t, m) => t + m.monto, 0);
  const vencido = iso > cerrado.limite && porPagar > 0;

  return {
    ...marco,
    saldoAlCorte,
    abonado,
    porPagar,
    desdeElCorte,
    vencido,
    veredicto: dictamenDelCorte({ porPagar, vencido, diasParaPagar: marco.diasParaPagar, fechaLimite: cerrado.limite }),
  };
}

function dictamenDelCorte({ porPagar, vencido, diasParaPagar, fechaLimite }) {
  if (porPagar === 0) {
    return veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK, "este corte ya está pagado — no vas a generar intereses", {
      porPagar: 0,
    });
  }
  if (vencido) {
    const dias = Math.abs(diasParaPagar);
    return veredicto(
      ESTADOS.NO_ALCANZA,
      SEVERIDADES.ALTA,
      `la fecha límite se pasó hace ${plural(dias, "día", "días")} y quedan ${formatear(porPagar)} sin pagar`,
      { porPagar, fechaLimite, dias },
    );
  }
  if (diasParaPagar <= DIAS_URGENTE) {
    return veredicto(
      ESTADOS.AJUSTADO,
      SEVERIDADES.ALTA,
      diasParaPagar === 0
        ? `hoy es el último día: ${formatear(porPagar)} para no generar intereses`
        : `faltan ${plural(diasParaPagar, "día", "días")}: ${formatear(porPagar)} para no generar intereses`,
      { porPagar, fechaLimite, diasParaPagar },
    );
  }
  return veredicto(
    ESTADOS.AJUSTADO,
    SEVERIDADES.INFO,
    `${formatear(porPagar)} antes del ${fechaLimite} para no generar intereses`,
    { porPagar, fechaLimite, diasParaPagar },
  );
}

/** Los cargos que forman un estado de cuenta, para poder reconstruirlo sin abrir el banco. */
export function cargosDelPeriodo(datos, tarjeta, periodo) {
  return cargosEntre(datos, tarjeta, sumarDias(periodo.inicio, -1), periodo.corte);
}

// ── El crédito, que no es dinero tuyo ──────────────────────────────────────

/**
 * Cuánto llevas usado de tu línea.
 *
 * Se enseña como UTILIZACIÓN y no como "crédito disponible" a propósito: el disponible se lee
 * como dinero propio, y no lo es — es lo que te falta por deber. El umbral del 30% no es una
 * ley, es la referencia que se usa para el historial de crédito, y va dicho como tal.
 */
export function creditoUsado(datos, tarjeta, iso = hoyISO()) {
  const base = saldoTarjeta(datos, tarjeta, iso);
  if (base.saldo === null || tarjeta.limite === null) {
    return {
      usado: base.saldo,
      disponible: null,
      utilizacion: null,
      veredicto: sinDatos(
        tarjeta.limite === null
          ? "no hay límite de crédito capturado — no hay porcentaje que calcular"
          : base.veredicto.motivo,
        tarjeta.limite === null ? "captura el límite de tu tarjeta" : "captura el saldo inicial",
      ),
    };
  }

  const usado = base.saldo;
  const utilizacion = porcentaje(usado, tarjeta.limite);
  const disponible = tarjeta.limite - usado;

  const nota =
    usado > tarjeta.limite
      ? veredicto(ESTADOS.NO_ALCANZA, SEVERIDADES.ALTA, `pasaste tu límite por ${formatear(usado - tarjeta.limite)}`, { usado, utilizacion })
      : utilizacion >= UTILIZACION_ALTA
        ? veredicto(ESTADOS.NO_ALCANZA, SEVERIDADES.ALTA, `vas al ${utilizacion}% de tu límite: casi topada`, { usado, utilizacion })
        : utilizacion >= UTILIZACION_SANA
          ? veredicto(
              ESTADOS.AJUSTADO,
              SEVERIDADES.MEDIA,
              `vas al ${utilizacion}% de tu límite — arriba del ${UTILIZACION_SANA}% empieza a pesar en tu historial de crédito`,
              { usado, utilizacion },
            )
          : veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK, `vas al ${utilizacion}% de tu límite`, { usado, utilizacion });

  return { usado, disponible, utilizacion, veredicto: nota };
}

// ── Lo que cuesta revolver ─────────────────────────────────────────────────

/**
 * Qué pasa si dejas de pagar el total y te quedas abonando lo mismo cada mes.
 *
 * El supuesto va escrito en el propio veredicto, como en las deudas, y lleva uno más que es
 * particular de las tarjetas y que casi nadie sabe: cuando no pagas el total del corte, el
 * interés se cobra sobre TODO el saldo, no solo sobre lo que dejaste de pagar. Por eso "casi
 * lo pagué todo" cuesta casi lo mismo que no haber pagado nada.
 */
export function siSoloPagas(datos, tarjeta, mensual, iso = hoyISO()) {
  const base = saldoTarjeta(datos, tarjeta, iso);
  if (base.saldo === null || base.saldo === 0) return null;

  if (tarjeta.tasaAnual === null) {
    return {
      pago: mensual,
      meses: null,
      intereses: null,
      veredicto: sinDatos(
        `saldo ${formatear(base.saldo)} sin intereses — no hay tasa capturada, así que aquí no se proyecta ninguno`,
        "captura la tasa anual de la tarjeta para saber cuánto te cuesta revolver",
      ),
    };
  }

  const proyeccion = proyectarSaldo({ saldo: base.saldo, tasaAnual: tarjeta.tasaAnual, pago: mensual });

  if (proyeccion.nuncaBaja) {
    return {
      pago: mensual,
      meses: null,
      intereses: null,
      interesDelMes: proyeccion.interesDelMes,
      veredicto: veredicto(
        ESTADOS.NO_ALCANZA,
        SEVERIDADES.ALTA,
        `pagando ${formatear(mensual)} al mes esta tarjeta NUNCA baja: solo el interés del mes es ${formatear(proyeccion.interesDelMes)}`,
        { saldo: base.saldo, pago: mensual, interesDelMes: proyeccion.interesDelMes },
      ),
    };
  }

  return {
    pago: mensual,
    meses: proyeccion.meses,
    intereses: proyeccion.intereses,
    interesDelMes: proyeccion.interesDelMes,
    veredicto: veredicto(
      proyeccion.intereses > base.saldo / 2 ? ESTADOS.NO_ALCANZA : ESTADOS.AJUSTADO,
      proyeccion.intereses > base.saldo / 2 ? SEVERIDADES.ALTA : SEVERIDADES.MEDIA,
      `pagando ${formatear(mensual)} al mes tardarías ${comoPlazo(proyeccion.meses)} y pagarías ${formatear(proyeccion.intereses)} de intereses ` +
        `(proyección: interés mensual sobre TODO el saldo —no solo sobre lo que dejas de pagar—, sin compras nuevas, sin comisiones ni IVA)`,
      { saldo: base.saldo, pago: mensual, meses: proyeccion.meses, intereses: proyeccion.intereses },
    ),
  };
}

/** El interés de un mes si no liquidas el corte. Sin tasa capturada, `null`. */
export function interesDeNoPagar(datos, tarjeta, iso = hoyISO()) {
  const base = saldoTarjeta(datos, tarjeta, iso);
  if (base.saldo === null || tarjeta.tasaAnual === null) return null;
  return Math.round(base.saldo * (tarjeta.tasaAnual / 100 / 12));
}

// ── Cómo vas pagando: la métrica de control ────────────────────────────────

/**
 * Los últimos cortes, y si cada uno se pagó completo antes de su fecha límite.
 *
 * Sale entero de los movimientos que ya hay, sin guardar nada nuevo. Es el número que de
 * verdad dice si perdiste el control: un mes sin pagar completo le pasa a cualquiera; cuatro
 * seguidos son una tarjeta que ya está cobrando intereses todos los meses y nadie lo notó.
 *
 * Es un hecho, no un regaño: se dice cuántos, no lo que deberías haber hecho.
 */
export function historialDeCortes(datos, tarjeta, iso = hoyISO(), cuantos = 6) {
  if (tarjeta.saldoInicial === null || tarjeta.saldoInicialDesde === null) {
    return { cortes: [], completos: 0, revisables: 0, veredicto: saldoTarjeta(datos, tarjeta, iso).veredicto };
  }

  const cortes = [];
  let periodo = periodoAnterior(tarjeta, periodoDeCorte(tarjeta, iso));

  for (let i = 0; i < cuantos; i++) {
    // Un corte anterior a la fecha del saldo inicial no se puede juzgar: no sabemos qué había.
    if (periodo.corte <= tarjeta.saldoInicialDesde) break;
    const saldoAlCorte = saldoTarjeta(datos, tarjeta, periodo.corte).saldo;
    const abonado = pagosEntre(datos, tarjeta, periodo.corte, periodo.limite).reduce((t, m) => t + m.monto, 0);
    // Un corte cuya fecha límite todavía no llega no se cuenta: está en curso, no es historia.
    const cerrado = periodo.limite < iso;
    cortes.push({
      corte: periodo.corte,
      limite: periodo.limite,
      saldoAlCorte,
      abonado,
      completo: saldoAlCorte <= abonado,
      enCurso: !cerrado,
    });
    periodo = periodoAnterior(tarjeta, periodo);
  }

  const juzgables = cortes.filter((c) => !c.enCurso);
  const completos = juzgables.filter((c) => c.completo).length;

  return {
    cortes,
    completos,
    revisables: juzgables.length,
    veredicto: !juzgables.length
      ? sinDatos("todavía no hay cortes cerrados que revisar", "vuelve después de tu próxima fecha límite")
      : completos === juzgables.length
        ? veredicto(
            ESTADOS.VA_BIEN,
            SEVERIDADES.OK,
            `pagaste completo ${juzgables.length === 1 ? "el último corte" : `los últimos ${juzgables.length} cortes`}`,
            { completos, de: juzgables.length },
          )
        : veredicto(
            juzgables.length - completos >= 3 ? ESTADOS.NO_ALCANZA : ESTADOS.AJUSTADO,
            juzgables.length - completos >= 3 ? SEVERIDADES.ALTA : SEVERIDADES.MEDIA,
            `pagaste completo ${completos} de los últimos ${juzgables.length} cortes`,
            { completos, de: juzgables.length },
          ),
  };
}

// ── Las vistas de conjunto ─────────────────────────────────────────────────

/** Las tarjetas activas, ordenadas por urgencia: lo vencido primero. El orden ES el mensaje. */
export function tarjetasPorUrgencia(datos, iso = hoyISO()) {
  return (datos.tarjetas || [])
    .filter((t) => t.activa)
    .map((tarjeta) => ({ tarjeta, corte: estadoDeCorte(datos, tarjeta, iso) }))
    .sort((a, b) => {
      if (a.corte.vencido !== b.corte.vencido) return a.corte.vencido ? -1 : 1;
      const deudaA = a.corte.porPagar || 0;
      const deudaB = b.corte.porPagar || 0;
      if ((deudaA > 0) !== (deudaB > 0)) return deudaA > 0 ? -1 : 1;
      return a.corte.diasParaPagar - b.corte.diasParaPagar;
    });
}

/**
 * Lo que vence pronto, hermano de `proximosVencimientos` de los fijos.
 * Solo lo que tiene algo que pagar: una tarjeta al corriente no es un pendiente.
 */
export function proximosLimites(datos, iso = hoyISO(), dias = 7) {
  return tarjetasPorUrgencia(datos, iso)
    .filter(({ corte }) => corte.porPagar > 0 && corte.diasParaPagar <= dias)
    .map(({ tarjeta, corte }) => ({
      tarjeta,
      fecha: corte.fechaLimite,
      dias: corte.diasParaPagar,
      vencido: corte.vencido,
      monto: corte.porPagar,
    }));
}

/**
 * Tu mes en una línea: los cortes y las fechas límite de TODAS las tarjetas, en orden.
 * Con dos tarjetas ya nadie lleva esas cuatro fechas en la cabeza, y ahí empieza el desorden.
 */
export function calendarioDelMes(datos, iso = hoyISO(), dias = 45) {
  const hasta = sumarDias(iso, dias);
  const salida = [];

  for (const tarjeta of (datos.tarjetas || []).filter((t) => t.activa)) {
    let periodo = periodoAnterior(tarjeta, periodoDeCorte(tarjeta, iso));
    for (let i = 0; i < 4; i++) {
      for (const [tipo, fecha] of [["limite", periodo.limite], ["corte", periodo.corte]]) {
        if (fecha < iso || fecha > hasta) continue;
        if (salida.some((e) => e.tipo === tipo && e.fecha === fecha && e.tarjeta.id === tarjeta.id)) continue;
        salida.push({ tipo, fecha, tarjeta, dias: diasEntre(iso, fecha) });
      }
      periodo = periodoDeCorte(tarjeta, sumarDias(periodo.corte, 1));
    }
  }

  return salida.sort((a, b) => (a.fecha === b.fecha ? (a.tipo < b.tipo ? -1 : 1) : a.fecha < b.fecha ? -1 : 1));
}

/** El encabezado de la pantalla: todo lo que debes, y lo primero que vence. */
export function resumenTarjetas(datos, iso = hoyISO()) {
  const activas = tarjetasPorUrgencia(datos, iso);
  if (!activas.length) {
    return {
      deuda: 0, limite: 0, utilizacion: null, cuantas: 0, vencidas: 0,
      proximo: null, sinSaldo: [], aMeses: comprometidoAMeses(datos, iso),
      veredicto: sinDatos("todavía no capturas ninguna tarjeta", "agrega la primera y aquí aparece tu mes completo"),
    };
  }

  let deuda = 0;
  let limite = 0;
  const sinSaldo = [];
  for (const { tarjeta, corte } of activas) {
    if (corte.saldo === null) sinSaldo.push(tarjeta.nombre);
    else deuda += corte.saldo;
    if (tarjeta.limite !== null) limite += tarjeta.limite;
  }

  const conDeuda = activas.filter(({ corte }) => corte.porPagar > 0);
  const vencidas = activas.filter(({ corte }) => corte.vencido);
  const proximo = conDeuda.length
    ? { fecha: conDeuda[0].corte.fechaLimite, monto: conDeuda[0].corte.porPagar, tarjeta: conDeuda[0].tarjeta, dias: conDeuda[0].corte.diasParaPagar }
    : null;

  return {
    deuda,
    limite,
    utilizacion: limite ? porcentaje(deuda, limite) : null,
    cuantas: activas.length,
    vencidas: vencidas.length,
    proximo,
    sinSaldo,
    aMeses: comprometidoAMeses(datos, iso),
    veredicto: vencidas.length
      ? veredicto(ESTADOS.NO_ALCANZA, SEVERIDADES.ALTA, `${plural(vencidas.length, "tarjeta vencida", "tarjetas vencidas")}: ${vencidas.map((v) => v.tarjeta.nombre).join(", ")}`, { vencidas: vencidas.length })
      : sinSaldo.length
        ? sinDatos(
            `${plural(sinSaldo.length, "tarjeta", "tarjetas")} sin saldo inicial no ${sinSaldo.length === 1 ? "entra" : "entran"} en el total`,
            `captura cuánto debes en: ${sinSaldo.join(", ")}`,
          )
        : proximo && proximo.dias <= DIAS_URGENTE
          ? veredicto(ESTADOS.AJUSTADO, SEVERIDADES.ALTA, `${formatear(proximo.monto)} de ${proximo.tarjeta.nombre} vencen el ${proximo.fecha}`, { proximo: proximo.fecha })
          : proximo
            ? veredicto(ESTADOS.AJUSTADO, SEVERIDADES.INFO, `lo primero que vence: ${formatear(proximo.monto)} de ${proximo.tarjeta.nombre} el ${proximo.fecha}`, { proximo: proximo.fecha })
            : veredicto(ESTADOS.VA_BIEN, SEVERIDADES.OK, "no tienes nada por pagar en este corte", { deuda }),
  };
}
