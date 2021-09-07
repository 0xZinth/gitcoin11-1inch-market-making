const axios = require('axios')
const { Dhedge, Dapp, Network, Transaction, Pool, ethers } = require("@dhedge/v2-sdk")
const { denomToUnit, unitToDenom, TokensDB, findTkn } = require('./poly-utils.js')
const IUniswapV2Router = require('./abi/IUniswapV2Router.json')
const routerAddress = { [Network.POLYGON]: {  [Dapp.SUSHISWAP]: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506"  } }

require('dotenv').config()

const sushiPrice = require('./sushiPrice.js')

//#region constants

const privateKey = process.env.PRIVATE_KEY
const providerUrl = process.env.RPC

const TRADE_SIZE = process.env.TRADE_SIZE

const USDC = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
const USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'

const MyPoolStables = process.env.STABLES_POOL

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
    const p = await dhedge.loadPool(MyPoolStables)
    const pool = new myPool(dhedge.network, dhedge.signer, p.poolLogic, p.managerLogic, dhedge.utils)
    return {dhedge, pool}
}

//#region  One time seup functions
async function createPool() {
    const dhedge = await  getEnv()
    const pool = await dhedge.createPool(
    "Zinth",
    "Zinth Fund A",
    "ZINA",
    [[USDC, true], [DAI, true], [USDT, true] ],
    10
    )
    console.log("created pool with address", pool.address)
}

async function oneTimePoolSetup(env) {
   
    const appr1Tx = await env.pool.approveDeposit(USDC, ethers.constants.MaxUint256)
    const appr2Tx = await env.pool.approveDeposit(DAI, ethers.constants.MaxUint256)
    const appr3Tx = await env.pool.approveDeposit(USDT, ethers.constants.MaxUint256)
    console.log(`sent deposit approve requests: ${appr1Tx.hash}, ${appr2Tx.hash}, ${appr3Tx.hash}`)

    const apprTx1 = await env.pool.approve( Dapp.SUSHISWAP, USDC, ethers.constants.MaxInt256)
    const apprTx2 = await env.pool.approve( Dapp.SUSHISWAP, DAI, ethers.constants.MaxInt256)
    const apprTx3 = await env.pool.approve( Dapp.SUSHISWAP, USDT, ethers.constants.MaxInt256) 
    console.log(`sent trading approve requests: ${apprTx1.hash}, ${apprTx2.hash}, ${apprTx3.hash}`)

   
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

async function stablesStep(env){
    const tradeSize = TRADE_SIZE
    const fastGas = await getFastGas()
    const tokens = [findTkn('USDC'), findTkn('DAI'), findTkn('USDT')]

    const tokensBal = await getCurrentPosn (env, tokens)
    const totalBal = tokensBal.reduce((acc, curr) => acc + parseFloat(curr.bal),0)
    const balLimit= totalBal /2


    const quotes = await sushiPrice.getSushiPrices(tokensBal,tradeSize)

    // remove quotes where from balance is below trade size and where to balance is greater then half of pool
    const balQuotes = quotes.filter(item=> (item.pair.from.bal > tradeSize && item.pair.to.bal < balLimit) )

    const maxQuote = balQuotes.reduce((prev, curr)=> prev.priceRes.price > curr.priceRes.price ? prev : curr)
    if (maxQuote.priceRes.price > 1) {// trade it
        console.log(`trading from ${maxQuote.pair.from.symbol} to ${maxQuote.pair.to.symbol}`)
        const fromAmt = unitToDenom(tradeSize, maxQuote.pair.from)
        const toAmt = unitToDenom(tradeSize, maxQuote.pair.to)
        await env.pool.trade(Dapp.SUSHISWAP, maxQuote.pair.from.address, maxQuote.pair.to.address, fromAmt, toAmt, fastGas)
    }
}

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
    let param = initParam
    for (let i = 0; i < num; i++) {
        let delay = msDelay
        try {param = await f(param)}
        catch (err) {console.log(`ERROR Found: ${err}`); delay = delay * 2}
        console.log(`done loop ${i}`)
        await sleep(delay)
    }
    return param
}


//#endregion

runMany(process.env.NUM_OF_LOOPS, process.env.LOOP_TIME_MS,stablesStep)
