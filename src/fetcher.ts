import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Contract } from 'ethers'
import { ethers } from 'hardhat'

import { Relayer } from 'defender-relay-client'
import { DefenderRelaySigner } from 'defender-relay-client/lib/ethers'

import { MANAGER } from './addresses'
import { Coin } from './rmm'

export type Id = string
export type Sender = SignerWithAddress | Relayer

class Fetcher {
  public static c: Contract = new Contract(MANAGER, ['function uri(uint256 tokenId) public view returns(string)'])

  public fetch(coin0: Coin, coin1: Coin, id: Id) {}
}
