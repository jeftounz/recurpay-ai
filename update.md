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

**Nota:** `CLAUDE.md` e `INTEGRACION.md` dicen 128 tests. El recuento real por
archivo (13 archivos de test) suma 144, y es estable entre zonas horarias. Los
documentos parecen desactualizados; pendiente de confirmar.
