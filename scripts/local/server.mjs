import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const host = '127.0.0.1';
const port = 3210;
const origin = `http://${host}:${port}`;

// A stable loopback origin keeps browser-stored settings available between launches.
process.env.ORIGIN = origin;
process.env.BODY_SIZE_LIMIT = '48M';
process.env.PROTOCOL_HEADER = '';
process.env.HOST_HEADER = '';
process.env.PORT_HEADER = '';

const { handler } = await import('../../build/local/handler.js');
const server = createServer((request, response) => {
  if (request.headers.host !== `${host}:${port}`) {
    response.writeHead(421).end();
    return;
  }
  if (request.headers.origin && request.headers.origin !== origin) {
    response.writeHead(403).end('Open Tocify from its local address.');
    return;
  }
  if (request.url?.startsWith('/api/')) {
    response.setHeader('Cache-Control', 'no-store');
  }
  handler(request, response);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. If Tocify is already running, open ${origin}.`);
  } else {
    console.error(`Unable to start Tocify: ${error.message}`);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Tocify is running at ${origin}. Close this window to stop it.`);
  if (process.argv.includes('--no-open')) return;

  const [command, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', origin]]
    : process.platform === 'darwin' ? ['open', [origin]] : ['xdg-open', [origin]];
  const browser = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
  browser.on('error', () => console.log(`Open ${origin} in your browser.`));
  browser.unref();
});
