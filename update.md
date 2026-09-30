# Registro de cambios

Cada sección documenta un paso: qué se hizo, por qué y cómo se verificó.

## Paso 0 — Integración del núcleo (`recurpay-core.tar.gz`)

### Qué se hizo

Se siguió `INTEGRACION.md`:

- `domain/`, `application/` e `infrastructure/` copiados a la raíz, junto a `app/`.
  El tarball y la copia desempacada en `~/Downloads/recurpay-core` se compararon
  con `diff -r` antes de copiar: son idénticos.
- `tsconfig.domain.json` creado desde el `tsconfig.json` del tarball, con el
  `include` ampliado a las tres capas (el del tarball sólo cubría `domain/`).
- `tsconfig.json` de Next: `target: ES2022`, `allowImportingTsExtensions: true`,
  y `**/*.test.ts` excluido.
- Dependencias: `zod@^3.23.8` (la versión con la que se probó el núcleo; un
  `npm install zod` sin versión instalaría la v4, con API distinta) y
  `typescript@^5.9`.
- Scripts `test:domain` y `typecheck` en `package.json`.

### Desviación respecto a `INTEGRACION.md`

**Se añadió `"type": "module"` al `package.json` raíz.** El documento no lo pide,
pero el `package.json` del tarball lo tenía y sin él:

- Node trata los `.ts` como de tipo indeterminado y emite
  `MODULE_TYPELESS_PACKAGE_JSON` en cada archivo de test.
- `tsc` con `module: NodeNext` + `verbatimModuleSyntax` los considera CommonJS y
  rechaza cada `import`/`export` (`TS1295`, `TS1287`).

Los archivos de configuración de Next ya son `.ts`/`.mjs`, así que el cambio no
les afecta; `npm run build` lo confirma.

### Verificación

| Comando | Resultado |
|---|---|
| `npm run test:domain` | 144 / 144 en verde |
| `TZ=Pacific/Kiritimati npm run test:domain` | 144 / 144 |
| `TZ=Pacific/Midway npm run test:domain` | 144 / 144 |
| `npm run typecheck` | sin errores (dominio estricto + Next) |
| `npm run build` | compila |

**Nota:** los documentos decían 128 tests. Confirmado que 144 es lo correcto:
el 128 salía de un entorno sin zod, donde se excluyeron `extraction-schema.test.ts`
(10) y `ReceiptExtractionMapper.test.ts` (6).

## Punto 1 — Rehidratación de agregados

### Qué se hizo

| Archivo | Cambio |
|---|---|
| `domain/receipts/ReceiptField.ts` | `ReceiptField.rehydrate(snapshot)`. La invariante raw/normalized pasa del factory `extracted()` al constructor, para que la cumplan los dos caminos de nacimiento. |
| `domain/receipts/Receipt.ts` | `Receipt.rehydrate(snapshot)`. `validateFieldSet()` y `lowestConfidence()` se extraen de `completeExtraction()` y ahora los comparten la transición y la rehidratación. |
| `domain/shared/copyInstant.ts` | Copia defensiva de `Date`, usada por `toSnapshot()` y `rehydrate()`. |
| `infrastructure/receipts/InMemoryReceiptRepository.ts` | Guarda `ReceiptSnapshot` y rehidrata una instancia nueva en cada lectura. |
| `infrastructure/receipts/InMemoryReceiptRepository.test.ts` | Nuevo. |

### Decisiones

1. **`rehydrate` lanza, no devuelve `Result`.** Restaura un estado que ya fue
   válido; no toma una decisión de negocio. Un snapshot que viola un invariante
   indica corrupción o un bug del mapper: es el mismo caso que un value object
   con un valor imposible.
2. **No reproduce transiciones.** Las transiciones validan reglas del momento
   en que ocurrieron (el umbral de entonces, el actor de entonces). Lo que sí se
   valida son los invariantes de estado, espejo de los `CHECK` de `receipts`:
   - campos completos sólo en `NEEDS_REVIEW` / `CONFIRMED` / `REJECTED`;
   - `overallConfidence` igual a la mínima de los campos;
   - `rejectedReason` sólo en `FAILED` / `REJECTED`, y obligatorio ahí;
   - `paymentId`, `confirmedBy` y `confirmedAt` juntos, y sólo en `CONFIRMED`;
   - `storageKey` y `contentHash` se vuelven a parsear con sus value objects.
3. **`requiresReview` no se recalcula.** Es la foto del umbral vigente al
   extraer. Si el tenant cambia el umbral, los comprobantes ya revisados no
   vuelven a la cola.
4. **`finalValue` se verifica, no se restaura.** En la base es una columna
   generada; si no coincide con lo que se deriva, la fila no salió de este
   agregado.
5. **Copia defensiva de `Date`.** `toSnapshot()` devolvía la misma instancia
   de `confirmedAt` y de `correction.at`, y `Date` es mutable: mutar el snapshot
   cambiaba el agregado. Sin esto, guardar snapshots en el repositorio no
   habría aislado nada.

### Nota para el repositorio de Postgres

`receipt_fields` es único por `(extraction_run_id, field_key)`, no por
comprobante. Al construir el snapshot, el mapper debe tomar sólo los campos del
run `SUCCEEDED`. Hoy sólo puede haber uno, porque los runs rechazados no
producen campos, pero la consulta tiene que decirlo explícitamente.

### Verificación

| Comando | Resultado |
|---|---|
| `npm run test:domain` | 156 / 156 (144 + 12 nuevos) |
| Con `TZ=Pacific/Kiritimati` y `TZ=Pacific/Midway` | 156 / 156 |
| `npm run typecheck` | sin errores |

Comprobación del test del repositorio: contra la implementación original, que
guardaba la instancia viva, fallan los dos tests de aislamiento; contra la
nueva, pasan.
