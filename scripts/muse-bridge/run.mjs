import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createMuseRelay } from './relay.mjs';

const configFile = process.argv[2];
if (!configFile) throw new Error('Usage: node run.mjs /private/bridge.json');
const config = JSON.parse(await readFile(configFile,'utf8'));
if (!/^\/[A-Za-z0-9_/.-]+\.sock$/.test(config.remoteSocket) || !/^[A-Za-z0-9._-]+$/.test(config.remoteUser) || !/^[A-Za-z0-9.-]+$/.test(config.remoteHost))
  throw new Error('Invalid tunnel configuration');
const server = createMuseRelay(config);
const port = config.listenPort || 18712;
await new Promise((resolve,reject) => {server.once('error',reject); server.listen(port,'127.0.0.1',resolve);});
let child, reconnect, stopping = false, delay = 1000;
const log = event => console.log(JSON.stringify({time:new Date().toISOString(),event}));
if (config.pidFile) await writeFile(config.pidFile,String(process.pid),'utf8');
function connect() {
  if (stopping) return;
  const started = Date.now();
  child = spawn(config.sshExecutable || 'ssh.exe',[
    '-N','-T','-i',config.identityFile,
    '-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
    '-o',`UserKnownHostsFile=${config.knownHostsFile}`,
    '-o','ExitOnForwardFailure=yes','-o','ConnectTimeout=15',
    '-o','ServerAliveInterval=20','-o','ServerAliveCountMax=3',
    '-R',`${config.remoteSocket}:127.0.0.1:${port}`,
    `${config.remoteUser}@${config.remoteHost}`,
  ],{windowsHide:true,stdio:'ignore'});
  child.once('error',() => log('tunnel_launch_failed'));
  child.once('close',() => {
    if (stopping) return;
    if (Date.now() - started > 60000) delay = 1000;
    log('tunnel_reconnecting');
    reconnect = setTimeout(connect,delay);
    delay = Math.min(delay * 2,30000);
  });
  log('tunnel_started');
}
function stop() {stopping = true; clearTimeout(reconnect); child?.kill(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0),2000).unref();}
process.once('SIGINT',stop); process.once('SIGTERM',stop);
connect(); log('loopback_relay_ready');
