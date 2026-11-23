import http from "node:http";

const port = Number(process.env.PORT ?? 26038);
const upstreamPort = Number(process.env.V2_PREVIEW_UPSTREAM_PORT ?? 5000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid V2 preview proxy port: ${process.env.PORT}`);
}

if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) {
  throw new Error(
    `Invalid V2 preview upstream port: ${process.env.V2_PREVIEW_UPSTREAM_PORT}`,
  );
}

const server = http.createServer((request, response) => {
  const headers = { ...request.headers, host: `127.0.0.1:${upstreamPort}` };
  delete headers.connection;
  delete headers["proxy-connection"];
  delete headers.upgrade;

  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("error", (error) => {
    if (!response.headersSent) {
      response.writeHead(502, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      });
    }
    response.end(JSON.stringify({ error: "The V2 preview server is unavailable." }));
    console.error(JSON.stringify({
      event: "v2.preview_proxy.upstream_error",
      code: error.code ?? "UNKNOWN",
    }));
  });

  request.on("aborted", () => upstream.destroy());
  response.on("close", () => {
    if (!response.writableEnded) upstream.destroy();
  });
  request.pipe(upstream);
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({
    event: "v2.preview_proxy.started",
    port,
    upstreamPort,
  }));
});
