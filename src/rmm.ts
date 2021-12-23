import { Time } from 'web3-units'
import {
  quantilePrime,
  getInverseCDFSolidity,
  std_n_pdf,
  getStableGivenRiskyApproximation,
  getRiskyGivenStableApproximation,
  getInvariantApproximation,
  getMarginalPriceSwapRiskyIn,
  getMarginalPriceSwapRiskyInApproximation,
  getMarginalPriceSwapStableInApproximation,
  callDelta,
  getRiskyGivenStable,
  getMarginalPriceSwapStableIn,
} from '@primitivefi/rmm-math'
import { computeEngineAddress, computePoolId, Log, log, normalize } from './utils'

import { AddressZero } from '@ethersproject/constants'
import { getAddress, parseUnits } from 'ethers/lib/utils'

export type Coin = string

interface OutputResult {
  coin: Coin
  output: number
  invariant: number
  priceIn: number
}

interface DerivativeResult {
  coin: Coin
  derivative: number
}

export interface RMM {
  amountOut(input: Coin, d: number): OutputResult
  derivativeOut(input: Coin, d: number): DerivativeResult
}

export class RMMPool implements RMM {
  coin0: Coin
  coin1: Coin
  res0: number
  res1: number
  liq: number
  strike: number
  sigma: number
  maturity: number
  gamma: number
  invariant: number
  lastTimestamp: number

  factory: string
  decimals0: number = 18
  decimals1: number = 18
  symbol0: string = 'Risky'
  symbol1: string = 'Stable'

  constructor(
    coin0: string,
    coin1: string,
    res0: number,
    res1: number,
    liq: number,
    strike: number,
    sigma: number,
    maturity: number,
    gamma: number,
    invariant: number,
    factory?: string,
    lastTimestamp: number = Time.now
  ) {
    this.coin0 = getAddress(coin0)
    this.coin1 = getAddress(coin1)
    this.res0 = res0
    this.res1 = res1
    this.liq = liq
    this.strike = strike
    this.sigma = sigma
    this.maturity = maturity
    this.gamma = gamma
    this.invariant = invariant
    this.factory = getAddress(factory ?? AddressZero)
    this.lastTimestamp = lastTimestamp
  }

  get poolId(): string {
    return computePoolId(
      computeEngineAddress(this.factory, this.coin0, this.coin1),
      parseUnits(this.strike.toString(), this.decimals1).toHexString(),
      parseUnits(this.sigma.toString(), 4),
      this.maturity.toString(),
      parseUnits(this.gamma.toString(), 4)
    )
  }

  get fee(): number {
    return 1 - this.gamma
  }

  get now(): number {
    const buffer = 420 // 120s, 8 block buffer
    return Time.now + buffer
  }

  get k(): number {
    const risky = 1 - callDelta(this.strike, this.sigma, this.tau, 31_503)
    const invariant = this.res1 / this.liq - getStableGivenRiskyApproximation(risky, this.strike, this.sigma, this.tau, 0)
    return invariant
  }

  get tau(): number {
    return new Time(this.maturity - this.now).years
  }

  get reportedPrice(): number {
    const R = this.res0 / this.liq
    return getStableGivenRiskyApproximation(R, this.strike, this.sigma, this.tau) * quantilePrime(1 - R)
  }

  public amountOut(input: Coin, d: number): OutputResult {
    if (d < 0) throw new Error(`Amount in cannot be negative: ${d}`)

    const K = this.strike
    const gamma = this.gamma
    const sigma = this.sigma
    const tau = this.tau
    const k = getInvariantApproximation(
      normalize(this.res0 / this.liq, this.decimals0),
      normalize(this.res1 / this.liq, this.decimals1),
      K,
      sigma,
      tau,
      0
    ) //this.invariant

    // risky in
    if (input === this.coin0) {
      const R = getStableGivenRiskyApproximation((this.res0 + d * gamma) / this.liq, K, sigma, tau, k)
      const output = this.res1 - R * this.liq // liquidity normalized
      const res0 = this.res0 + d
      const res1 = this.res1 - output
      if (R < 0) throw new Error(`Reserves cannot be negative: ${R}`)

      const invariant = getInvariantApproximation(res0 / this.liq, res1 / this.liq, K, sigma, tau, 0)
      if (invariant < k) log(Log.CALC, `Invariant decreased from: ${k} to ${invariant}`)
      const priceIn = output / d

      return {
        coin: this.coin1,
        output: output,
        invariant: invariant,
        priceIn: priceIn,
      }
    } else if (input === this.coin1) {
      // stable in

      const liqNorm = this.liq //normalize(this.liq, 18 - this.decimals1)
      //console.log(`   - Got norm liq: ${[this.liq - liqNorm]}`)

      const rounding0 = 10 ** -this.decimals1 // lowest amount of coin0
      const rounding1 = 10 ** -this.decimals1 // lowest amount of coin1

      const res1AdjFee = this.res1 + d * gamma - rounding1 //this.res1 + normalize(d * gamma, this.decimals1) - rounding1 // charge fee on the way in

      // !IMPORTANT!: adjusted reserves has the decimal places of coin1, therefore it must be truncated
      // even more importantly, the liquidity must be normalized to have 18 - coin1 decimals
      // If liquidity is 18 decimals, and a coin is 6 decimals, anything less than 1e-12 of a liquidity token
      // only has claim to a fraction of the coin (i.e. less than 6 decimals), which is 0 in smart contracts
      const res1AdjFeeNorm = normalize(res1AdjFee / liqNorm, this.decimals1)

      log(Log.CALC, `Got Input Adj norm: ${[res1AdjFee / liqNorm - res1AdjFeeNorm]}`)

      // note: for some reason, the regular non approximated fn outputs less
      const res0 = getRiskyGivenStable(res1AdjFeeNorm, K, sigma, tau, k)
      if (res0 < 0) throw new Error(`Reserves cannot be negative: ${res0}`)

      const res0LiqNorm = normalize(res0 * liqNorm, this.decimals0)
      log(Log.CALC, `Got Output Adj norm: ${[res0 * liqNorm - res0LiqNorm]}`)

      // ===== debug
      const RApprox = getRiskyGivenStableApproximation(res1AdjFeeNorm, K, sigma, tau, k)
      //console.log(this.res0, res0 * this.liq, { res0LiqNorm, res0, RApprox, d })
      // ===== end debug

      const output = normalize(this.res0 - res0LiqNorm, this.decimals0)
      log(Log.CALC, `Got output norm: ${[this.res0 - res0LiqNorm - output]}`)
      if (output < 0) throw new Error(`Amount out cannot be negative: ${output}`)

      const res0AdjNorm = normalize(this.res0 - output, this.decimals0) / liqNorm
      const res1AdjNorm = normalize(this.res1 + d, this.decimals1) / liqNorm
      const res0Norm = normalize(res0AdjNorm, this.decimals0)
      const res1Norm = normalize(res1AdjNorm, this.decimals1)
      log(Log.CALC, `Got normalized amounts: ${[res0AdjNorm - res0Norm, res1AdjNorm - res1Norm]}`)

      const invariant = getInvariantApproximation(res0Norm, res1Norm, K, sigma, tau, 0)
      if (invariant < k) log(Log.CALC, `Invariant decreased by: ${k - invariant}`)

      let priceIn: number
      if (d === 0) priceIn = Infinity
      else priceIn = d / output

      return {
        coin: this.coin0,
        output,
        invariant,
        priceIn,
      }
    } else {
      throw new Error(`Not a valid coin: ${input}`)
    }
  }

  public derivativeOut(input: Coin, d: number): DerivativeResult {
    if (d < 0) throw new Error(`Amount in cannot be negative: ${d}`)

    const K = this.strike
    const gamma = this.gamma
    const sigma = this.sigma
    const tau = this.tau
    const k = getInvariantApproximation(
      normalize(this.res0 / this.liq, this.decimals0),
      normalize(this.res1 / this.liq, this.decimals1),
      K,
      sigma,
      tau,
      0
    )

    if (input === this.coin0) {
      const R = (this.res0 - d * gamma) / this.liq
      const callDelta = 1 - R
      return {
        coin: this.coin1,
        derivative: getMarginalPriceSwapRiskyIn(d / this.liq, this.res0 / this.liq, K, sigma, tau, 1 - gamma), //getMarginalPriceSwapRiskyInApproximation(d / this.liq, this.res0 / this.liq, K, sigma, tau, 1 - gamma),
      }
      /* return {
        coin: this.coin1,
        derivative:
          K * gamma * std_n_pdf(getInverseCDFSolidity(callDelta) - sigma * Math.sqrt(tau)) * quantilePrime(callDelta),
      } */
    } else if (input === this.coin1) {
      const AiFee = normalize(d * gamma, this.decimals1)
      const R = normalize((this.res1 + AiFee) / this.liq, this.decimals1)
      const input = (R - k) / K
      /* return {
        coin: this.coin1,
        derivative: getMarginalPriceSwapStableIn(d / this.liq, k, this.res1 / this.liq, K, sigma, tau, 1 - gamma),
      } */
      /* return {
        coin: this.coin1,
        derivative: getMarginalPriceSwapStableInApproximation(
          d / this.liq,
          k,
          this.res1 / this.liq,
          K,
          sigma,
          tau,
          1 - gamma
        ),
      } */
      return {
        coin: this.coin1,
        derivative:
          1 /
          (gamma * std_n_pdf(getInverseCDFSolidity(input) + sigma * Math.sqrt(tau)) * quantilePrime((R - k) / K) * (1 / K)),
      }
    } else {
      throw new Error(`Not a valid coin: ${input}`)
    }
  }
}
