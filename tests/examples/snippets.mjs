import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

// Execute the actual documented examples. A second implementation of the recipe
// would stay green when the instructions themselves regress.
export const repository = process.env.QA_SKILLS_ROOT
  ? path.resolve(process.env.QA_SKILLS_ROOT)
  : fileURLToPath(new URL('../../', import.meta.url));

export function snippet(relativePath, identifier) {
  const text = fs.readFileSync(path.join(repository, relativePath), 'utf8');
  const blocks = [...text.matchAll(/^```(?:ts|typescript|js|javascript)\r?\n([\s\S]*?)^```/gm)]
    .map(match => match[1]).filter(block => block.includes(identifier));
  assert.equal(blocks.length, 1, `Expected one example containing ${identifier} in ${relativePath}`);
  return blocks[0];
}

export function loadFunctions(relativePath, identifier, names, dependencies = {}) {
  const code = stripTypeScriptTypes(snippet(relativePath, identifier), { mode: 'strip' })
    .replace(/^import\s[^\n]+\n/gm, '')
    .replace(/^export\s/gm, '');
  return new Function(...Object.keys(dependencies), `${code}\nreturn { ${names.join(', ')} };`)
    (...Object.values(dependencies));
}
