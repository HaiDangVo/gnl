/**
 * Ronin, the chain checkpoints are anchored on (SPEC §6.3): Saigon (testnet) by default, mainnet with `--mainnet`.
 * The key is the game's own chain account — never the Ed25519 key that signs its messages.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const NETS = {
  saigon: { id: 202601, name: "Ronin Saigon", rpc: "https://saigon-testnet.roninchain.com/rpc", explorer: "https://saigon-explorer.roninchain.com" },
  mainnet: { id: 2020, name: "Ronin", rpc: "https://api.roninchain.com/rpc", explorer: "https://app.roninchain.com" },
};

export const net = NETS[process.argv.includes("--mainnet") ? "mainnet" : "saigon"];
const chain = defineChain({
  id: net.id,
  name: net.name,
  nativeCurrency: { name: "RON", symbol: "RON", decimals: 18 },
  rpcUrls: { default: { http: [net.rpc] } },
});

const KEY = new URL(`../.secrets/${net.id === 2020 ? "ronin" : "saigon"}.key`, import.meta.url);

/** The account, made on first use (the file is git-ignored, readable by its owner only). */
export function account() {
  if (!existsSync(KEY)) {
    mkdirSync(new URL(".", KEY), { recursive: true });
    writeFileSync(KEY, generatePrivateKey() + "\n", { mode: 0o600 });
  }
  return privateKeyToAccount(readFileSync(KEY, "utf8").trim());
}

export const reader = createPublicClient({ chain, transport: http() });
export const writer = () => createWalletClient({ chain, transport: http(), account: account() });
