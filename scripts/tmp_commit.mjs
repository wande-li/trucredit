import { execSync } from 'child_process';
const cwd = 'c:/Users/BW-LP-093/WorkBuddy/shopify-b2b-credit';
execSync('git add app/routes/app.billing.callback.tsx app/services/billing.server.ts', { cwd });
execSync('git commit -m "fix: billing callback blank page - strip .myshopify.com from admin URL + handle short charge names"', { cwd });
console.log(execSync('git log --oneline -3', { cwd, encoding: 'utf8' }));
execSync('git push', { cwd });
console.log('Push OK');
execSync('railway up --service trucredit-app', { cwd, stdio: 'inherit' });
