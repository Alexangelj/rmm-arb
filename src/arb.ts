import { bisection, EPSILON } from '@primitivefi/rmm-math'
import { Coin, RMMPool } from './rmm'

export interface TradeResult {
  coin: Coin
  trade: number
}

export class Arbitrageur {
  public optimal: number

  constructor() {
    this.optimal = 1e-8
  }

  public arbitrage(p: number, pool: RMMPool): TradeResult {
    const [R1, R2, invariant, strike, sigma, tau] = [
      pool.res0 / pool.liq,
      pool.res1 / pool.liq,
      pool.invariant,
      pool.strike,
      pool.sigma,
      pool.tau,
    ]

    const { derivative: sell } = pool.derivativeOut(pool.coin0, 0)
    const { derivative: buy } = pool.derivativeOut(pool.coin1, 0)

    console.log(`   - Buy: ${buy}`)
    console.log(`   - Sell: ${sell}`)

    if (sell > p + this.optimal) {
      const fn = (d: number) => pool.derivativeOut(pool.coin0, d).derivative - p

      let trade: number
      if (Math.sign(fn(EPSILON)) != Math.sign(1 - R1 - EPSILON)) {
        trade = bisection(fn, EPSILON, 1 - R1 - EPSILON)
      } else {
        trade = 1 - R1
      }

      trade = trade * pool.liq

      console.log(`     - Trade: ${trade}`)

      const { output } = pool.amountOut(pool.coin0, trade)
      console.log(`     - Output: ${output}`)

      const profit = output - trade * p
      console.log(`     - Profit: ${profit}`)

      if (profit > 0) {
        console.log(`     - Running Arb`)
        return { trade, coin: pool.coin1 }
      }
    } else if (buy < p - this.optimal) {
      const fn = (d) => p - pool.derivativeOut(pool.coin1, d).derivative

      let trade: number
      if (Math.sign(fn(EPSILON)) != Math.sign(fn(strike - R2 - EPSILON))) {
        trade = bisection(fn, 0, strike - R2 - EPSILON)
      } else {
        trade = strike - R2
      }

      trade = trade * pool.liq

      console.log(`     - Trade: ${trade}`)

      const { output } = pool.amountOut(pool.coin1, trade)
      console.log(`     - Output: ${output}`)

      const profit = output * p - trade
      console.log(`     - Profit: ${profit}`)

      if (profit > 0) {
        console.log(`     - Running Arb`)
        return { trade, coin: pool.coin0 }
      }
    } else {
      console.log(`   - No arb`)
      return { trade: 0, coin: pool.coin0 }
    }
  }
}
