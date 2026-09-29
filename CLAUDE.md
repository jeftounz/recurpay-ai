# RecurPay AI

Plataforma de cobranza recurrente con extracción de comprobantes por IA. Tres
módulos visibles —extractor con revisión humana, motor de conciliación,
dashboard— sobre un modelo de datos multi-tenant en PostgreSQL con RLS.

Es la pieza central de un portafolio: el código tiene que poder defenderse en
una entrevista, no sólo funcionar. Prefiere menos código que sepas explicar a
más código que no.

## Arquitectura: capas, no MVC

Cuatro capas con la dependencia siempre hacia adentro:

| Capa | Contiene | Qué NO sabe |
|---|---|---|
| `domain/` | Entidades, value objects, servicios de dominio | Que existen Next.js, Postgres, Claude, HTTP |
| `application/` | Casos de uso y **puertos** (interfaces) | Qué implementación hay detrás del puerto |
| `infrastructure/` | Adaptadores: repositorios, cliente LLM, almacenamiento | Nada del exterior lo importa directamente |
| `app/` | Rutas de Next, componentes, server actions | Reglas de negocio |

**No es MVC.** Lo que en MVC sería "el modelo" está partido a propósito: la
entidad en `domain/`, el puerto del repositorio en `application/`, la fila y su
mapper en `infrastructure/`. La tabla `receipts` no es el modelo de `Receipt`.

**En App Router no hay controladores.** Un Route Handler es el borde HTTP, un
Server Action el borde de mutación, un Server Component el de lectura. Los tres
traducen entre transporte y casos de uso. Si aparece una regla de negocio dentro
de un `route.ts`, está en el sitio equivocado.

## Restricciones del tooling que no son obvias

Estas rompen el build si se ignoran:

- **`erasableSyntaxOnly` está activo**: prohibidas las *parameter properties*
  (`constructor(private readonly x: T)`) porque generan código en vez de
  borrarse. Declara el campo y asigna en el cuerpo. Tampoco `enum` ni
  `namespace`.
- **Los imports relativos llevan la extensión `.ts`**: `from './Money.ts'`. Lo
  exige el type stripping nativo de Node.
- `verbatimModuleSyntax`: usa `import type` para lo que sólo sea tipo.
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Sin `any`;
  si necesitas `unknown`, valida y estrecha.
- Tests con el ejecutor nativo de Node (`node:test` + `node:assert/strict`), sin
  framework.

## Contrato de errores: una sola regla

- **Los constructores de value objects lanzan.** `Money` con moneda desconocida,
  sumar USD con VES, `ConfidenceScore` de 1.4: son estados imposibles, hay un
  bug y se quiere el stack trace.
- **Las transiciones de entidad y los casos de uso devuelven
  `Result<T, DomainError>`.** Cancelar dos veces, acreditar de más, confirmar con
  campos sin revisar: son respuestas legítimas del negocio y parte del contrato.
- Un fallo de infraestructura (la base cayó) **no** se envuelve en `Result`: es
  una excepción y debe subir.

## Usa los value objects que ya existen

Elegir el primitivo cómodo es lo que introduce el error. Estos ya están hechos y
probados:

| Para | Usa | Nunca |
|---|---|---|
| Dinero | `Money` (bigint en unidades menores) | `number`, float, `multiply(number)` |
| Fechas de negocio (`due_on`, `period_start`) | `CalendarDate` | `Date` — arrastra hora y zona, y desplaza un día |
| Instantes de evento (`paid_at`, `created_at`) | `Date` | `CalendarDate` |
| Confianza del modelo | `ConfidenceScore` (milésimas enteras) | float, porque `>= 0.85` no es fiable |
| Ciclo de cobro | `BillingPeriod` (semiabierto `[start, end)`) | dos fechas sueltas |

`CalendarDate.addMonths(n, anchorDay)` recorta al último día del mes y **conserva
el ancla**: 31 marzo → 30 abril → 31 mayo. Pasar siempre el ancla.

## Seguridad: requisito funcional, no checklist

- El tipo de archivo sale de los **magic bytes**, nunca de la extensión ni del
  `Content-Type`. Lista blanca: PNG, JPEG, PDF.
- El archivo subido **no se sirve de vuelta al navegador**. La `StorageKey` es
  opaca y la construye el sistema; el nombre que mandó el cliente no entra en
  ella ni se persiste.
- El contenido del documento es **entrada no confiable**: va delimitado y el
  prompt declara que son datos a analizar, nunca instrucciones a obedecer.
- La salida del modelo se valida contra Zod. Si no cumple, **es un fallo, no un
  dato**.
- `ANTHROPIC_API_KEY` sólo en el servidor. Nunca en un componente cliente, nunca
  en `NEXT_PUBLIC_`. Todas las llamadas al LLM pasan por route handlers.
- Nunca loguees el contenido de un comprobante ni datos personales: identificadores
  y metadatos.
- Mensajes de error genéricos al cliente; el detalle sólo en el log del servidor.

## Reglas de negocio ya decididas

No las reabras sin motivo; están razonadas en `claude/decisiones-*.md`.

- **Ancla de fin de mes**: se recorta al último día del mes y se conserva el
  ancla original.
- **Cancelación a mitad de ciclo**: la factura en curso se debe completa, sin
  prorrateo. Cancelar sólo impide ciclos futuros.
- **Excedente de un pago**: queda a favor y se aplica al emitir el siguiente
  ciclo, si `auto_reconcile_enabled`. El sobrepago sobre una factura se rechaza.
- **Pausa**: los ciclos de la pausa se saltan; al reanudar, el periodo arranca en
  la fecha de reanudación.
- **Umbral de confianza y días de gracia** salen de `tenant_settings`, no de
  constantes en el código.
- **Fallo de extracción**: máximo dos intentos, el segundo con la siguiente
  estrategia. Si vuelve a fallar, el comprobante queda en `FAILED`.

## Estado actual

**Verifica antes de creer esta sección.** Lo que sigue describe el repo una vez
integrado el código; si `domain/` no existe todavía, nada de esto está presente
y hay que integrarlo primero (ver `INTEGRACION.md`).

```bash
ls domain application infrastructure   # las tres deben existir
npm run test:domain                    # 128 tests en verde
```

Con eso en verde, está hecho y probado: `Money`, `Currency`, `CalendarDate`,
`ConfidenceScore`, `Receipt`, `ReceiptField`, el esquema Zod de extracción,
`BillingRule`, `BillingPeriod`, `Subscription`, `Invoice`,
`BillingCycleService`, el caso de uso `UploadReceipt` con validación por magic
bytes y deduplicación, y los repositorios en memoria de comprobantes.

Falta: rehidratación de agregados, pipeline de extracción, rutas HTTP, UI de
revisión, conciliación, dashboard.

La base de datos está montada en local. `db-schema.sql`, `db-seed.sql` y
`db-tests.sql` están verificados contra PostgreSQL 16: 23 tablas, 71 índices, 21
políticas RLS, 23 invariantes en verde. Los archivos viven fuera del repo, en
`../../recurpay-db-sql/`.

## Requisitos del entorno

- **Node 22.6 o superior.** Los tests corren sobre archivos `.ts` con el type
  stripping nativo; por debajo de esa versión no existe y la suite no arranca.
- `tsconfig.json` (el de Next) necesita `target: ES2022` o superior —`Money` usa
  literales `bigint`— y `allowImportingTsExtensions: true`, porque los imports
  relativos del dominio llevan `.ts`.
- Hay dos tsconfig a propósito: `tsconfig.domain.json` con las reglas estrictas
  para las tres capas, y el de Next para la app. `npm run typecheck` corre los
  dos.

## Trampas conocidas

- **Falta el camino de rehidratación.** Un agregado sólo puede nacer de su
  factory y avanzar por transiciones; no hay forma de reconstruirlo desde una
  fila. Sin `rehydrate(snapshot)` no hay repositorio de Postgres posible, y el
  repositorio en memoria guarda la instancia viva en vez de una copia.
- **`generate_series(..., interval '1 month')` degrada el día de cobro**: una vez
  que cae en 28 de febrero se queda en 28 para siempre. Para conservar el ancla
  hay que sumar al origen: `started_on + (n || ' months')::interval`.
- **El corte por tamaño de verdad va en el route handler**, abortando por
  `Content-Length` antes de bufferizar. La comprobación del caso de uso es
  defensa en profundidad.
- **Cada transacción debe fijar `app.tenant_id`** con `set_config(..., true)` o
  RLS no devuelve ni una fila. El tercer argumento en `true` es obligatorio: con
  un pool en modo transaction, una variable de sesión se filtra a la siguiente
  petición.
- **Decisión abierta**: cómo se confirma un campo que legítimamente no está en el
  comprobante. `ReceiptField.correct()` exige valor no vacío, así que un Zelle sin
  RIF quedaría atascado. Hay que resolverlo antes de la UI de revisión.

## Verificar antes de dar algo por hecho

```bash
npm run test:domain    # ejecutor nativo de Node
npm run typecheck      # tsc --noEmit con las banderas de arriba
```

Un cambio no está terminado hasta que ambos pasan. Si tocas fechas, corre además
la suite con `TZ=Pacific/Kiritimati` y `TZ=Pacific/Midway`: si el resultado
cambia, alguna fecha depende de la zona del proceso.
