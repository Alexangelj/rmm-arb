import { Time } from 'web3-units'
import {
  quantilePrime,
  getInverseCDFSolidity,
  std_n_pdf,
  getStableGivenRiskyApproximation,
  getRiskyGivenStableApproximation,
  getInvariantApproximation,
} from '@primitivefi/rmm-math'
import { computeEngineAddress, computePoolId } from './utils'

import { AddressZero } from '@ethersproject/constants'
import { parseUnits } from 'ethers/lib/utils'

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
    factory?: string
  ) {
    this.coin0 = coin0
    this.coin1 = coin1
    this.res0 = res0
    this.res1 = res1
    this.liq = liq
    this.strike = strike
    this.sigma = sigma
    this.maturity = maturity
    this.gamma = gamma
    this.invariant = invariant
    this.factory = factory ?? AddressZero
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
    return Time.now
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

    const k = this.invariant
    const K = this.strike
    const gamma = this.gamma
    const sigma = this.sigma
    const tau = this.tau

    if (input === this.coin0) {
      const R = getStableGivenRiskyApproximation((this.res0 + d * gamma) / this.liq, K, sigma, tau, k)
      const output = this.res1 - R * this.liq
      const res0 = this.res0 + d
      const res1 = this.res1 - output
      if (R < 0) throw new Error(`Reserves cannot be negative: ${R}`)

      const invariant = getInvariantApproximation(res0 / this.liq, res1 / this.liq, K, sigma, tau, k)
      const priceIn = output / d

      return {
        coin: this.coin1,
        output: output,
        invariant: invariant,
        priceIn: priceIn,
      }
    } else if (input === this.coin1) {
      const R = getRiskyGivenStableApproximation((this.res1 + gamma * d) / this.liq, K, sigma, tau, k)
      if (R < 0) throw new Error(`Reserves cannot be negative: ${R}`)
      const output = this.res0 - R * this.liq
      if (output < 0) throw new Error(`Amount out cannot be negative: ${output}`)

      const res0 = this.res0 - output
      const res1 = this.res1 + d
      const invariant = getInvariantApproximation(res0, res1, K, sigma, tau, k)

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

    const k = this.invariant
    const K = this.strike
    const gamma = this.gamma
    const sigma = this.sigma
    const tau = this.tau

    if (input === this.coin0) {
      const R = (this.res0 - gamma * d) / this.liq
      const callDelta = 1 - R
      return {
        coin: this.coin1,
        derivative:
          K * gamma * std_n_pdf(getInverseCDFSolidity(callDelta) - sigma * Math.sqrt(tau)) * quantilePrime(callDelta),
      }
    } else if (input === this.coin1) {
      const R = (this.res1 + gamma * d) / this.liq
      const input = (R - k) / K
      return {
        coin: this.coin1,
        derivative:
          (1 / gamma) * std_n_pdf(getInverseCDFSolidity(input) + sigma * Math.sqrt(tau)) * quantilePrime((input * 1) / K),
      }
    } else {
      throw new Error(`Not a valid coin: ${input}`)
    }
  }
}
