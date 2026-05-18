const http = require('http');

// Polls http://localhost:4300/main.js until it returns non-empty content,
// then exits 0 so the next command in the chain (electron) can start.
// This avoids a race condition where wait-on passes as soon as the dev
// server port opens, before esbuild finishes the first compilation.

const MIN_BYTES = 1000;
const POLL_MS = 400;

function check() {
  const req = http.get('http://localhost:4300/main.js', res => {
    let size = 0;
    res.on('data', chunk => { size += chunk.length; });
    res.on('end', () => {
      if (res.statusCode === 200 && size >= MIN_BYTES) {
        process.exit(0);
      } else {
        setTimeout(check, POLL_MS);
      }
    });
  });
  req.on('error', () => setTimeout(check, POLL_MS));
}

check();
