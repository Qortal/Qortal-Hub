import express from 'express';
import { getAccount, getAccountBalance } from './account';

export async function createHttpServer() {
  const app = express();
  app.use(express.json());

  app.get('/addresses/balance/:address', async (req, res) => {
    const address = req.params.address;

    try {
      const balance = await getAccountBalance(address); // should return string like "969.59515719"
      res.type('text').send(+balance); // ✅ sends plain text response
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });
  app.get('/addresses/:address', async (req, res) => {
    const address = req.params.address;

    try {
      const accountInfo = await getAccount(address); // should return string like "969.59515719"
      res.json(accountInfo);
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });
  app.get('/admin/apikey/test', async (req, res) => {
    try {
      res.type('text').send(true); // ✅ sends plain text response
    } catch (err: any) {
      res.status(500).type('text').send(`Error: ${err.message}`);
    }
  });
  const port = 12395;
  app.listen(port, () => {
    console.log(`🚀 HTTP API server running at http://localhost:${port}`);
  });
}
