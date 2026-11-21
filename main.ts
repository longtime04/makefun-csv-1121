// The driver the harness runs: `node main.ts` (Node 22 or later).
// It reads every case from the input directory, answers each one alone
// with run() from solve.js, and writes the answers in order to the
// output directory. Outside a container, MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Keep V8's incremental marking off for the whole run, set before
// solve.js is imported so its work runs under it too.
setFlagsFromString('--no-incremental-marking');

type Runner = { run: (input: unknown) => unknown };

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as Runner;

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The output directory is created up front, so a run that answers
// nothing (or fails part-way) still leaves a place for answers.json.
mkdirSync(outputDir, { recursive: true });

interface CaseFile {
  id: string;
  input: unknown;
}

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as CaseFile[];
if (!Array.isArray(cases)) throw new Error('cases.json does not hold an array of cases');

// One slot per case, filled in order, so the answers keep the cases'
// order without growing the array as they come in.
const answers: unknown[] = new Array(cases.length);

for (let i = 0; i < cases.length; i++) {
  answers[i] = run(cases[i]!.input);
}

writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
