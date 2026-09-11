// Existing local credentials are sent only to the verified owned Worker.
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
const action=process.argv[2],base='https://autolabs-reward-categories-22.raphaelbahadurkhan.workers.dev';
if(action==='secrets'){
  const vars=parseEnv(readFileSync(new URL('../.dev.vars',import.meta.url),'utf8'));
  if(!vars.OPENAI_API_KEY||!vars.ADMIN_TOKEN)throw Error('Missing configured credentials');
  const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','bulk','--config','v22/wrangler.jsonc'],{input:JSON.stringify({OPENAI_API_KEY:vars.OPENAI_API_KEY,ADMIN_TOKEN:vars.ADMIN_TOKEN}),encoding:'utf8',shell:false});
  process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.exit(result.status??1);
}
if(!['arm','start','pause','resume','retry-config','account-failed','status','analysis'].includes(action))throw Error('Unsupported action');
const read=['status','analysis'].includes(action);
const vars=read?{}:parseEnv(readFileSync(new URL('../.dev.vars',import.meta.url),'utf8'));
const response=await fetch(base+(read?'/'+action:'/admin/'+action),{...(read?{}:{method:'POST',headers:{authorization:'Bearer '+vars.ADMIN_TOKEN}}),signal:AbortSignal.timeout(20000)});
console.log(JSON.stringify({http:response.status,data:await response.json()},null,2));if(!response.ok)process.exitCode=1;
