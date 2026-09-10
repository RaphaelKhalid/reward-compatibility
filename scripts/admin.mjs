// Server-side operator tool. Never prints credentials or sends them to the public frontend.
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
const [action,envFile]=process.argv.slice(2);
if(!envFile)throw new Error('Usage: node scripts/admin.mjs secrets|start|pause|resume path-to-private-env');
const env=parseEnv(readFileSync(envFile,'utf8'));
const url='https://autolabs-reward-compatibility.raphaelbahadurkhan.workers.dev';
if(action==='secrets') {
  if(!env.OPENAI_API_KEY||!env.ADMIN_TOKEN)throw new Error('Required secret names not found');
  const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','bulk'],{
    input:JSON.stringify({OPENAI_API_KEY:env.OPENAI_API_KEY,ADMIN_TOKEN:env.ADMIN_TOKEN}),encoding:'utf8',windowsHide:true,
  });
  // Wrangler reports secret NAMES only. No environment or input is logged.
  process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.exit(result.status??1);
} else if(['start','pause','resume','retry-auth'].includes(action)) {
  const response=await fetch(`${url}/admin/${action}`,{method:'POST',headers:{authorization:`Bearer ${env.ADMIN_TOKEN}`}});
  if(!response.ok)throw new Error(`Owner command failed: HTTP ${response.status}`);
  console.log(JSON.stringify(await response.json(),null,2));
} else throw new Error('Unsupported action');
