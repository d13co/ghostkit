import { AlgorandClient } from "@algorandfoundation/algokit-utils"
import { GhostofavmSDK } from "./GhostofavmSDK"

const accounts = process.argv.slice(2)

const algorand = AlgorandClient.mainNet()
const ghostSDK = new GhostofavmSDK({ algorand })

ghostSDK.acctBalanceData({ methodArgsOrArgsArray: { accounts }}).then(data => console.log(data))