# El puente de correo

Un script que vive en **tu** cuenta de Google y le pasa a Grip los avisos de tus bancos.
Es opcional y borrable: la app funciona igual sin él.

## Qué cubre y qué no

| | |
|---|---|
| **Sí funciona** | Mercado Pago, DiDi, OXXO/Spin, Santander, Banamex, Banorte (activando las alertas por correo en tu banca en línea) |
| **A medias** | **HSBC** — solo avisa de operaciones arriba de $1,500, así que los gastos chicos no llegan.<br>**Nu** — sí manda correo de las transferencias que envías, con monto, fecha, destinatario y clave de rastreo; **no** de las compras con tarjeta, que viven solo en su app |
| **Para lo que no llegue** | Comparte el aviso a Grip desde el celular. Y si Grip no entiende el formato, no lo tira: te lo deja esperando y solo te pide cuánto y dónde |

## Instalarlo

Está escrito paso a paso en el encabezado de `Codigo.gs`. Son ~10 minutos y no hay que
programar nada: pegar, cambiar dos líneas, desplegar, y correr `instalar` una vez.

## Trae solo

Una vez configurado en Ajustes, **Grip va por el correo sola** cada vez que la abres, sin que
aprietes nada. El botón «Traer ahora» se queda para cuando no quieras esperar.

Pide los días que hagan falta para cubrir el hueco desde la última vez, no tres fijos: volver
de una semana fuera no deja avisos afuera. Y no pregunta más de una vez cada tres horas, porque
en un celular la app se deja abierta y se vuelve a mirar veinte veces al día — sin ese freno,
cada vistazo sería una llamada a Apps Script, que tiene cuota.

Si el puente está caído, **no te interrumpe**: el motivo y la hora del último intento quedan en
Ajustes, debajo de la tarjeta del puente.

## El correo diario

El mismo script puede mandarte una línea al día: *"Te quedan $2,340 para esta quincena. Son
$180 por día hasta el 15."* Gasta 1 de los 100 correos diarios que da una cuenta gratis.

Se enciende corriendo la función **`instalar`** una vez desde el editor: ella deja el activador
diario puesto —a las 8 de la mañana, hora de la Ciudad de México— y correrla dos veces no deja
dos activadores. Para apagarlo, `desinstalar`.

Y es, hoy por hoy, **el único canal que funciona con la app cerrada**. Un PWA no puede
despertarse solo de forma fiable; el correo sí llega.

Con una salvedad que vale la pena entender: **el script no conoce tus números**, viven en tu
navegador. Lo que manda es el último resumen que Grip le dejó al guardar. Por eso va sellado
con su fecha, y si tiene más de tres días el propio correo te lo dice en la primera línea en
vez de presentarlo como si fuera de hoy.

## Lo que hay que saber antes

- El puente queda accesible para quien tenga **la URL y el token**. La URL es imposible de
  adivinar y el token lo inventas tú, pero es la superficie que esto abre. Si algún día
  quieres cerrarla: Implementaciones → Archivar, y ya.
- Devuelve **avisos, no correos**: el texto viene cortado y con los números largos tapados.
  Se salvan del tapado la **clave de rastreo** y el **folio de autorización**, porque son lo
  que le permite a Grip saber que dos avisos son el mismo movimiento. No son números de
  tarjeta ni de cuenta: no abren nada. Una tarjeta o una CLABE completas no salen de Gmail, y
  hay pruebas que lo verifican corriendo el script de verdad.
- El token y la URL se guardan **solo en tu dispositivo**, nunca en este repositorio.

## Desinstalarlo

Archiva la implementación o borra el proyecto en script.google.com. En Grip, borra la URL en
Ajustes. Nada más que hacer.
