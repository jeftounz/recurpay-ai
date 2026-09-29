# Integrar el código en el repo

Tu asistente local tiene razón: el repo sólo tiene el scaffold. El código existe
—se entregó en `recurpay-core.tar.gz`— pero nunca se desempacó. Esto es lo que
falta para que el estado del repo coincida con el brief.

Son cinco pasos. Los tres primeros son obligatorios; sin ellos el build falla.

## 0. Comprobar el runtime

```bash
node --version    # necesitas 22.6 o superior
```

Los tests corren con el ejecutor nativo de Node sobre archivos `.ts`, usando el
type stripping incorporado. Por debajo de 22.6 no existe y `npm run test:domain`
no arranca. Si tienes 20.x, actualiza antes de seguir.

## 1. Desempacar el código

Desde la raíz del repo (`.../RecurPay/recurpay`, donde está `package.json`):

```bash
tar xzf /ruta/a/recurpay-core.tar.gz
mv recurpay-core/domain recurpay-core/application recurpay-core/infrastructure .
cp recurpay-core/tsconfig.json tsconfig.domain.json
rm -rf recurpay-core
```

Quedan `domain/`, `application/` e `infrastructure/` junto a `app/`. El
`package.json` y el `tsconfig.json` del tarball **no** sustituyen a los tuyos:
el de Next manda para la app, y el del tarball se queda como
`tsconfig.domain.json` para el typecheck estricto del dominio.

## 2. Arreglar el `tsconfig.json` de Next

Dos cambios, y los dos son obligatorios:

```diff
   "compilerOptions": {
-    "target": "ES2017",
+    "target": "ES2022",
     "lib": ["dom", "dom.iterable", "esnext"],
     "allowJs": true,
     "skipLibCheck": true,
     "strict": true,
     "noEmit": true,
     "esModuleInterop": true,
     "module": "esnext",
     "moduleResolution": "bundler",
     "resolveJsonModule": true,
     "isolatedModules": true,
     "jsx": "react-jsx",
+    "allowImportingTsExtensions": true,
     "incremental": true,
```

Y excluye los tests, para que `next build` no intente typecheckearlos:

```diff
   "exclude": ["node_modules"]
+  "exclude": ["node_modules", "**/*.test.ts"]
```

**Por qué `ES2022`**: `Money` guarda las unidades menores en `bigint` y usa
literales como `0n`. Con `ES2017`, TypeScript falla con `TS2737: BigInt literals
are not available when targeting lower than ES2020`. No es opcional: en cuanto
la app importe algo que toque dinero, el build se cae.

**Por qué `allowImportingTsExtensions`**: los imports relativos del dominio
llevan `.ts` (`from './Money.ts'`), que es lo que exige el type stripping de
Node para los tests. Sin la bandera, `tsc` los rechaza con `TS5097`.

Verificado: con esos dos cambios, las tres capas compilan limpias bajo un
tsconfig con `moduleResolution: "bundler"` como el tuyo.

## 3. `tsconfig.domain.json`

Es el que copiaste del tarball en el paso 1. Comprueba que tenga esto:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "erasableSyntaxOnly": true,
    "rewriteRelativeImportExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["domain/**/*.ts", "application/**/*.ts", "infrastructure/**/*.ts"]
}
```

Son dos verdades distintas sobre el mismo código a propósito: el de dominio es
más estricto que el de Next, así que lo que pasa el estricto pasa el otro. El de
Next compila la app; éste verifica que el dominio sigue cumpliendo sus reglas
—sin parameter properties, sin índices sin comprobar, sin opcionales laxos— que
son las que lo mantienen portable fuera del framework.

## 4. Dependencias y scripts

```bash
npm install zod
npm install -D typescript@^5.9
```

`zod` es dependencia de producción: valida la salida del modelo en tiempo de
ejecución. Y necesitas TypeScript 5.8+ porque `erasableSyntaxOnly` y
`rewriteRelativeImportExtensions` no existen antes.

En `package.json`, añade:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test:domain": "node --test \"domain/**/*.test.ts\" \"application/**/*.test.ts\" \"infrastructure/**/*.test.ts\"",
  "typecheck": "tsc --noEmit -p tsconfig.domain.json && tsc --noEmit"
}
```

`typecheck` corre los dos: primero el dominio con las reglas estrictas, después
la app con las de Next.

## 5. Comprobar que quedó bien

```bash
npm run test:domain    # 128 tests en verde
npm run typecheck      # sin salida = sin errores
npm run build          # el build de Next debe seguir pasando
```

Si los 128 no salen, para y dímelo antes de seguir con el pipeline.

Y si tocas fechas en algún momento:

```bash
TZ=Pacific/Kiritimati npm run test:domain
TZ=Pacific/Midway     npm run test:domain
```

Los mismos 128. Si el número cambia, alguna fecha depende de la zona del proceso.

## Lo que no está en el repo y quizá quieras bajar

Los dieciocho documentos de diseño viven en el proyecto de Claude, no en tu
disco, y tu asistente local no puede leerlos. Los que más le servirían para no
reinventar decisiones son `decisiones-dominio.md`, `decisiones-extraccion.md`,
`decisiones-facturacion.md`, `decisiones-carga-comprobantes.md` y
`mapa-de-modulos.md`. Si los quieres en `claude/` dentro del repo, dímelo y te
los paso como archivos.

Mientras tanto, el código va muy comentado precisamente para eso: el porqué de
cada decisión está junto a la decisión, no sólo en un documento aparte.

## Sobre las dos propuestas de tu asistente

Las dos son correctas y las tomaría tal cual:

**`ExtractionRunRepository` con `save(run)` idempotente por
`(receipt_id, attempt)`**, guardando al empezar en `PENDING` y al cerrar. Encaja
con `extraction_runs_unique_attempt`, que es exactamente esa pareja, y dejar
rastro de un intento que se cayó a mitad es justo lo que hace útil esa tabla.

**`TenantSettingsReader` de sólo lectura, separado del repositorio de
comprobantes.** Y el matiz que añade es el bueno: si el tenant no tiene fila es
un fallo de infraestructura y sube como excepción, no como `DomainError`, porque
el esquema la crea con defaults y su ausencia sólo puede ser un bug. Ese
razonamiento es el correcto y está bien argumentado.
