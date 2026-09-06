import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const url = readFileSync(new URL('./.dburl', import.meta.url), 'utf8').trim();
const env = {
  ...process.env,
  DATABASE_URL: url,
  NODE_ENV: 'production',
  PGSSL: 'true',
  PORT: '3000',
};
const child = spawn('node', ['dist-server/index.js'], {
  env,
  stdio: 'inherit',
  cwd: new URL('.', import.meta.url).pathname,
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
