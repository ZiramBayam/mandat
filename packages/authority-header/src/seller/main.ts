#!/usr/bin/env node
/**
 * Reference seller process.
 *
 * Two things make this honest rather than a mock:
 *  1. It never invents a payment result. It runs verifyAuthority() against real
 *     Monad state and denies when the check says deny.
 *  2. It holds the resource until the commit state reaches the tier's threshold,
 *     and withholds when the state is unknown. See working/architecture.md 8.
 */

import { createServer } from "node:http";
import { createPublicClient, http, type Address } from "viem";
import { CommitIndex, MONAD_TESTNET, X402, mayRelease, policyFor } from "@mandat/protocol";
import { verifyAuthority, type SellerConfig, type SellerDecision } from "../protocol/verify.js";
import { DEMO_TIERS } from "./tiers.js";
import { MONAD_TESTNET as chainConfig } from "@mandat/protocol";

const PORT = Number(process.env["SELLER_PORT"] ?? "4020");
const SELLER = (process.env["SELLER_ADDRESS"] ?? "0x0000000000000000000000000000000000000000") as Address;
const REGISTRY = (process.env["AUTHORITY_REGISTRY"] ?? "0x0000000000000000000000000000000000000000") as Address;
const ENFORCER = (process.env["SKILL_AUTHORITY_ENFORCER"] ?? "0x0000000000000000000000000000000000000000") as Address;

if (REGISTRY === "0x0000000000000000000000000000000000000000" || ENFORCER === "0x0000000000000000000000000000000000000000") {
  process.stderr.write(
    "AUTHORITY_REGISTRY and SKILL_AUTHORITY_ENFORCER must be set. The seller verifies against real\n" +
      "deployed contracts and refuses to run against placeholders. Deploy first (working/plan.md G2).\n",
  );
  process.exit(1);
}

const client = createPublicClient({ transport: http(chainConfig.rpc) });
const commitIndex = new CommitIndex();

// The commit index is the one thing that cannot be faked. commitState exists
// only on the monadNewHeads subscription, so this socket must be alive before
// any payment is accepted, and the server refuses to serve without it.
const socket = new WebSocket(chainConfig.wss);
socket.addEventListener("open", () => {
  commitIndex.setConnected(true);
  socket.send(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["monadNewHeads"] }),
  );
});
socket.addEventListener("close", () => commitIndex.setConnected(false));
socket.addEventListener("error", () => commitIndex.setConnected(false));
socket.addEventListener("message", (event) => {
  const data = JSON.parse(String(event.data)) as { params?: { result?: unknown } };
  if (data.params?.result !== undefined) commitIndex.ingest(data.params.result);
});

const config: SellerConfig = {
  chainId: chainConfig.chainId,
  seller: SELLER,
  registry: REGISTRY,
  skillEnforcer: ENFORCER,
  tiers: DEMO_TIERS,
};

type Resource = { name: string; body: string; priceUsdc: number };
const RESOURCES: Record<string, Resource> = {
  "cheap-dataset": { name: "cheap-dataset", body: "a small, cheap answer", priceUsdc: 0.005 },
  "expensive-dataset": { name: "expensive-dataset", body: "a large, expensive answer", priceUsdc: 80 },
};

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, commitFeed: commitIndex.connected, facilitator: X402.facilitator }));
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const resource = RESOURCES[url.pathname.slice(1)];
  if (resource === undefined) {
    res.writeHead(404).end("unknown resource");
    return;
  }

  // In production the Authority Header rides in the x402 request extensions.
  // Parsed separately so the 402 challenge is emitted before any verification.
  const raw = req.headers["x-authority-header"];
  if (typeof raw !== "string" || raw.length === 0) {
    res.writeHead(402, {
      "content-type": "application/json",
      "x-payment-required": JSON.stringify({
        chain: chainConfig.chainId,
        facilitator: X402.facilitator,
        resource: resource.name,
        maxAmountRequired: String(Math.round(resource.priceUsdc * 1_000_000)),
        resourceName: resource.name,
        description: "Answer produced only after authority is verified and finality is reached.",
        mimeType: "application/json",
        payTo: SELLER,
        maxTimeoutSeconds: 60,
        extra: { name: "authority-header" },
      }),
    });
    res.end("payment required");
    return;
  }

  let decision: SellerDecision;
  try {
    decision = await verifyAuthority(client, JSON.parse(raw) as never, config);
  } catch (error) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    return;
  }

  if (!decision.allowed || decision.tier === null) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify(decision));
    return;
  }

  // Release policy. Withhold when the commit state is unknown: a dropped socket
  // must never become a released resource.
  const paymentTx = req.headers["x-payment-tx"];
  const required = policyFor(resource.priceUsdc).releaseAt;
  if (typeof paymentTx === "string" && paymentTx.length > 0) {
    const receipt = await client.getTransactionReceipt({ hash: paymentTx as `0x${string}` });
    const state = commitIndex.resolve(receipt.blockHash, Number(receipt.blockNumber));
    if (!mayRelease(state, required)) {
      res.writeHead(425, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...decision, withheld: true, observedCommitState: state, requiredCommitState: required }));
      return;
    }
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ...decision, resource: resource.body, releasedAt: required }));
});

server.listen(PORT, () => {
  process.stdout.write(`mandat seller on :${PORT} chain ${chainConfig.chainId} (${MONAD_TESTNET.name})\n`);
});
