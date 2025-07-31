import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { getAccount, getAccountBalance } from './account';
import url from 'url';
import { Encoding } from '../protocol/payloads';
import { getActiveChat } from './chat';

export async function createHttpServer() {
  const app = express();
  app.use(express.json());

  app.get('/addresses/balance/:address', async (req, res) => {
    const address = req.params.address;
    try {
      const balance = await getAccountBalance(address);
      res.type('text').send(+balance);
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });

  app.get('/addresses/:address', async (req, res) => {
    const address = req.params.address;
    try {
      const accountInfo = await getAccount(address);
      res.json(accountInfo);
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });

  app.get('/admin/apikey/test', async (req, res) => {
    try {
      res.type('text').send(true);
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });

  app.get('/admin/settings/localAuthBypassEnabled', async (req, res) => {
    try {
      res.type('text').send(true);
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const parsedUrl = url.parse(request.url!, true);
    const pathname = parsedUrl.pathname || '';

    // Basic router for WebSocket endpoints
    if (pathname.startsWith('/websockets/chat/active/')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, parsedUrl);
      });
    } else {
      socket.destroy(); // Reject unknown paths
    }
  });

  wss.on('connection', (ws, request, parsedUrl) => {
    const pathname = parsedUrl.pathname!;
    const query = parsedUrl.query;

    if (pathname.startsWith('/websockets/chat/active/')) {
      const address = pathname.replace('/websockets/chat/active/', '');
      const hasChatReference = query.haschatreference === 'true';

      console.log(
        `🧩 Connected to /chat/active/${address} (hasChatReference=${hasChatReference})`
      );

      const encoding = Encoding.BASE64;

      // Setup polling
      const interval = setInterval(async () => {
        try {
          const response = await getActiveChat(
            address,
            encoding,
            hasChatReference
          );

          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(response)); // Send to frontend
          }
        } catch (err) {
          console.error('Failed to fetch active chats:', err);
        }
      }, 10000);

      ws.on('message', (msg) => {
        const message = msg.toString();
        if (message === 'ping') {
          ws.send('pong');
        } else {
          ws.send(`Echo: ${msg}`);
        }
      });

      ws.on('close', () => {
        console.log(`❌ Chat socket closed for ${address}`);
        clearInterval(interval);
      });
    } else {
      // Optional: handle other routes if needed
      ws.close();
    }
  });

  const port = 12395;
  server.listen(port, () => {
    console.log(
      `🚀 HTTP + WebSocket server running on http://localhost:${port}`
    );
  });
}
