// Production entry point (package.json "main" and "start"), as GoDaddy's
// Node.js hosting expects: a plain Node file that listens on process.env.PORT
// on all interfaces. It serves the Next.js app built by `npm run build`.
const { createServer } = require('node:http');
const next = require('next');

const port = Number(process.env.PORT) || 3000;
const hostname = '0.0.0.0';
const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    createServer((req, res) => handle(req, res)).listen(port, hostname, () => {
      console.log(JSON.stringify({ time: new Date().toISOString(), level: 'info', message: 'Listening', port }));
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
