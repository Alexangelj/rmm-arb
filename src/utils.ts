import EngineArtifact from '@primitivefi/rmm-core/artifacts/contracts/PrimitiveEngine.sol/PrimitiveEngine.json'
import { BigNumber, utils } from 'ethers'
const { keccak256, solidityPack } = utils
export const EPSILON = 1e-3

/**
 * @notice source: https://www.geeksforgeeks.org/program-for-bisection-method/
 * This code is contributed by susmitakundugoaldanga.
 * @param func Returns a value, run the bisection such that the return value is 0
 * @param a Left most point
 * @param b Right most point
 * @returns Root of function
 */
export const bisection = (func, a, b) => {
  if (func(a) * func(b) >= 0) {
    console.log('\n You have not assumed' + ' right a and b')
    return
  }

  let c = a
  while (b - a >= EPSILON) {
    // Find middle point
    c = (a + b) / 2

    // Check if middle point is root
    if (func(c) == 0.0) break
    // Decide the side to repeat the steps
    else if (func(c) * func(a) < 0) b = c
    else a = c
  }
  return c
}

export function computePoolId(
  engine: string,
  strike: string | BigNumber,
  sigma: string | BigNumber,
  maturity: string | BigNumber,
  gamma: string | BigNumber
): string {
  return keccak256(
    solidityPack(['address', 'uint128', 'uint32', 'uint32', 'uint32'], [engine, strike, sigma, maturity, gamma])
  )
}

export function computeEngineAddress(
  factory: string,
  risky: string,
  stable: string,
  contractBytecode: string = EngineArtifact.bytecode
): string {
  const salt = utils.solidityKeccak256(['bytes'], [utils.defaultAbiCoder.encode(['address', 'address'], [risky, stable])])
  return utils.getCreate2Address(factory, salt, utils.keccak256(contractBytecode))
}

export function parseTokenURI(uri: string) {
  const json = Buffer.from(uri.substring(29), 'base64').toString() //(uri.substring(29));
  const result = JSON.parse(json)
  return result
}
