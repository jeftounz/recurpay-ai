import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMimeType } from './detectMimeType.ts';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const JPEG_EXIF = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10]);
const PDF = Uint8Array.from([...Buffer.from('%PDF-1.7\n')]);

test('reconoce los tres tipos permitidos por su firma', () => {
  assert.equal(detectMimeType(PNG), 'image/png');
  assert.equal(detectMimeType(JPEG), 'image/jpeg');
  assert.equal(detectMimeType(PDF), 'application/pdf');
});

test('acepta JPEG con distintos marcadores en el cuarto byte', () => {
  // JFIF (E0) y Exif (E1) son los dos habituales: comprobar cuatro bytes
  // rechazaría la mitad de las fotos que salen de un teléfono.
  assert.equal(detectMimeType(JPEG), 'image/jpeg');
  assert.equal(detectMimeType(JPEG_EXIF), 'image/jpeg');
});

test('un archivo que dice ser PNG por el nombre pero es otra cosa se rechaza', () => {
  // Esto es lo que pasa si confías en la extensión: un script con nombre
  // comprobante.png. La firma no miente.
  const script = Uint8Array.from([...Buffer.from('#!/bin/sh\nrm -rf /\n')]);
  assert.equal(detectMimeType(script), null);
});

test('rechaza tipos plausibles pero fuera de la lista blanca', () => {
  const gif = Uint8Array.from([...Buffer.from('GIF89a')]);
  const svg = Uint8Array.from([...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')]);
  const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
  const webp = Uint8Array.from([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')]);

  // SVG es el más peligroso de los cuatro: es XML, admite <script> y el
  // navegador lo ejecuta si alguna vez se sirviera de vuelta.
  assert.equal(detectMimeType(svg), null);
  assert.equal(detectMimeType(gif), null);
  assert.equal(detectMimeType(zip), null);
  assert.equal(detectMimeType(webp), null);
});

test('un PNG con un byte cambiado en la firma se rechaza', () => {
  const corrupto = Uint8Array.from(PNG);
  corrupto[3] = 0x00;
  assert.equal(detectMimeType(corrupto), null);
});

test('rechaza un polyglot que esconde la firma tras un prólogo', () => {
  // Basura antes de %PDF-. La spec de PDF lo tolera, nosotros no: aceptar
  // contenido arbitrario antes de la firma es justo lo que permite que un
  // archivo pase por una cosa ante un validador y por otra ante el siguiente.
  const conPrologo = Uint8Array.from([...Buffer.from('GIF89a'), ...Buffer.from('%PDF-1.7')]);
  assert.equal(detectMimeType(conPrologo), null);
});

test('un archivo vacío o más corto que la firma no revienta', () => {
  assert.equal(detectMimeType(new Uint8Array(0)), null);
  assert.equal(detectMimeType(Uint8Array.from([0x89, 0x50])), null);
  assert.equal(detectMimeType(Uint8Array.from([0xff, 0xd8])), null, 'dos bytes no bastan para JPEG');
});
