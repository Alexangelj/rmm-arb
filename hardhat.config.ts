import * as dotenv from 'dotenv'

import { HardhatUserConfig, task } from 'hardhat/config'
import '@nomiclabs/hardhat-waffle'

import { DefenderRelayProvider } from 'defender-relay-client/lib/ethers'
import { cred } from './src/fetcher'

dotenv.config()

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners()

  for (const account of accounts) {
    console.log(account.address)
  }
})

const provider = new DefenderRelayProvider(cred)

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: '0.8.4',
  networks: {
    rinkeby: {
      url: process.env.RINKEBY_URL || provider.connection.url,
      chainId: 4,
    },
    ropsten: {
      url: process.env.ROPSTEN_URL || '',
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
  },
}

export default config
