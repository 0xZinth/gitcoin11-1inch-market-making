const axios = require('axios')
const ethers = require('ethers')
const Web3 = require('web3')
const{ LimitOrderBuilder, LimitOrderProtocolFacade,  LimitOrderPredicateBuilder, PrivateKeyProviderConnector} = require('@1inch/limit-order-protocol')
const IERC20ABI = require('@openzeppelin/contracts/build/contracts/IERC20.json')
const LOPABI = require('@1inch/limit-order-protocol/abi/LimitOrderProtocol.json')
const parseUnits = ethers.utils.parseUnits
const formatUnits =ethers.utils.formatUnits
const BN = ethers.BigNumber
require('dotenv').config()

const USDC = { "symbol": "USDC", "name": "USD Coin", "decimals": 6,
    "address": "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    "logoURI": "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png"}
const DAI = {"symbol": "DAI", "name": "Dai Stablecoin", "decimals": 18,
     "address": "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063",
     "logoURI": "https://tokens.1inch.io/0x6b175474e89094c44da98b954eedeac495271d0f.png"}
const USDT = {"symbol": "USDT", "name": "Tether USD", "decimals": 6,
        "address": "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
        "logoURI": "https://tokens.1inch.io/0xdac17f958d2ee523a2206206994597c13d831ec7.png"}

const symLookup = {'0x2791bca1f2de4661ed88a30c99a7a9449aa84174':USDC, '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063':DAI, '0xc2132d05d31c914a87c6611c10748aeb04b58e8f':USDT}

const address = process.env.ADDR
const privateKey = process.env.PRIVATE_KEY
const providerUrl = process.env.RPC
const LOOP_TIME_MS = process.env.LOOP_TIME_MS
const NUM_OF_LOOPS = process.env.NUM_OF_LOOPS
const TRADE_SIZE = process.env.TRADE_SIZE
const SPREADBP = process.env.SPREADBP// 1BP
const DEFTIMEOUT = 600 //600 seconds is 10 minutes
const contractAddress = '0xb707d89d29c189421163515c59e42147371d6857' //one Inch contract addr
const chainId = 137

const curFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const providerConnector = new PrivateKeyProviderConnector(privateKey,new Web3(providerUrl))
const limitOrderBuilder = new LimitOrderBuilder(contractAddress, chainId, providerConnector)
const limitOrderProtocolFacade = new LimitOrderProtocolFacade(contractAddress, providerConnector)

const limitOrderPredicateBuilder = new LimitOrderPredicateBuilder(limitOrderProtocolFacade)
const { or, and, timestampBelow, nonceEquals, gt, lt, eq } = limitOrderPredicateBuilder

async function createLimitOrder(fromT, toT, fromAmt, toAmt, livetime) { //live time in seconds

    let simplePredicate = timestampBelow(Math.round(Date.now() / 1000) + livetime)

    let order = limitOrderBuilder.buildLimitOrder({
        makerAssetAddress:fromT.address,
        takerAssetAddress: toT.address,
        makerAddress: address,
        makerAmount: ethers.utils.parseUnits(fromAmt, fromT.decimals).toString(),
        takerAmount: ethers.utils.parseUnits(toAmt, toT.decimals).toString(),
        predicate: simplePredicate,
        //permit: '0x',
        //interaction: '0x',
    })
    
    let limitOrderTypedData = limitOrderBuilder.buildLimitOrderTypedData(order)
    let limitOrderSignature = await providerConnector.signTypedData(address, limitOrderTypedData)
    let limitOrderHash = limitOrderBuilder.buildLimitOrderHash( limitOrderTypedData)
    
    postData = {
        orderHash: limitOrderHash,
        orderMaker: address,
        createDateTime: new Date(),
        signature: limitOrderSignature,
        makerAmount: ethers.utils.parseUnits(fromAmt, fromT.decimals).toString(),
        takerAmount: ethers.utils.parseUnits(toAmt, toT.decimals).toString(),
        data: limitOrderTypedData.message  
    }

    res = await axios.post('https://limit-orders.1inch.exchange/v1.0/137/limit-order/', postData)
    
    return res.data
}

async function getOpenLimitOrders() {
    return (await axios.get(`https://limit-orders.1inch.exchange/v1.0/137/limit-order/address/${address}?page=1&limit=100&statuses=%5B1%2C2%5D`)).data
}

async function getEnv(privateKey) {
    let eProvider = new ethers.providers.JsonRpcProvider(providerUrl)
    let acctWallet = new ethers.Wallet(privateKey)
    let eSigner = acctWallet.connect(eProvider)
    return {eProvider, eSigner}
}

async function getC(addr, abi, env) {
    return new ethers.Contract(addr, abi, env.eSigner)
}

async function approveT(token, target, env) {
    let tokenC = await getC(token.address,IERC20ABI.abi, env)
    return await tokenC.approve(target,ethers.constants.MaxUint256,{gasPrice:'5000000000', gasLimit:'1000000'} )

}

async function getBal(token, env) {
    const tokenC = await getC(token.address,IERC20ABI.abi, env)
    const bal= await tokenC.balanceOf(env.eSigner.getAddress())
    return parseFloat(ethers.utils.formatUnits(bal, token.decimals).toString())
}

async function getFastGas() {
    let httpData = await axios.get('https://gasstation-mainnet.matic.network/')
    let gasData = httpData.data
    let fastMax = Math.min(process.env.MAX_GAS, gasData.fast)
    return ethers.utils.parseUnits(fastMax.toString(), 'gwei')
}

async function getBalsAndDesc(tkns, env) {
    const wBal =  await Promise.all(tkns.map(async tkn => {return {tkn, bal:await getBal(tkn, env)}}))
    const totalBal = wBal.reduce((prev, cur) => prev = prev+cur.bal, 0)
    const descs = wBal.map(tkn => `Token:${tkn.tkn.symbol} Balance:${curFormat.format(tkn.bal)}`)
    return {totalBal, desc:`TotalBal:${curFormat.format(totalBal)}, ${descs.join(', ')}`}
}

async function manageOpenOrders(orderList, fromT, toT, size) {
// we have a few numbers to handle open orders
// order size: is the size of the order when placed
// min order size: if remaining order is below 10% of order size then ignore for calculations
// order cut off: if the total of open order remaining is less than 50 % of order size then place new order
// function should be called once for each pair
    remain =  orderList.filter(ord => ord.data.makerAsset === fromT.address && ord.data.takerAsset === toT.address)
                                .reduce((prev, current) => {const curRemaining = parseFloat(formatUnits(current.remainingMakerAmount, fromT.decimals) )
                                    return curRemaining > (size/10) ? prev + curRemaining : prev}, 0 )

    return remain < size /2 ? {remain, placed:true, ret:(await createLimitOrder(fromT, toT, size, (size * (1+ SPREADBP/10000) ).toString() , DEFTIMEOUT))} : {remain, placed:false}

}

async function placeRebalOrder(orderList, fromT, toT, size) {
    return await createLimitOrder(fromT, toT, size, (size.toString() * (1 - SPREADBP/10000/5) ).toString() , DEFTIMEOUT)
}

function getOpenOrdersSummary(orderList) {
    const ordDescs = orderList.map(ord => {
        const fromT = symLookup[ord.data.makerAsset]
        const toT = symLookup[ord.data.takerAsset]
        return `From: ${fromT.symbol} To: ${toT.symbol} remaining: ${formatUnits(ord.remainingMakerAmount,fromT.decimals)} at create time:${ord.createDateTime}`
    })
    return ordDescs.join('\n')
}

async function mainLoop(env, bal){ //bal = {startbal:100, curBal}
    const allTkns = [USDC, DAI, USDT]
    const curBal = await getBalsAndDesc(allTkns, env)
    console.log(curBal.desc)
    const orderList = await getOpenLimitOrders()
    console.log(getOpenOrdersSummary(orderList))

    //for each currency pair manage open orders. (if not enough open then place new)
    const tknPairs = [[ USDC, DAI], [USDC,USDT], [DAI,USDT]]
    const tknMgtResults = await Promise.all(tknPairs.map(async (tkns) => {
        return {tkn1Mng: await manageOpenOrders(orderList, tkns[0], tkns[1], TRADE_SIZE),
                tkn2Mng: await manageOpenOrders(orderList, tkns[1], tkns[0], TRADE_SIZE) }}))

}

function sleep(ms) {return new Promise(resolve => setTimeout(resolve, ms))}

async function runManyParam(num, msDelay, f, init, param) {
    for (let i = 0; i < num; i++) {
        let delay = msDelay
        try {param = await f(init, param)}
        catch (err) {console.log(`ERROR Found: ${err}`); delay = delay * 2}
        console.log(`done loop ${i}`)
        await sleep(delay)
    }
    return param
}

//runManyParam(NUM_OF_LOOPS, LOOP_TIME_MS, mainLoop,await getEnv(privateKey), {})
