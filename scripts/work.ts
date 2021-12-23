import { DefenderRelaySigner } from 'defender-relay-client/lib/ethers'
import { ethers } from 'hardhat'
import { Arbitrageur, TradeResult } from '../src/arb'
import { Fetcher, Id, cred } from '../src/fetcher'
import { Coin } from '../src/rmm'

async function main() {
  const signer = new DefenderRelaySigner(cred, Fetcher.p, { speed: 'fast' })

  const coin0 = '0xa8Daa10c0E6dDF98c5E64f1Ee5331b1368581e54' // rinkeby yfi beta.2
  const coin1 = '0xF1c735564171B8728911aDaACbEcA1A23294aA98' // rinkeby usdc beta.2
  const p = 31_503.29 // 12:07 utc -8

  const pools = await Fetcher.pools(coin0, coin1)
  const arb = new Arbitrageur()

  let trades: { input: Coin; trade: number; id: Id }[] = []
  for (const pool of pools) {
    const { trade, coin }: TradeResult = arb.arbitrage(p, pool)

    if (trade > 0) {
      const input = coin === coin0 ? coin1 : coin0
      trades.push({ input, trade, id: pool.poolId })
    }
  }

  if (trades.length > 0) {
    const { input, trade, id } = trades[0]
    const i = pools.findIndex((val) => val.poolId === id)
    //await Fetcher.swap(input, trade, pools[i], signer)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
