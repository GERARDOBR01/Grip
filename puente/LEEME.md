# El puente de correo

Un script que vive en **tu** cuenta de Google y le pasa a Grip los avisos de tus bancos.
Es opcional y borrable: la app funciona igual sin él.

## Qué cubre y qué no

| | |
|---|---|
| **Sí funciona** | Mercado Pago, DiDi, OXXO/Spin, Banorte (activando las alertas por correo en tu banca en línea) |
| **A medias** | HSBC — solo avisa de operaciones arriba de $1,500, así que los gastos chicos no llegan |
| **No funciona** | **Nu** — sus avisos nunca llegan por correo, solo dentro de su app. Para Nu: comparte el aviso a Grip desde el celular |

## Instalarlo

Está escrito paso a paso en el encabezado de `Codigo.gs`. Son ~10 minutos y no hay que
programar nada: pegar, cambiar dos líneas, y desplegar.

## Lo que hay que saber antes

- El puente queda accesible para quien tenga **la URL y el token**. La URL es imposible de
  adivinar y el token lo inventas tú, pero es la superficie que esto abre. Si algún día
  quieres cerrarla: Implementaciones → Archivar, y ya.
- Devuelve **avisos, no correos**: el texto viene cortado y con los números largos tapados.
- El token y la URL se guardan **solo en tu dispositivo**, nunca en este repositorio.

## Desinstalarlo

Archiva la implementación o borra el proyecto en script.google.com. En Grip, borra la URL en
Ajustes. Nada más que hacer.
