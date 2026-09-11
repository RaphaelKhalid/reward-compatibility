// Uses existing local authentication; credentials never appear in arguments or output.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
const action=process.argv[2];
const base='https://autolabs-compatibility-21.raphaelbahadurkhan.workers.dev';
if(action==='secrets'){
  const vars=parseEnv(readFileSync(new URL('../.dev.vars',import.meta.url),'utf8'));
  if(!vars.OPENAI_API_KEY||!vars.ADMIN_TOKEN)throw Error('Missing existing configured credentials');
  const run=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','bulk','--config','v21/wrangler.jsonc'],{
    input:JSON.stringify({OPENAI_API_KEY:vars.OPENAI_API_KEY,ADMIN_TOKEN:vars.ADMIN_TOKEN}),encoding:'utf8',shell:false,
  });
  process.stdout.write(run.stdout??'');process.stderr.write(run.stderr??'');process.exit(run.status??1);
}
if(!['start','pause','resume','status','analysis'].includes(action))throw Error('Unsupported action');
const isRead=['status','analysis'].includes(action);
const vars=isRead?{}:parseEnv(readFileSync(new URL('../.dev.vars',import.meta.url),'utf8'));
const response=await fetch(base+(isRead?'/'+action:'/admin/'+action),isRead?{}:{method:'POST',headers:{authorization:'Bearer '+vars.ADMIN_TOKEN}});
console.log(JSON.stringify({http:response.status,data:await response.json()},null,2));
if(!response.ok)process.exitCode=1;
