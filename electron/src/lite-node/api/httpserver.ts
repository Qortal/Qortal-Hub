import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import {
  getAccount,
  getAccountBalance,
  getAddressGroupInvites,
  getBans,
  getGroup,
  getGroupInvites,
  getGroupJoinRequests,
  getGroups,
  getLastReference,
  getNameInfo,
  getNames,
  getPrimaryName,
  getUnitFee,
  processTransaction,
} from './account';
import url from 'url';
import { Encoding } from '../protocol/payloads';
import { getActiveChat } from './chat';
import bodyParser from 'body-parser';

export async function createHttpServer() {
  const app = express();

  // First route that needs raw body (do not put JSON parser above this)
  app.post(
    '/transactions/process',
    bodyParser.raw({ type: '*/*' }),
    async (req, res) => {
      try {
        const rawBase58 = req.body.toString('utf8').trim();
        console.log('📨 Raw Transaction (base58):', rawBase58);

        const result = await processTransaction(rawBase58);
        res.json(result);
      } catch (err: any) {
        res.status(500).type('text').send(`Error: ${err.message}`);
      }
    }
  );

  // Now apply JSON parser for actual JSON endpoints
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

  app.get('/groups', async (req, res) => {
    try {
      const limit = req.query.limit || 100;
      const offset = req.query.offset || 0;
      const reverse = req.query.reverse || false;

      const groups = await getGroups(limit, offset, reverse);
      res.json(groups);
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });

  app.get('/groups/bans/:groupId', async (req, res) => {
    try {
      const groupId = req.params.groupId;

      const bans = await getBans(groupId);
      res.json(bans);
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });

  app.get('/groups/:groupId', async (req, res) => {
    try {
      const groupId = req.params.groupId;

      const groupInfo = await getGroup(groupId);
      res.json(groupInfo);
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });

  app.get('/groups/invites/:address', async (req, res) => {
    const address = req.params.address;
    try {
      const invites = await getAddressGroupInvites(address);
      res.json(invites);
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });
  app.get('/groups/invites/group/:groupId', async (req, res) => {
    const groupId = req.params.groupId;
    try {
      const invites = await getGroupInvites(groupId);
      res.json(invites);
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });

  app.get('/groups/joinrequests/:groupId', async (req, res) => {
    const groupId = req.params.groupId;
    try {
      const joinRequests = await getGroupJoinRequests(groupId);
      res.json(joinRequests);
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });

  app.get('/transactions/unitfee', async (req, res) => {
    try {
      const txType = req.query.txType as string;
      const timestamp = req.query.timestamp ? +req.query.timestamp : undefined;

      console.log('txType', txType, timestamp);

      const unitFee = await getUnitFee(txType, timestamp);
      res.type('text').send(unitFee.toString()); // ensure it's a string for .send()
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });

  app.get('/addresses/lastreference/:address', async (req, res) => {
    try {
      const address = req.params.address;
      const lastReference = await getLastReference(address);
      res.type('text').send(lastReference);
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });

  app.get('/names/primary/:address', async (req, res) => {
    try {
      const address = req.params.address;
      const primaryInfo = await getPrimaryName(address);
      res.json(primaryInfo);
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });
  app.get('/names/:name', async (req, res) => {
    try {
      const name = req.params.name;
      const nameInfo = await getNameInfo(name);
      res.json(nameInfo);
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });

  app.get('/names/address/:address', async (req, res) => {
    try {
      const address = req.params.address;
      const names = await getNames(address);
      res.json(names);
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const parsedUrl = url.parse(request.url!, true);
    const pathname = parsedUrl.pathname || '';

    if (pathname.startsWith('/websockets/chat/active/')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, parsedUrl);
      });
    } else {
      socket.destroy();
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

      const fetchAndSendActiveChats = async () => {
        try {
          const response = await getActiveChat(
            address,
            encoding,
            hasChatReference
          );

          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(response));
          }
        } catch (err) {
          console.error('Failed to fetch active chats:', err);
        }
      };

      // Fetch immediately after connection
      fetchAndSendActiveChats();

      // Then set up polling every 45 seconds
      const interval = setInterval(fetchAndSendActiveChats, 45000);

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
