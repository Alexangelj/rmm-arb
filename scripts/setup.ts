import { DefenderRelaySigner } from 'defender-relay-client/lib/ethers'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'

import { getAddress } from 'ethers/lib/utils'

import { CHAIN_ID } from '../src/addresses'
import { Fetcher, cred } from '../src/fetcher'

async function main() {
  const signer = new DefenderRelaySigner(cred, Fetcher.p, { speed: 'fast' })

  const coin0 = getAddress('0xa8Daa10c0E6dDF98c5E64f1Ee5331b1368581e54') // rinkeby yfi beta.2
  const coin1 = getAddress('0xF1c735564171B8728911aDaACbEcA1A23294aA98') // rinkeby usdc beta.2

  await Fetcher.engines()

  // prep
  const allowances = await Promise.all([Fetcher.allowance(coin0, signer), Fetcher.allowance(coin1, signer)])
  if (allowances?.[0] && allowances[0].isZero()) await Fetcher.approve(coin0, signer)
  if (allowances?.[1] && allowances[1].isZero()) await Fetcher.approve(coin1, signer)

  if (CHAIN_ID === 4) {
    await Promise.all([Fetcher.faucet(coin0, 1_000, signer), Fetcher.faucet(coin1, 1_000_000, signer)])
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
