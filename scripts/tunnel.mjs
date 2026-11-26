import { spawn } from 'node:child_process';
import localtunnel from 'localtunnel';

// Tunnel the Express server, not Vite: the built app is a few stable requests,
// while the dev server's ~30 modules make any dropped request blank the page.
const port = Number(process.env.PORT ?? 4000);
const provider = (
  process.argv.includes('--ngrok')
    ? 'ngrok'
    : process.argv.includes('--localtunnel')
      ? 'localtunnel'
      : (process.env.TUNNEL_PROVIDER ?? 'localtunnel')
).toLowerCase();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startLocaltunnel() {
  const useCustom = (process.env.TUNNEL_USE_SUBDOMAIN ?? 'TRUE').toUpperCase() !== 'FALSE';
  const requested = process.env.TUNNEL_SUBDOMAIN || 'event-registration-sia';
  const expectedHost = `${requested}.loca.lt`;
  const attempts = 4;

  if (!useCustom) {
    const tunnel = await localtunnel({ port });
    console.log(`Tunnel ready: ${tunnel.url}`);
    return tunnel;
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const tunnel = await localtunnel({ port, subdomain: requested });

    if (new URL(tunnel.url).hostname === expectedHost) {
      console.log(`Tunnel ready: ${tunnel.url}`);
      return tunnel;
    }

    // localtunnel silently hands out a random subdomain when the requested one is taken.
    tunnel.close();
    if (attempt === attempts) {
      console.error(
        `[tunnel] ${expectedHost} is unavailable — another tunnel is using it. ` +
          'Stop that process, set TUNNEL_SUBDOMAIN to a free name, or set ' +
          'TUNNEL_USE_SUBDOMAIN=FALSE in .env to accept a random URL.',
      );
      process.exit(1);
    }
    console.log(`[tunnel] ${expectedHost} is unavailable, retrying in 5s…`);
    await sleep(5000);
  }
}

async function waitForNgrokUrl(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:4040/api/tunnels');
      const data = await res.json();
      const tunnel = data.tunnels?.find((item) => item.public_url?.startsWith('https://'));
      if (tunnel) return tunnel.public_url;
    } catch {
      // The agent API is not up yet.
    }
    await sleep(500);
  }
  throw new Error(
    'ngrok did not report a tunnel. Run "ngrok config add-authtoken <token>" once, then retry.',
  );
}

async function startNgrok() {
  const child = spawn('ngrok', ['http', String(port)], { stdio: ['ignore', 'ignore', 'inherit'] });
  let ready = false;
  child.on('error', (error) => {
    console.error(
      error.code === 'ENOENT'
        ? '[tunnel] ngrok is not installed. Install it from https://ngrok.com/download, then retry.'
        : `[tunnel] could not start ngrok: ${error.message}`,
    );
    process.exit(1);
  });
  child.on('exit', (code) => {
    if (ready) {
      console.error(`[tunnel] ngrok exited (${code}); restart "npm run share:ngrok" to reconnect.`);
      process.exit(1);
    }
    console.error(
      '[tunnel] ngrok exited before connecting. Check "ngrok config check" and your authtoken.',
    );
    process.exit(1);
  });

  const url = await waitForNgrokUrl();
  ready = true;
  console.log(`Tunnel ready: ${url}`);
  console.log('[tunnel] Set APP_ORIGIN to that URL in .env and restart the server.');
}

async function main() {
  if (provider === 'ngrok') {
    await startNgrok();
    return;
  }
  if (provider !== 'localtunnel') {
    throw new Error(`Unknown TUNNEL_PROVIDER "${provider}" — use "ngrok" or "localtunnel".`);
  }

  const tunnel = await startLocaltunnel();
  tunnel.on('close', () => {
    console.log('[tunnel] connection closed, reconnecting in 3s…');
    setTimeout(() => {
      main().catch((error) => {
        console.error('[tunnel] reconnect failed:', error.message);
        process.exit(1);
      });
    }, 3000);
  });
}

main().catch((error) => {
  console.error('[tunnel] failed:', error.message);
  process.exit(1);
});
