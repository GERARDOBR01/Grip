# Wallet (BudgetBakers) visto por dentro — qué le sirve a Grip

Análisis hecho con [REA](https://github.com/morluto/rea) 6.4.0 sobre la **web app pública**
(`web.budgetbakers.com`), sin cuenta y sin tocar su servidor más allá de bajar los mismos
archivos que baja cualquier navegador al abrir la página de login. Nada de su código se copia
aquí: se describe **qué hace y cómo está pensado**, para decidir qué construir a la manera de
Grip.

## Cómo se hizo (reproducible)

```
chromium --headless --remote-debugging-port=9222 https://web.budgetbakers.com/
rea list-browser-targets  http://127.0.0.1:9222
rea analyze-web-bundle    http://127.0.0.1:9222 <target> --fetch-source-maps
rea inspect-web-page      http://127.0.0.1:9222 <target> --include-script-sources   # con los 53 chunks del _buildManifest cargados
rea export-web-scripts    pagecap.json scripts/
rea analyze-javascript-application scripts/files --json
rea trace-application-feature trace-input.json
```

| Evidencia REA | Qué contiene |
|---|---|
| `ev_80d521c3…` analyze-web-bundle | Next.js + React, 101 endpoints (tRPC, GraphQL de pagos), sin source maps públicos |
| `ev_10764e2a…` export-web-scripts | 59 scripts, 7.2 MB, de las 39 rutas de la app |
| `ev_86e785ca…` analyze-javascript-application | Grafo completo de módulos (90 MB) |

Límite honesto: es análisis **estático del cliente web**. Lo que corre en su servidor (cómo
emparejan una regla contra un cargo bancario, la sincronización con bancos) no se ve; solo se
ve cómo el cliente lo pide y lo muestra.

## Lo que encontramos

### 1. Arquitectura: *local-first*, igual que Grip
El cliente guarda todo en **PouchDB** (IndexedDB en el navegador) y sincroniza con CouchDB. Cada
documento lleva un `reservedModelType`: `Account`, `Record`, `Template`, `Budget`, `Category`,
`Contact`, `Currency`, `HashTag`, `MagicRule`, `ShoppingList`, `StandingOrder`, `Debt`,
`Filter`, `CustomGraph`, `StocksFundsAsset`, `CryptoAsset`. Un listener de cambios refresca la
pantalla que toque. Es la confirmación de que el enfoque de Grip (datos en el navegador) es el
correcto; lo que ellos añaden es la sincronización, que Grip resuelve con respaldo JSON.

### 2. Reglas automáticas ("MagicRule") — lo más útil para Grip
Pantalla `/settings/automatic-rules`. Una regla tiene:

- **nombre** (único) y **varias palabras clave** (`keywords[]`; se separan con Enter, `,` o `;`).
  Una palabra clave **no puede repetirse entre reglas** — así nunca hay dos reglas peleando por
  el mismo cargo.
- **filtro por tipo** (gasto / ingreso) opcional.
- **acciones**: categoría, **etiquetas** (varias), contacto. Exige al menos una.
- **reglas de transferencia**: con `fromAccountId` / `toAccountId`, convierten el cargo que
  coincide en una transferencia entre cuentas (no en un gasto).
- **al guardar**, busca los movimientos que ya coinciden ("We found N transactions which match
  this rule") y deja **elegir cuáles** actualizar, o guardar sin aplicar.
- se puede crear **desde un movimiento** ("New automatic rule from transaction").
- aviso push opcional cuando una regla se dispara.

**Grip hoy:** una regla es `clave → categoriaId`, donde la clave es la marca exacta del
comercio (`motor/aprendizaje.js`, `normalizarRegla` en `motor/modelo.js`), y al corregir ofrece
arreglar los anteriores de un toque. Se aprende sola, cosa que Wallet no hace (allí se escriben a
mano). Lo que le falta frente a Wallet: varias palabras por regla, coincidencia por fragmento,
etiquetas, filtro por tipo, regla que convierte en "pago de tarjeta" en vez de gasto, y elegir
cuáles de los anteriores tocar.

### 3. Plantillas (`/settings/templates`)
"Predefine tus movimientos repetitivos y agrégalos rápido": nombre + cuenta + monto + categoría.
**Grip** ya cubre parte con `motor/rapido.js` (montos sacados de tu historial), pero sin
plantillas con nombre que la persona fije.

### 4. Analítica (`/analytics`)
Vistas guardables (`CustomGraph`): gráfica de barras/línea/pastel, granularidad día/semana/mes,
agrupar por categoría o cuenta, y **comparar contra el periodo anterior** (semana, mes,
trimestre, año). **Grip** tiene tendencia de seis quincenas (`motor/tendencia.js`), pero no
"esta quincena contra la anterior, por categoría".

### 5. Importar archivos (`/imports`)
CSV, XLS, XLSX y **OFX**, con **mapeo de columnas** que el usuario confirma ("¿seguro que la
columna X es el monto?") y validación de moneda contra la cuenta. **Grip** solo
importa su propio JSON; el estado de cuenta en CSV/OFX que da cualquier banco mexicano no entra.

### 6. Lo que no aplica a Grip
- **Sincronización bancaria** (`integrations.*`: proveedores por país, MFA, OAuth): necesita
  servidor y agregador. Choca con "sin servidor, sin cuenta".
- **Inversiones / cripto**, **contactos**, **lista del súper**, **suscripción Premium**
  (Braintree, PayPal, Venmo): fuera del alcance de Grip.
- **REST API y MCP**: tienen sentido con servidor. El equivalente en Grip es el respaldo JSON.

## Qué construir, en orden

| # | Qué | Por qué | Dónde tocaría |
|---|---|---|---|
| 1 | **Reglas con varias palabras y coincidencia por fragmento**, sin palabras repetidas entre reglas | Es lo que más usa la gente en Wallet, y los avisos de banco traen el comercio escrito de mil formas ("OXXO 1234 MTY", "OXXO GASOLINERA") | `motor/aprendizaje.js`, `normalizarRegla` |
| 2 | **Al crear una regla, mostrar cuántos movimientos ya coinciden y dejar elegir** | Grip ya ofrece arreglar los anteriores; elegir uno por uno evita corregir de más | `aplicarRegla`, interfaz de Ajustes |
| 3 | **Regla que marca "pago de tarjeta"** en lugar de gasto | Grip ya separa el pago de tarjeta como "dinero que cambia de lugar"; que llegue así del aviso del banco cierra el hueco | `motor/aprendizaje.js` + `motor/tarjetas.js` |
| 4 | **Importar CSV/OFX con mapeo de columnas** confirmado por la persona | La forma más rápida de traer meses de historial; encaja con "lo que llega se confirma" | nuevo `motor/importar.js`, Bandeja |
| 5 | **Comparar con la quincena anterior por categoría** | Contesta "¿en qué gasté más que la vez pasada?" con datos que ya hay | `motor/tendencia.js` |
| 6 | **Plantillas con nombre** | Barato, y complementa la captura rápida | `motor/rapido.js` |

Las seis caben en las reglas de Grip: todo es determinista, local y cada resultado puede decir
de dónde salió.
