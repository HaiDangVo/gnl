// `npm run wallet [-- --mainnet]`: the game's chain address and balance (the key is made on first run).
import { formatEther } from "viem";
import { account, net, reader } from "./ronin.js";

const { address } = account();
console.log(`${net.name} (chain ${net.id})`);
console.log(`address  ${address}`);
console.log(`balance  ${formatEther(await reader.getBalance({ address }))} RON`);
if (net.id !== 2020) console.log("testnet RON: https://faucet.roninchain.com (paste the address, up to 5 requests a day)");
