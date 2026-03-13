import { createServer } from "node:http";
import { URL } from "node:url";

import { WebSocket, WebSocketServer } from "ws";

const rpcTarget = process.env.SOLANA_RPC_TARGET?.trim();
if (!rpcTarget) {
  throw new Error("SOLANA_RPC_TARGET is required");
}

const wsTarget =
  process.env.SOLANA_WS_TARGET?.trim() ||
  rpcTarget.replace(/^http/i, "ws");
const port = Number.parseInt(process.env.SOLANA_PROXY_PORT || "18898", 10);
if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid SOLANA_PROXY_PORT: ${process.env.SOLANA_PROXY_PORT}`);
}

function corsHeaders(req) {
  const originHeader = req?.headers?.origin;
  const requestHeaders = req?.headers?.["access-control-request-headers"];
  const privateNetworkRequest =
    req?.headers?.["access-control-request-private-network"] === "true";

  return {
    "Access-Control-Allow-Origin":
      typeof originHeader === "string" && originHeader.length > 0
        ? originHeader
        : "*",
    Vary:
      "Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network",
    "Access-Control-Allow-Headers":
      typeof requestHeaders === "string" && requestHeaders.length > 0
        ? requestHeaders
        : "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Max-Age": "600",
    ...(privateNetworkRequest
      ? { "Access-Control-Allow-Private-Network": "true" }
      : {}),
  };
}

function filterRequestHeaders(headers) {
  const filtered = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value == null) continue;
    const lower = name.toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "content-length" ||
      lower === "upgrade"
    ) {
      continue;
    }
    filtered[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return filtered;
}

function filterResponseHeaders(headers) {
  const filtered = {};
  headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (
      lower === "content-length" ||
      lower === "connection" ||
      lower === "transfer-encoding" ||
      lower === "access-control-allow-origin" ||
      lower === "access-control-allow-methods" ||
      lower === "access-control-allow-headers" ||
      lower === "access-control-allow-private-network" ||
      lower === "access-control-max-age" ||
      lower === "vary"
    ) {
      return;
    }
    filtered[name] = value;
  });
  return filtered;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function resolveTarget(base, requestUrl) {
  return new URL(requestUrl || "/", base);
}

function getRpcMethod(body) {
  if (!body || body.length === 0) return null;
  try {
    const payload = JSON.parse(body.toString("utf8"));
    return typeof payload?.method === "string" ? payload.method : null;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    console.log(
      `[solana-rpc-proxy] OPTIONS ${req.url || "/"} origin=${req.headers.origin || "-"} private-network=${req.headers["access-control-request-private-network"] || "-"}`,
    );
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  try {
    const body =
      req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const rpcMethod = getRpcMethod(body);
    const upstream = await fetch(resolveTarget(rpcTarget, req.url), {
      method: req.method,
      headers: filterRequestHeaders(req.headers),
      body,
    });
    console.log(
      `[solana-rpc-proxy] ${req.method || "GET"} ${req.url || "/"} ${rpcMethod || "-"} -> ${upstream.status}`,
    );

    res.writeHead(upstream.status, {
      ...filterResponseHeaders(upstream.headers),
      ...corsHeaders(req),
    });

    if (!upstream.body) {
      res.end();
      return;
    }

    const payload = Buffer.from(await upstream.arrayBuffer());
    res.end(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[solana-rpc-proxy] ${req.method || "GET"} ${req.url || "/"} -> 502 ${message}`,
    );
    res.writeHead(502, {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(req),
    });
    res.end(JSON.stringify({ error: message }));
  }
});

const wsServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  wsServer.handleUpgrade(request, socket, head, (clientSocket) => {
    const upstream = new WebSocket(resolveTarget(wsTarget, request.url), {
      headers: filterRequestHeaders(request.headers),
    });

    const closePeer = (peer, code, reason) => {
      if (
        peer.readyState === WebSocket.OPEN ||
        peer.readyState === WebSocket.CONNECTING
      ) {
        peer.close(code, reason);
      }
    };

    clientSocket.on("message", (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      }
    });
    clientSocket.on("close", (code, reason) => {
      closePeer(upstream, code, reason);
    });
    clientSocket.on("error", () => {
      closePeer(upstream, 1011, "client-error");
    });

    upstream.on("message", (data, isBinary) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(data, { binary: isBinary });
      }
    });
    upstream.on("close", (code, reason) => {
      closePeer(clientSocket, code, reason);
    });
    upstream.on("error", () => {
      closePeer(clientSocket, 1011, "upstream-error");
    });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `[solana-rpc-proxy] listening on http://127.0.0.1:${port} -> ${rpcTarget}`,
  );
});
