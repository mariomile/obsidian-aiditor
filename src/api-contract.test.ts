import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Contratto dell'API cross-plugin — la superficie che ALTRI repo consumano.
 *
 * Exo chiama `app.plugins.plugins.aiditor.{addAnnotation,getAnnotations,
 * resolveAnnotation}` e ne ridichiara la forma dalla sua parte. Il contratto
 * oggi vive solo in un commento in cima ad `api.ts`: un commento non fallisce
 * quando qualcuno rinomina.
 *
 * Questo test mette il contratto dove appartiene — nel provider, cioè
 * nell'unico repo che può romperlo — e lo fa fallire al commit invece che in
 * silenzio a runtime dentro Exo.
 *
 * ⚠️ Rosso qui significa "aggiorna anche il consumer nominato", non "cambia
 * l'asserzione".
 */

const api = readFileSync(join(import.meta.dirname, 'api.ts'), 'utf8');
const main = readFileSync(join(import.meta.dirname, 'main.ts'), 'utf8');

const CONSUMED: ReadonlyArray<{ member: string; consumer: string }> = [
  { member: 'addAnnotation', consumer: 'obsidian-exo (tool add_annotation)' },
  { member: 'getAnnotations', consumer: 'obsidian-exo (tool list_annotations + get_active_context)' },
  { member: 'resolveAnnotation', consumer: 'obsidian-exo (tool resolve_annotation)' },
];

test('api.ts dichiara i membri che Exo consuma', () => {
  for (const { member, consumer } of CONSUMED) {
    assert.match(
      api,
      new RegExp(`\\b${member}\\b`),
      `\`${member}\` non è più in api.ts, ma è consumato da ${consumer}.`,
    );
  }
});

test('i membri sono esposti sull\'oggetto plugin (il percorso che Exo risolve)', () => {
  // Exo non importa nulla da aiditor: risolve `plugins.aiditor.<membro>` a
  // runtime. Se main.ts smette di esporli, l'import compila lo stesso e il
  // guasto si vede solo aprendo Exo.
  for (const { member } of CONSUMED) {
    assert.match(
      main,
      new RegExp(`\\b${member}\\b`),
      `main.ts non espone più \`${member}\` sull'oggetto plugin: Exo otterrebbe undefined.`,
    );
  }
});
