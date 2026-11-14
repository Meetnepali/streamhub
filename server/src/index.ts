import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { startJobs } from './jobs/index.js';
import { attachMeetingSockets } from './modules/meetings/socket.js';

const app = createApp();
const server = createServer(app);
attachMeetingSockets(server);
startJobs();

server.listen(config.port, () => {
  console.log(`StreamHub API listening on http://localhost:${config.port}`);
});
