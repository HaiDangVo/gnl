/**
 * Anchor a log checkpoint on Ronin (SPEC §6.3): a zero-value transaction to the game's own address whose data is
 * "GNL1" + sha256(JCS(checkpoint)). No contract, nothing held.
 *
 *   npm run anchor [-- checkpoint.json] [--mainnet]     anchor (a demo checkpoint when no file is given)
 *   npm run anchor -- verify <tx hash> [checkpoint.json] [--mainnet]
 */
import { readFileSync } from "node:fs";
import { formatEther } from "viem";
import { merkleRoot, sha256, canonical } from "../ref/gnl.js";
import { account, net, reader, writer } from "./ronin.js";

const MAGIC = "474e4c31"; // "GNL1"
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const fileArg = args.find((a) => a.endsWith(".json"));

function checkpoint() {
  if (fileArg) return JSON.parse(readFileSync(fileArg, "utf8"));
  const entries = [{ type: "demo", n: 1 }, { type: "demo", n: 2 }, { type: "demo", n: 3 }];
  return { origin: "https://sandbox.gio-no-luc.example", size: entries.length, root: merkleRoot(entries), t: "2026-11-04T00:00:00Z" };
}
const dataOf = (cp) => `0x${MAGIC}${sha256(canonical(cp)).toString("hex")}`;

if (args[0] === "verify") {
  const tx = await reader.getTransaction({ hash: args[1] });
  const block = await reader.getBlock({ blockNumber: tx.blockNumber });
  const ok = tx.input.startsWith(`0x${MAGIC}`) && tx.to?.toLowerCase() === tx.from.toLowerCase();
  console.log(`from     ${tx.from}\nblock    ${tx.blockNumber} at ${new Date(Number(block.timestamp) * 1000).toISOString()}\ndata     ${tx.input}`);
  console.log(ok && tx.input === dataOf(checkpoint()) ? "MATCHES the checkpoint" : "does NOT match the checkpoint");
  process.exit(ok ? 0 : 1);
}

const cp = checkpoint();
const me = account().address;
const balance = await reader.getBalance({ address: me });
if (balance === 0n) throw new Error(`${me} has no RON on ${net.name} — npm run wallet`);

const hash = await writer().sendTransaction({ to: me, value: 0n, data: dataOf(cp) });
const r = await reader.waitForTransactionReceipt({ hash });
const l2 = r.gasUsed * r.effectiveGasPrice;
const l1 = BigInt(r.l1Fee ?? 0); // OP Stack: what posting the data to Ethereum cost, on top of gas (raw hex: no OP formatter on a defineChain)
console.log(`checkpoint ${canonical(cp)}`);
console.log(`tx       ${net.explorer}/tx/${hash}`);
console.log(`block    ${r.blockNumber}, status ${r.status}`);
console.log(`gas      ${r.gasUsed} × ${r.effectiveGasPrice} wei = ${formatEther(l2)} RON`);
console.log(`L1 fee   ${formatEther(l1)} RON`);
console.log(`total    ${formatEther(l2 + l1)} RON`);
