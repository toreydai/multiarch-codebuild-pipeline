const http = require('http');
const os = require('os');

const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    message: 'Hello from a multi-architecture container image!',
    arch: process.arch,
    platform: process.platform,
    hostname: os.hostname(),
    version: '1.1.0',
    nodeVersion: process.version
  }, null, 2));
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}, arch=${process.arch}`);
});
