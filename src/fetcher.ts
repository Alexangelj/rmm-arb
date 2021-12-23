import { ethers } from 'hardhat'
import { BigNumber, Contract } from 'ethers'
import { formatUnits, Interface, parseUnits } from 'ethers/lib/utils'
import { TransactionResponse } from '@ethersproject/providers'
import { MaxUint256 } from '@ethersproject/constants'

import ERC20Artifact from '@primitivefi/rmm-core/artifacts/contracts/interfaces/IERC20.sol/IERC20.json'
import FactoryArtifact from '@primitivefi/rmm-core/artifacts/contracts/PrimitiveFactory.sol/PrimitiveFactory.json'
import EngineArtifact from '@primitivefi/rmm-core/artifacts/contracts/PrimitiveEngine.sol/PrimitiveEngine.json'
import ManagerArtifact from '@primitivefi/rmm-manager/artifacts/contracts/PrimitiveManager.sol/PrimitiveManager.json'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { DefenderRelayProvider, DefenderRelaySigner } from 'defender-relay-client/lib/ethers'
import * as dotenv from 'dotenv'
dotenv.config()
const { API_KEY, API_SECRET } = process.env
export const cred = { apiKey: API_KEY ?? '', apiSecret: API_SECRET ?? '' }
const relay = new DefenderRelayProvider(cred)

import { providers } from '@0xsequence/multicall'
const provider = new providers.MulticallProvider(relay)

import { FACTORY, MANAGER } from './addresses'
import { Coin, RMMPool } from './rmm'
import { computeEngineAddress, computePoolId, parseTokenURI } from './utils'
import { PoolInterface } from './interfaces'
import { Time, toBN } from 'web3-units'

export type Id = string
export type Sender = SignerWithAddress | DefenderRelaySigner

export class Fetcher {
  public static p: DefenderRelayProvider = relay
  public static c: Contract = new Contract(MANAGER, ManagerArtifact.abi, provider)
  public static f: Contract = new Contract(FACTORY, FactoryArtifact.abi, provider)
  public static i: Interface = new Interface(ManagerArtifact.abi)

  public static instance(a: string): Contract {
    return new Contract(a, EngineArtifact.abi, provider)
  }

  public static async faucet(coin: Coin, wad: number, signer: Sender): Promise<TransactionResponse> {
    const abi = ['function mint(address to, uint256 wad) public', 'function decimals() public view returns(uint8)']
    const instance = new Contract(coin, abi, signer)
    const decimals = await instance.decimals()
    const amt = parseUnits(wad.toString(), decimals)
    return instance
      .mint(await signer.getAddress(), amt)
      .then((resp) => resp)
      .catch((e) => console.error(e))
  }

  public static async balanceOf(coin: Coin, signer: Sender): Promise<BigNumber> {
    const instance = new Contract(coin, ERC20Artifact.abi, signer)
    return instance
      .balanceOf(await signer.getAddress())
      .then((resp) => resp)
      .catch((e) => console.error(e))
  }

  public static async allowance(coin: Coin, signer: Sender): Promise<BigNumber> {
    const instance = new Contract(coin, ERC20Artifact.abi, signer)
    return instance
      .allowance(await signer.getAddress(), Fetcher.c.address)
      .then((resp) => resp)
      .catch((e) => console.error(e))
  }

  public static async approve(coin: Coin, signer: Sender): Promise<TransactionResponse> {
    const instance = new Contract(coin, ERC20Artifact.abi, signer)
    return instance
      .approve(Fetcher.c.address, MaxUint256)
      .then((resp) => resp)
      .catch((e) => console.error(e))
  }

  public static async swap(
    input: Coin,
    d: number,
    output: number,
    pool: RMMPool,
    signer: Sender
  ): Promise<TransactionResponse> {
    const recipient = await signer.getAddress()
    const coin0In = input === pool.coin0
    const deltaIn = parseUnits(d.toFixed(pool.decimals1), coin0In ? pool.decimals0 : pool.decimals1).toHexString()
    const deltaOut = parseUnits(output.toFixed(pool.decimals0), coin0In ? pool.decimals1 : pool.decimals0)
      .mul(95)
      .div(100)
      .toHexString()
    const args = {
      recipient,
      risky: pool.coin0,
      stable: pool.coin1,
      poolId: pool.poolId,
      riskyForStable: coin0In,
      deltaIn,
      deltaOut,
      fromMargin: false,
      toMargin: false,
      deadline: Time.now + 60 * 20,
    }
    const swap = Fetcher.i.encodeFunctionData('swap', [args])
    const calldata = Fetcher.i.encodeFunctionData('multicall', [[swap]])

    const tx = { to: Fetcher.c.address, data: calldata, value: toBN('0').toHexString() }
    return signer
      .estimateGas(tx)
      .then((gasLimit) => {
        const payload = { ...tx, gasLimit: gasLimit.mul(135).div(100).toHexString() }
        return signer
          .sendTransaction(payload)
          .then((resp: TransactionResponse) => {
            console.log(`     - Waiting for tx to be mined...`)
            resp
              .wait()
              .then((receipt) => {
                return receipt
              })
              .catch((e) => {
                console.log(`   - No receipt found`)
                console.error(e)
                return e
              })
          })
          .catch((e) => {
            console.log(`   - Error thrown in swap`)
            console.error(e)
            return e
          })
      })
      .catch((e) => {
        console.log(`   - Failed on gas estimate, attempting call`, e?.error?.code)
        console.log(`   - Args used:`, args)
        console.log(`   - Swap:`, swap)
        return signer
          .call(tx)
          .then((res) => {
            console.log(`   - Successful call after failed gas estimate`, res)
            return res
          })
          .catch((e) => {
            console.log(`   - Unsuccessful call after estimate gas fail`, e?.error?.code)
            return e
          })
      })
  }

  // get all engine(s) data
  public static async engines(): Promise<string[]> {
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

  public static async pool(coin0: Coin, coin1: Coin, id: Id): Promise<RMMPool> {
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
  public static async pools(coin0: Coin, coin1: Coin): Promise<RMMPool[]> {
    const a = computeEngineAddress(Fetcher.f.address, coin0, coin1) // await Fetcher.f.getEngine(coin0, coin1)
    const e = Fetcher.instance(a)

    const filter = e.filters.Create()
    const events = await e.queryFilter(filter)
    const ids = Fetcher.ids(events, e.address)

    let calls: string[] = []
    let invariants: string[] = []
    for (const id of ids) {
      calls.push(Fetcher.c.uri(id))
      invariants.push(e.invariantOf(id))
    }

    const ks = await Promise.all(invariants)
    console.log(ks.map(parseFloat).map((k) => k / Math.pow(2, 64)))

    return Promise.all(calls)
      .then((res) => {
        let pools: RMMPool[] = []
        for (let i = 0; i < calls.length; i++) {
          const raw = res[i]
          const uri: PoolInterface = parseTokenURI(raw) as PoolInterface
          const pool = Fetcher.from(uri)
          pools.push(pool)
          const k = ks?.[i]
          //if (k) pool.invariant = parseFloat(k) / Math.pow(2, 64)
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
      properties: { risky, stable, reserve, calibration, invariant, factory },
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
      parseFloat(invariant ?? '0') / Math.pow(2, 64),
      factory
    )
    pool.decimals0 = parseFloat(risky.decimals.toString())
    pool.decimals1 = parseFloat(stable.decimals.toString())
    if (risky.symbol) pool.symbol0 = risky.symbol
    if (stable.symbol) pool.symbol1 = stable.symbol
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
