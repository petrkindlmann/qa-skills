// An MCP server built with the official SDK, stateless Streamable HTTP as in the SDK's
// simpleStatelessStreamableHttp example. One tool writes: create_note appends a line.
// MODE: plain | memory (dedup on idempotency_key in the process) | durable (dedup in a file)
import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import * as z from 'zod/v4';

const [file, mode = 'plain', port = '0'] = process.argv.slice(2);
const seen = new Map();
const keysFile = `${file}.keys`;
const durable = () => fs.existsSync(keysFile) ? new Map(JSON.parse(fs.readFileSync(keysFile, 'utf8'))) : new Map();

const getServer = () => {
  const server = new McpServer({ name: 'notes', version: '1.0.0' });
  server.registerTool('create_note', {
    description: 'Creates a note',
    inputSchema: { text: z.string(), idempotency_key: z.string().optional() },
  }, async ({ text, idempotency_key: key }) => {
    const known = mode === 'memory' ? seen : mode === 'durable' ? durable() : null;
    if (known && key && known.has(key)) return { content: [{ type: 'text', text: known.get(key) }] };
    const id = `note-${fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length + 1 : 1}`;
    fs.appendFileSync(file, `${JSON.stringify({ id, text })}\n`);
    if (known && key) {
      known.set(key, id);
      if (mode === 'durable') fs.writeFileSync(keysFile, JSON.stringify([...known]));
    }
    return { content: [{ type: 'text', text: id }] };
  });
  return server;
};

const app = createMcpExpressApp();
app.post('/mcp', async (req, res) => {
  const server = getServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
  res.on('close', () => { transport.close(); server.close(); });
});
app.get('/mcp', (req, res) => res.writeHead(405).end());
const listener = app.listen(Number(port), '127.0.0.1', () => console.log(`listening ${listener.address().port}`));
