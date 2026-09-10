# Corpus de recibos de nómina

Un archivo por caso, como en `pruebas/correos/`. Añadir un caso es añadir un XML.

## Regla que no se rompe

**Ningún recibo real entra aquí.** Estos archivos reproducen la ESTRUCTURA de un CFDI de
nómina —los elementos, los atributos, el formato de fechas y montos, que es lo único que
importa para leerlo— con RFC, nombres y cantidades **inventados**.

Si vas a usar tu recibo para escribirle una regla, cámbiale antes el RFC, el nombre, el número
de seguridad social, la CURP y todos los montos. La estructura déjala intacta.

## Qué se recorta

Un CFDI real trae además `cfdi:Emisor`, `cfdi:Receptor`, `cfdi:Conceptos`, las percepciones y
deducciones desglosadas y el `TimbreFiscalDigital`, que aquí no hacen falta: el lector solo
mira los atributos de `cfdi:Comprobante` y `nomina12:Nomina`. Se dejan un par de casos
completos a propósito, para que las pruebas no vivan en un mundo más limpio que el real.
