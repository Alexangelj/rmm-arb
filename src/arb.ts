import { bisection, EPSILON, getInvariantApproximation } from '@primitivefi/rmm-math'
import { Coin, RMMPool } from './rmm'
import { log, Log, normalize } from './utils'

export interface TradeResult {
  coin: Coin
  Ai: number
  Ao: number
}

const empty = (coin) => {
  return { coin, Ai: 0, Ao: 0 }
}

export class Arbitrageur {
  public optimal: number

  constructor() {
    this.optimal = 1e-4
  }

  public arbitrage(p: number, pool: RMMPool): TradeResult {
    const [R1, R2, invariant, strike, sigma, tau, gamma] = [
      pool.res0 / pool.liq,
      pool.res1 / pool.liq,
      pool.invariant,
      pool.strike,
      pool.sigma,
      pool.tau,
      pool.gamma,
    ]

    const k = getInvariantApproximation(R1, R2, strike, sigma, tau, 0)

    console.log(`   - Params: ${[strike.toFixed(2), sigma.toFixed(2), tau.toFixed(2), gamma.toFixed(2), k.toFixed(2)]}`)
    console.log(`   - Reserves: ${[pool.res0.toFixed(2), pool.res1.toFixed(2)]}`)
    console.log(`   - Liq: ${pool.liq}`)

    const diff = pool.reportedPrice - p
    console.log(`   - Prices: ${[pool.reportedPrice.toFixed(2), p.toFixed(2), diff.toFixed(2)]}`)
    console.log(`   - Arb Direction: ${diff > 0 ? `Sell ${pool.symbol0}` : `Buy ${pool.symbol0}`}`)

    const { derivative: buy } = pool.derivativeOut(pool.coin1, 0)
    const { derivative: sell } = pool.derivativeOut(pool.coin0, 0)

    console.log(`   - Sell' Price: ${sell.toFixed(2)} ${pool.symbol1}`)
    console.log(`   - Buy' Price: ${buy.toFixed(2)} ${pool.symbol1}`)

    if (R1 < EPSILON) {
      console.log(` - ${pool.symbol0} reserves almost empty`)
      return empty(pool.coin0)
    } else if (R2 < EPSILON || (strike + k - R2) / gamma < EPSILON) {
      console.log(` - ${pool.symbol1} reserves almost empty`)
      return empty(pool.coin0)
    } else if (1 - R1 < EPSILON) {
      console.log(` - ${pool.symbol0} reserves almost full`)
      return empty(pool.coin0)
    } else if (strike - R2 < EPSILON) {
      console.log(` - ${pool.symbol1} reserves almost full`)
      return empty(pool.coin0)
    }

    if (sell > p + this.optimal) {
      console.log(`   - Selling ${pool.symbol0} for ${pool.symbol1}`)
      const fn = (d: number) => pool.derivativeOut(pool.coin0, d).derivative - p

      let trade: number
      if (Math.sign(fn(EPSILON)) !== Math.sign(1 - R1 - EPSILON)) {
        trade = bisection(fn, EPSILON, 1 - R1 - EPSILON)
      } else {
        trade = 1 - R1
      }

      console.log(`     - Selling: ${trade.toFixed(2)} per LP`)

      trade = trade //* pool.liq
      console.log(`     - Swap in: ${trade.toFixed(2)} ${pool.symbol0}`)

      const { output } = pool.amountOut(pool.coin0, trade)
      console.log(`     - Output: ${output} ${pool.symbol1}`)

      const profit = output - trade * p
      console.log(`     - Profit: $ ${profit}`)

      if (profit > 0) {
        console.log(`     - Running Arb`)
        return { Ai: trade, Ao: output, coin: pool.coin1 }
      }
    } else if (buy < p - this.optimal) {
      log(Log.ACTION, `Buying ${pool.symbol0} for ${pool.symbol1}`)
      const fn = (d) => p - pool.derivativeOut(pool.coin1, d).derivative

      let trade: number
      if (Math.sign(fn(EPSILON)) !== Math.sign(fn((strike - R2 + k) / gamma - EPSILON))) {
        trade = bisection(fn, 0, (strike - R2 + k) / gamma - EPSILON)
        log(Log.CALC, `Found trade size with bisection: ${trade}`)
      } else {
        trade = strike - R2
        log(Log.CALC, `Trade remainder of pool: ${trade}`)
      }
      log(Log.CALC, `Paying: ${trade.toFixed(2)} ${pool.symbol1} per LP`)

      trade = normalize(trade, pool.decimals1) //* pool.liq
      log(Log.CALC, `Swap in: ${trade.toFixed(2)} ${pool.symbol1}`)

      const { output } = pool.amountOut(pool.coin1, trade)
      log(Log.CALC, `Output: ${output} ${pool.symbol0}`)

      const profit = output * p - trade
      log(Log.CALC, `Profit: $ ${profit}`)

      if (profit > 0) {
        log(Log.ACTION, `Running Arb`)
        return { Ai: trade, Ao: output, coin: pool.coin0 }
      }
    }

    log(Log.CALC, `No arb`)
    return empty(pool.coin0)
  }
}
