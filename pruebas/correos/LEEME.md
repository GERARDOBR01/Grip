# Corpus de avisos

Un archivo por aviso. Añadir un banco es **añadir un archivo**, no escribir código: la prueba
`corpus.test.js` los recorre todos.

Cada caso son dos archivos con el mismo nombre:

```
santander-abono-spei.txt        el aviso, con la primera línea "De: remitente@banco.com"
santander-abono-spei.json       lo que el lector DEBE sacar de él
```

## Regla que no se rompe

**Los datos reales nunca entran aquí.** Estos archivos reproducen la ESTRUCTURA de correos
reales —la redacción, el orden, las etiquetas, el formato de los montos y las fechas, que es lo
único que importa para leerlos— con nombres, montos, cuentas y claves inventados.

Si mandas un correo tuyo para que se le escriba su regla, tápalo antes: nombre, cuenta, CLABE,
folios y claves de rastreo. La redacción déjala intacta.
