import { ethers } from 'hardhat'
import { Contract } from 'ethers'
import { formatUnits } from 'ethers/lib/utils'

import FactoryArtifact from '@primitivefi/rmm-core/artifacts/contracts/PrimitiveFactory.sol/PrimitiveFactory.json'
import EngineArtifact from '@primitivefinance/rmm-core/artifacts/contracts/PrimitiveEngine.sol/PrimitiveEngine.json'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { Relayer } from 'defender-relay-client'
import { DefenderRelayProvider, DefenderRelaySigner } from 'defender-relay-client/lib/ethers'
import * as dotenv from 'dotenv'
dotenv.config()
const { API_KEY, API_SECRET } = process.env
const cred = { apiKey: API_KEY ?? '', apiSecret: API_SECRET ?? '' }
const relay = new DefenderRelayProvider(cred)

import { providers } from '@0xsequence/multicall'
const provider = new providers.MulticallProvider(relay)

import { FACTORY, MANAGER } from './addresses'
import { Coin, RMMPool } from './rmm'
import { computeEngineAddress, computePoolId, parseTokenURI } from './utils'
import { PoolInterface } from './interfaces'

export type Id = string
export type Sender = SignerWithAddress | Relayer

export class Fetcher {
  public static c: Contract = new Contract(MANAGER, ['function uri(uint256 tokenId) public view returns(string)'], provider)
  public static f: Contract = new Contract(FACTORY, FactoryArtifact.abi, provider)

  public static instance(a: string): Contract {
    return new Contract(a, EngineArtifact.abi, provider)
  }

  // get all engine(s) data
  public async engines(): Promise<string[]> {
    const filter = Fetcher.f.filters.DeployEngine()
    const events = await Fetcher.f.queryFilter(filter)
    const elms = events.map((log) => {
      if (log.event === 'DeployEngine' && log.args) return [log.args.engine, log.args.risky, log.args.stable]
    })

    let engines: string[] = []
    for (const element of elms) {
      const [engine, risky, stable] = element as any
      engines.push(engine)
    }

    return engines
  }

  public async pool(coin0: Coin, coin1: Coin, id: Id): Promise<RMMPool> {
    return Fetcher.c
      .uri(id)
      .then((raw: string) => {
        const uri: PoolInterface = parseTokenURI(raw)
        const pool = Fetcher.from(uri)
        return pool
      })
      .catch((e) => {
        console.log(`   - Error thrown on attempting to call uri on pool: ${coin0}-${coin1}-${id}`)
        console.error(e)
        return e
      })
  }

  // get all pool(s) data
  public async pools(coin0: Coin, coin1: Coin): Promise<RMMPool[]> {
    const a = computeEngineAddress(Fetcher.f.address, coin0, coin1)
    const e = Fetcher.instance(a)

    const filter = e.filters.Create()
    const events = await e.queryFilter(filter)
    const ids = Fetcher.ids(events, e.address)

    let calls: string[] = []
    for (const id of ids) {
      calls.push(Fetcher.c.uri(id))
    }

    return Promise.all(calls)
      .then((res) => {
        let pools: RMMPool[] = []
        for (let i = 0; i < calls.length; i++) {
          const raw = res[i]
          const uri: PoolInterface = parseTokenURI(raw) as PoolInterface
          const pool = Fetcher.from(uri)
          pools.push(pool)
        }

        return pools
      })
      .catch((e) => {
        console.log(`   - Error thrown in fetching pools with uri calls`)
        console.error(e)
        return e
      })
  }

  public static from(props: PoolInterface): RMMPool {
    const {
      properties: { risky, stable, reserve, calibration, invariant },
    } = props

    const pool = new RMMPool(
      risky.address,
      stable.address,
      parseFloat(formatUnits(reserve.reserveRisky, risky.decimals)),
      parseFloat(formatUnits(reserve.reserveStable, stable.decimals)),
      parseFloat(formatUnits(reserve.liquidity, 18)),
      parseFloat(formatUnits(calibration.strike, stable.decimals)),
      parseFloat(formatUnits(calibration.sigma, 4)),
      parseFloat(calibration.maturity),
      parseFloat(formatUnits(calibration.gamma, 4)),
      parseFloat(invariant ?? '0') / Math.pow(2, 64)
    )
    return pool
  }

  public static ids(events: any, engine: string): string[] {
    const poolIds = events.map((log) => {
      if (log.event === 'Create') {
        const args = log?.args
        const poolId = computePoolId(engine, args.strike, args.sigma, args.maturity, args.gamma)
        if (poolId !== '') return poolId
      }
    })
    return poolIds
  }
}
