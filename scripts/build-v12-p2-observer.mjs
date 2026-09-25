// Node 22.13+; generate one Deno-compatible observer file with no package imports.
import {readFile,writeFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const root=new URL('../',import.meta.url);
const collector=await readFile(new URL('services/v12-executor/p2-outcomes.ts',root),'utf8');
const entry=(await readFile(new URL('docs/v12-p2/observer-index.ts',root),'utf8'))
  .replace("import {collectP2Outcomes} from '../../services/v12-executor/p2-outcomes.ts';",'');
const code='// Generated observer. Reads market outcomes; cannot place orders.\n'+stripTypeScriptTypes(collector+'\n'+entry);
await writeFile(new URL('docs/v12-p2/observer.js',root),code);
console.log('Generated docs/v12-p2/observer.js');
