import { createHash } from "node:crypto";
import { createServer } from "node:http";

// Isolated integration fixture, never included in the frontend runtime image.
function inspect(request) {
  return {
    url: request.url,
    host: request.headers.host,
    proto: request.headers["x-forwarded-proto"],
    client: request.headers["x-forwarded-for"],
    realIp: request.headers["x-real-ip"],
    forwarded: request.headers.forwarded,
    forwardedPort: request.headers["x-forwarded-port"],
  };
}
let uploadBytes = 0;
let releaseStream;
const server = createServer((request, response) => {
  if (request.url.startsWith("/api/docs")) {
    response.setHeader(
      "Content-Security-Policy",
      "script-src 'self' 'unsafe-inline'",
    );
    response.setHeader("Cache-Control", "private, no-store");
  }
  if (request.url.startsWith("/api/upload-progress")) {
    response.end(String(uploadBytes));
    return;
  }
  if (request.url.startsWith("/api/stream-release")) {
    releaseStream?.();
    releaseStream = undefined;
    response.end("released");
    return;
  }
  if (request.url.startsWith("/api/stream")) {
    response.write("first\n");
    releaseStream = () => response.end("done");
    return;
  }
  if (request.url.startsWith("/api/upload")) {
    uploadBytes = 0;
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      uploadBytes += chunk.length;
    });
    request.on("end", () => response.end(String(total)));
    return;
  }
  if (request.url.startsWith("/api/download")) {
    const body = Buffer.from("abcdefghijklmnopqrstuvwxyz");
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      response.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${body.length}`,
        "Accept-Ranges": "bytes",
      });
      response.end(body.subarray(start, end + 1));
    } else response.end(body);
    return;
  }
  response.writeHead(request.url.startsWith("/api/missing") ? 404 : 200, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(inspect(request)));
});
server.on("upgrade", (request, socket) => {
  const accept = createHash("sha1")
    .update(
      request.headers["sec-websocket-key"] +
        "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
    )
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const payload = Buffer.from(JSON.stringify(inspect(request)));
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  socket.write(Buffer.concat([header, payload]));
  socket.on("error", () => {});
});
server.listen(8080, "0.0.0.0");
