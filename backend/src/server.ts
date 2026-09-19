import http from "node:http";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 5000);
const server = http.createServer(createApp());

server.listen(port, () => {
  // Rewritten in Task 5 with the pino logger and a real boot sequence.
  // `process.stdout.write` rather than console.log: `no-console` is an error.
  process.stdout.write(`api listening on ${String(port)}\n`);
});
