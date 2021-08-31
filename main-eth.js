const axios = require('axios')
const { Dhedge, Dapp, Network, Transaction, Pool, ethers } = require("@dhedge/v2-sdk")
const AddressDB = require("./addresses.js").AddressDB
const { denomToUnit, unitToDenom, TokensDB, findTkn } = require('./poly-utils.js')
const IUniswapV2Router = require('./abi/IUniswapV2Router.json')
const routerAddress = { [Network.POLYGON]: {  [Dapp.SUSHISWAP]: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506"  } }

require('dotenv').config()

const sushiPrice = require('./sushiPrice.js')

//#region constants

const privateKey = process.env.PRIVATE_KEY;
const ownerAddr = process.env.ADDR
const providerUrl = process.env.INFURA_RPC

const ETH_TRADE_SIZE=process.env.ETH_TRADE_SIZE
const ETH_TRIGGER_BP=process.env.ETH_TRIGGER_BP
const ETH_POLL_TIME=process.env.ETH_POLL_TIME

const USDC = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
const ETH = '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619'

const MyPoolEth = process.env.ETH_POOL


//#endregion

//#region dhedge related

class myPool extends Pool {

    constructor(network, signer, poolLiogic, managerLogic, utils){super(network, signer, poolLiogic, managerLogic, utils)}

    async trade( dapp, assetFrom, assetTo, amountIn, minAmountOut, gasPrice) {
        const iUniswapV2Router = new ethers.utils.Interface(IUniswapV2Router.abi)
        const swapTxData = iUniswapV2Router.encodeFunctionData(
            Transaction.SWAP, [amountIn, minAmountOut, [assetFrom, assetTo], this.address, Math.floor(Date.now() / 1000) + 60 * 20  ])
        return await this.poolLogic.execTransaction( routerAddress[this.network][dapp], swapTxData, {gasPrice, gasLimit:process.env.GAS_LIMIT} )
    }
}

//#endregion

//#region utility functions

async function getFastGas() {
    let httpData = await axios.get('https://gasstation-mainnet.matic.network/')
    let gasData = httpData.data
    let fastMax = Math.min(process.env.MAX_GAS, gasData.fast)
    return ethers.utils.parseUnits(fastMax.toString(), 'gwei')
}


function decimalize(amount, decimals) {
    return JSBI.multiply(JSBI.BigInt(amount), JSBI.exponentiate(JSBI.BigInt(10), JSBI.BigInt(decimals)))
}

//#endregion

//#region env functions

async function getEnv() {
    const provider = new ethers.providers.JsonRpcProvider(providerUrl)
    const walletWithProvider = new ethers.Wallet(privateKey, provider)
    const dhedge = new Dhedge(walletWithProvider, Network.POLYGON)
    const p = await dhedge.loadPool(MyPoolEth)
    const pool = new myPool(dhedge.network, dhedge.signer, p.poolLogic, p.managerLogic, dhedge.utils)
    return {dhedge, pool}
}

//#endregion

//#region  One time seup functions
async function createPool() {
    const dhedge = await  getEnv()
    const pool = await dhedge.createPool(
    "Zinth",
    "Zinth Fund A",
    "ZINA",
    [[USDC, true], [ETH, true]],
    10
    )
    console.log("created pool with address", pool.address)
}
//0x32FaB5a22b5545b9DfF82F6Db6c87434960955D3

async function oneTimePoolSetupETH(env) {

    const appr1Tx = await env.pool.approveDeposit(USDC, ethers.constants.MaxUint256)
    const appr2Tx = await env.pool.approveDeposit(ETH, ethers.constants.MaxUint256)
    console.log(`sent deposit approve requests: ${appr1Tx.hash}, ${appr2Tx.hash}`)

    const pApprTx1 = await env.pool.approve( Dapp.SUSHISWAP, USDC, ethers.constants.MaxInt256)
    const pApprTx2 = await env.pool.approve( Dapp.SUSHISWAP, ETH, ethers.constants.MaxInt256)
    console.log(`sent trading approve requests: ${pApprTx1.hash}, ${pApprTx2.hash}`)
}


//#endregion

//#region core logic

async function getCurrentPosn(env, tokens) {

    const comp =  await env.pool.getComposition()

    return tokens.map(item => {
        let tknBal = comp.filter(compItem => (item.address.toLowerCase() === compItem.asset.toLowerCase()))
        return {...item, bal:denomToUnit(tknBal[0].balance.toString(), item)}
    })

}

async function ethStep(env, lastPrice){
    const fastGas = await getFastGas()

    const tUSDC = findTkn('USDC')
    const tETH = findTkn('ETH')

    const tokens = [tETH, tUSDC]
    const tokensBal = await getCurrentPosn (env, tokens)
    const USDCBal = tokensBal.filter(item => item.symbol === 'USDC')[0]
    const ETHBal = tokensBal.filter(item => item.symbol === 'ETH')[0]

    const ePrice = await sushiPrice.get0xPriceSushi(findTkn('USDC'),findTkn('ETH'), 10000)
    const ethPrice = 1/ePrice.price

    if (lastPrice !== 0) {
        const diffBP = ((ethPrice-lastPrice)/ethPrice)*10000

        const usdcTradeSize = ETH_TRADE_SIZE * ethPrice
        if (diffBP > ETH_TRIGGER_BP && USDCBal.bal > usdcTradeSize) {// price went up so we buy!
            console.log(`buying eth`)
            const tx = await env.pool.trade(Dapp.SUSHISWAP, tUSDC.address, tETH.address, unitToDenom(usdcTradeSize, tUSDC), 0, fastGas)
            console.log(`sent tx: ${tx.hash}`)
        }
        if  (diffBP < ETH_TRIGGER_BP*-1 && ETHBal.bal > ETH_TRADE_SIZE) {
            console.log(`selling eth`)
            const tx = await env.pool.trade(Dapp.SUSHISWAP, tETH.address, tUSDC.address, unitToDenom(ETH_TRADE_SIZE, tETH), 0, fastGas)
            console.log(`sent tx: ${tx.hash}`)
        }
    }
    return ethPrice
}


// env = await getEnv()
// tUSDC = findTkn('USDC'); tDAI = findTkn('DAI')
// fAmt = unitToDenom(10, tUSDC); tAmt = unitToDenom(9, tDAI)
//testT =  await env.pool.trade(Dapp.SUSHISWAP, tUSDC.address, tDAI.address,fAmt,tAmt)


function sleep(ms) {return new Promise(resolve => setTimeout(resolve, ms))}

async function runMany(num, msDelay, f) {
    let env = await getEnv()
    for (let i = 0; i < num; i++) {
        let delay = msDelay
        try {await f(env)}
        catch (err) {console.log(`ERROR Found: ${err}`); delay = delay * 2}
        console.log(`done loop ${i}`)
        await sleep(delay)
    }
}


async function runManyParam(num, msDelay, f, initParam) {
    let env = await getEnv()
    let param = initParam
    for (let i = 0; i < num; i++) {
        let delay = msDelay
        try {param = await f(env,param)}
        catch (err) {console.log(`ERROR Found: ${err}`); delay = delay * 2}
        console.log(`done loop ${i}`)
        await sleep(delay)
    }
    return param
}


//#endregion


// comments on the api
// 1.Performance fee did not get relfected when I created the contract
// 2. need a way to pass through gasPrice and gasLimit