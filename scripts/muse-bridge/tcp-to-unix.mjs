import net from 'node:net';

// A container-local TCP listener, with no published ports. SSH carries the
// connection from the mounted Unix socket back to the scoped desktop relay.
const server = net.createServer(client => {
  const remote = net.connect(process.env.MUSE_SOCKET || '/run/muse/muse.sock');
  const close = () => {client.destroy();remote.destroy();};
  for (const socket of [client,remote]) {
    socket.setTimeout(660000,close);
    socket.on('error',close);
    socket.on('close',close);
  }
  remote.on('connect',() => {client.pipe(remote);remote.pipe(client);});
});
server.maxConnections = 32;
server.listen(18610,'127.0.0.1');
