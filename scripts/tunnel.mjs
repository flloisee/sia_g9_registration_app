import localtunnel from 'localtunnel';

// Tunnel the Express server, not Vite: the built app is a few stable requests,
// while the dev server's ~30 modules make any dropped request blank the page.
const port = Number(process.env.PORT ?? 4000);
const useCustom = (process.env.TUNNEL_USE_SUBDOMAIN ?? 'TRUE').toUpperCase() !== 'FALSE';
const requested = process.env.TUNNEL_SUBDOMAIN || 'event-registration-sia';
const expectedHost = `${requested}.loca.lt`;
const attempts = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
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

async function main() {
  const tunnel = await connect();
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
