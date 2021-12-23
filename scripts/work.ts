import { DefenderRelaySigner } from 'defender-relay-client/lib/ethers'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'

import { getAddress } from 'ethers/lib/utils'

import { CHAIN_ID } from '../src/addresses'
import { Arbitrageur, TradeResult } from '../src/arb'
import { Fetcher, Id, cred } from '../src/fetcher'
import { Coin } from '../src/rmm'

async function main() {
  const signer = new DefenderRelaySigner(cred, Fetcher.p, { speed: 'fast' })

  const coin0 = getAddress('0xa8Daa10c0E6dDF98c5E64f1Ee5331b1368581e54') // rinkeby yfi beta.2
  const coin1 = getAddress('0xF1c735564171B8728911aDaACbEcA1A23294aA98') // rinkeby usdc beta.2
  const p = 31_503.29 // 12:07 utc -8

  const pools = await Fetcher.pools(coin0, coin1)
  const arb = new Arbitrageur()

  await Fetcher.engines()

  // prep
  const allowances = await Promise.all([Fetcher.allowance(coin0, signer), Fetcher.allowance(coin1, signer)])
  if (allowances?.[0] && allowances[0].isZero()) await Fetcher.approve(coin0, signer)
  if (allowances?.[1] && allowances[1].isZero()) await Fetcher.approve(coin1, signer)

  if (CHAIN_ID === 4) {
    const balances = await Promise.all([Fetcher.balanceOf(coin0, signer), Fetcher.balanceOf(coin1, signer)])
    if (balances[0].isZero() && balances[1].isZero())
      await Promise.all([Fetcher.faucet(coin0, 1_000, signer), Fetcher.faucet(coin1, 1_000_000, signer)])
  }

  let trades: { input: Coin; Ai: number; Ao; id: Id }[] = []
  for (const pool of pools) {
    const { Ai, Ao, coin }: TradeResult = arb.arbitrage(p, pool)

    if (Ai > 0) {
      const risky = getAddress(coin) === getAddress(coin0)
      const input = risky ? coin1 : coin0
      const symbols = [risky ? pool.symbol1 : pool.symbol0, risky ? pool.symbol0 : pool.symbol0]
      trades.push({ input, Ai, Ao, id: pool.poolId })
      console.log(`     - Swap ${Ai} ${symbols[0]} in for ${Ao} ${symbols[1]} out on pool: ${pool.poolId.substring(0, 6)}`)
      await Fetcher.swap(input, Ai, Ao, pool, signer) // do arb exact
    }
  }

  /* if (trades.length > 0) {
    const { input, Ai, Ao, id } = trades[0]
    const i = pools.findIndex((val) => val.poolId === id)
    await Fetcher.swap(input, Ai, Ao, pools[i], signer)
  } */
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
