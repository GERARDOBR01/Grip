# Grip

App de finanzas personales para quien no tiene tiempo de llevarlas. Le pegas el aviso de tu
banco y ella saca el monto, la fecha y el comercio; tú confirmas de un toque. Y aprende: si
corriges una categoría una vez, no vuelve a preguntar.

Contesta lo que importa a diario: a dónde se va el dinero, cuánto puedes gastar hoy sin
quedarte corto, y si una meta de ahorro de verdad alcanza o no.

**[Abrir la app](https://gerardobr01.github.io/grip/)** · desde el celular, *Añadir a
pantalla de inicio* y queda instalada con su ícono, funcionando sin conexión.

<sub>La dirección va en minúscula aunque el repositorio se llame `Grip`: así la publica GitHub
Pages. No es una errata.</sub>

**Sin servidor, sin cuenta y sin dependencias.** No hay registro ni login. Los datos se
guardan en el navegador de quien la usa: aquí no hay backend al que mandarlos.

<img src="interfaz/logo.svg" width="88" align="right" alt="">

```
index.html      la app publicada (esto es lo que sirve GitHub Pages)
finanzas.html   la misma app en un archivo suelto: ábrelo desde el disco, sin servidor
motor/          el cálculo, en JavaScript puro y sin DOM
```

## Qué contesta

| Pantalla | Qué contesta |
|---|---|
| **Hoy** | Cuánto queda de la quincena, cuánto por día, con cuánto cierra el ciclo a este ritmo, qué se paga esta semana, cuántas quincenas aguantaría el fondo de emergencia, y qué suscripción te subió de precio |
| **Bandeja** | Lo que llegó solo y espera confirmación. Pegar, compartir o traer del correo; aceptar es un toque |
| **Historial** | Mes por mes, con buscador, y la tendencia de las últimas seis quincenas |
| **Presupuesto** | Cuánto va gastado por categoría contra su tope, con semáforo |
| **Metas** | Cuánto hay que apartar por quincena — y si eso cabe en la capacidad real de ahorro |
| **Fijos** | Qué vence, qué ya se pagó y cuánto se debe, más las suscripciones que encontró sola en el historial |
| **Ajustes** | Ingreso, ciclo, fondo de emergencia, lo que aprendió de ti, respaldo en JSON |

Cuatro cosas mueven dinero y todas se capturan igual, desde el botón `+`: **gasto**,
**ingreso**, **apartar** y **retirar**. Un retiro no borra el apartado original — los dos
quedan en el historial, porque eso fue lo que pasó.

## Las tres reglas

**1. El código decide.** No hay ningún modelo de por medio: todo sale de reglas
deterministas y cada veredicto dice de dónde salió.

```
NO_ALCANZA — requiere $3,750.00 por quincena, capacidad estimada $530.00 — fuente: CODIGO
```

**2. Declarar la ignorancia es una feature.** Sin datos suficientes, la app responde
`SIN_DATOS_SUFICIENTES` y dice qué falta capturar. No promedia sobre aire:

- Sin ingreso capturado, el disponible es `—`, nunca `$0.00`.
- Con menos de 3 días corridos del ciclo no se proyecta el cierre: una despensa el día 1
  proyectaría un mes catastrófico.
- Una categoría sin tope no se pinta de verde: se marca `SIN_TOPE`, porque no hay contra
  qué comparar.
- Un fondo de emergencia a medias va `AJUSTADO`, no `NO_ALCANZA`: no es un plan que no
  cierre, es un ahorro en progreso.
- **Una deuda sin tasa capturada no proyecta intereses.** Con la tasa puesta sí proyecta
  —meses, intereses totales y su supuesto escrito— y dice en voz alta lo que casi nadie
  dice: si el pago no cubre ni el interés del mes, **esa deuda nunca baja**.
- **Un pago anual no es un gasto mensual.** Cada fijo tiene su frecuencia, y el total sale
  en dos números: el promedio mensualizado (lo que hay que ir apartando) y lo que de verdad
  se paga este mes.
- **Un aviso leído a medias no entra a las cuentas.** Todo lo que llega solo espera
  confirmación, y viene con qué tan seguro está el lector y qué tuvo que suponer.
- **Una preautorización y su cargo final no son dos gastos.** La gasolinera retiene $100 y
  cobra $43; el restaurante autoriza sin propina y cobra con ella. Cuando el monto cambia, la
  app lo reconoce y ofrece **reemplazar** el anterior en vez de sumar otro.
- **Dos cargos no son una suscripción.** Se piden tres, y con un ritmo reconocible; si no,
  no se propone nada.
- **Confianza alta significa que no quedó nada que revisar.** Si el lector tuvo que suponer
  algo —la fecha, el tipo, el comercio— lo dice y baja la confianza. Un aviso de saldo o una
  promoción no producen un movimiento: se declaran como lo que son.
- **La bandeja es un buzón, no un archivo.** Lo ya resuelto se tira a los 60 días; lo
  pendiente nunca, por viejo que sea. Sin eso, un año de uso llenaba el 88% del documento
  que se sincroniza y acababa rompiéndolo.

**3. Los datos reales nunca entran al repositorio.** Lo que se versiona es el motor.

## Que dure

- **Cero dependencias.** Sin npm, sin framework, sin CDN. Nada debajo que se pueda caer.
- **Dinero en centavos enteros.** Nunca coma flotante en el modelo: `0.1 + 0.2` no es `0.3`,
  y una app de finanzas que arrastra ese error miente por unos centavos cada mes.
- **Esquema versionado con migraciones.** Un documento de una versión más nueva **no se
  abre**: se declara, en vez de perder lo que esa versión guardó.
- **Fechas sin zonas horarias.** `AAAA-MM-DD` en local: una zona mal aplicada mueve un gasto
  de quincena y descuadra el ciclo.
- **Nada falla en silencio.** En un origen aislado, hasta *leer* `localStorage` lanza: por
  eso no se pregunta con `typeof`, se intenta dentro de un `try`. Si no se puede guardar, la
  app lo dice de entrada y sigue usable; si hay datos que esta versión no sabe abrir, se
  **niega a escribir** en vez de pisarlos.
- **El correo nunca se guarda.** De un aviso se extraen monto, fecha, comercio y los últimos
  4 de la tarjeta. El texto se usa y se tira.
- **El texto se canoniza antes de leerse.** Quoted-printable, viñetas de enmascarado, comillas
  tipográficas y caracteres invisibles se normalizan en una sola pasada. Sin eso —medido— una
  tarjeta `••••4574` no se extrae y encima se cuela dentro del nombre del comercio.
- **Sincronizar FUSIONA, no elige.** Antes se quedaba el documento entero más reciente y el
  otro se descartaba: capturar en el celular y en la PC la misma tarde hacía desaparecer una de
  las dos, en silencio. Ahora los movimientos se unen por `id`, y lo borrado a propósito deja
  lápida para que la otra copia no lo resucite.

## No depende de nadie para abrirse

Todo lo que toca el mundo exterior vive en **adaptadores opcionales** que nadie importa: la
app pregunta en tiempo de ejecución si existen. Bórralos, arma, y queda exactamente igual.

| Capa | Qué hace | ¿Se puede borrar? |
|---|---|---|
| IndexedDB (o localStorage) | el almacén base, en el dispositivo | no, es el piso |
| Respaldo JSON | exportar/importar; la mudanza a donde sea | no |
| `almacen/anfitrion-claude.js` | sincroniza entre dispositivos | **sí** |
| `almacen/puente-correo.js` | trae los avisos de Gmail | **sí** |

Eso no es una promesa escrita en un README: hay pruebas que recorren `motor/`, `interfaz/` y
`almacen/` y **fallan** si alguien nombra ese entorno fuera de su adaptador, si alguien los
importa, o si algún archivo que no sea el puente pide algo a la red.

## Que capture sola

Tres formas de llenar la bandeja, todas contra el mismo lector:

1. **Pegar.** Copias el aviso y lo pegas. Funciona con cualquier banco, lo reconozca o no.
2. **Compartir.** Con la app instalada en Android, le compartes el correo desde Gmail y cae
   leída. Es la única vía para bancos que solo notifican dentro de su app.
3. **El puente.** Un [Apps Script](puente/) en tu propia cuenta de Google que busca los
   avisos de tus bancos y se los pasa a la app. Gratis, sin servidor, y lo borras cuando
   quieras.

Lo que hay que decir antes de que alguien se ilusione: **el correo no cubre todo tu dinero.**
Nu manda correo de las transferencias que envías, pero no de las compras con tarjeta. HSBC solo
avisa de operaciones arriba de $1,500, así que los gastos chicos no llegan. Banorte, Santander,
Banamex, Mercado Pago, DiDi y OXXO sí avisan completo. La app lo dice en Ajustes, banco por
banco, en vez de prometer de más.

## Cómo se trabaja

```bash
node --test pruebas/*.test.js      # 197 pruebas: sin red, sin API, sin gastar un peso
node herramientas/armar.mjs        # arma index.html y finanzas.html desde motor/ e interfaz/
node herramientas/humo.mjs         # navegador real: disco, sin almacenamiento, e instalada
node herramientas/logo.mjs         # solo si cambia el logo
```

El armado **falla ruidosamente** ante lo que produciría un HTML roto en silencio: un módulo
que existe pero nadie metió en la lista, dos nombres de nivel superior repetidos, un
`import` sin resolver, o un resultado que no compila.

La prueba de navegador corre tres escenarios: la app abierta desde el disco, servida en un
navegador que no deja guardar nada, e instalada y abriendo **con la red apagada**.

## Cómo se prueba

Tres capas, porque cada una atrapa lo que las otras no:

| Capa | Qué comprueba |
|---|---|
| **Ejemplos** | los casos concretos que ya se rompieron una vez |
| **Corpus** (`pruebas/correos/`) | un archivo por aviso real, con lo que debe salir de él. Añadir un banco es añadir dos archivos, no escribir código |
| **Invariantes** (`pruebas/invariantes.test.js`) | lo que debe cumplirse para *cualquier* entrada, sobre miles generadas con semilla fija: que nunca lance, que **nunca invente dinero** (el monto que devuelve tiene que estar en el texto), que la fecha siempre exista en el calendario, que canonizar sea idempotente, y que "confianza alta" signifique de verdad que no quedó nada que revisar |

La última capa incluye un candado de rendimiento: leer una entrada patológica —60,000
caracteres, miles de disparadores encadenados— debe tardar menos de 50 ms. Los topes de los
cuantificadores son lo que evita el *backtracking* catastrófico, y esa prueba avisa el día que
alguien afloje uno.

## Estructura

```
motor/       cálculo puro, sin DOM: dinero, ciclos, presupuesto, ahorro, metas, fijos, deudas,
             lectura de avisos, bandeja, aprendizaje, recurrentes, tendencia y fusión
almacen/     persistencia detrás de 4 métodos, con adaptadores intercambiables
interfaz/    plantilla, estilos, render y el logo
pruebas/     node --test: ejemplos, corpus de avisos e invariantes sobre entrada generada
herramientas/armar.mjs (build), humo.mjs (navegador) y logo.mjs (íconos)
puente/      el script de Google Apps Script que lee el correo, con sus instrucciones
publicar/    la variante para publicar en un enlace privado
```

Los archivos de la raíz (`index.html`, `sw.js`, `manifest.webmanifest`, los íconos) son
**salida generada**: se regeneran con `armar.mjs` y no se editan a mano.

---

<sub>Gerardo Barrera · <a href="https://github.com/GERARDOBR01/GERARDOBR01">perfil</a></sub>
