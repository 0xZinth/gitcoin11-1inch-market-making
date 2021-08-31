const axios = require('axios')

const { denomToUnit, unitToDenom, TokensDB, findTkn } = require('./poly-utils.js')


async function get0xPriceSushi(tknFrom, tknTo, amt) { //returns a promise with json result

    const params = new URLSearchParams({
        sellToken: tknFrom.address,
        buyToken: tknTo.address,
        sellAmount: unitToDenom(amt,tknFrom),
        excludedSources:'QuickSwap,ComethSwap,Dfyn,mStable,Curve,DODO_V2,DODO,Curve_V2,WaultSwap,Polydex,ApeSwap,FirebirdOneSwap,Balancer_V2,KyberDMM,LiquidityProvider,MultiHop,JetSwap,IronSwap'
    })
    
    const resp = await axios.get( "https://polygon.api.0x.org/swap/v1/price?" + params )
    return resp.data
}

async function getSushiPrices(tokens, tradeSize) {

    let allPairs= tokens.map( (v) => tokens.map( w => {return {from:v, to:w}})).flat().filter( elem => elem.from !== elem.to)

    let quotes = await Promise.all (allPairs.map(async pair => {
        let priceRes = await get0xPriceSushi(pair.from, pair.to, tradeSize)
        return{priceRes, pair} }))

    return quotes
}

async function getMaxSushiPrice(syms, tradeSize) {

    let tokens = syms.map(sym => findTkn(sym))

    let allPairs= tokens.map( (v) => tokens.map( w => {return {from:v, to:w}})).flat().filter( elem => elem.from !== elem.to)

    let quotes = await Promise.all (allPairs.map(async pair => {
        let priceRes = await get0xPriceSushi(pair.from, pair.to, tradeSize)
        return{priceRes, pair} }))

    let maxQuote = quotes.reduce((prev, curr)=> prev.priceRes.price > curr.priceRes.price ? prev : curr)

    return maxQuote
}

module.exports.getSushiPrices = getSushiPrices
module.exports.getMaxSushiPrice = getMaxSushiPrice
module.exports.get0xPriceSushi = get0xPriceSushi
/* - example
let tradeSize = 100
let tknSyms = ['USDC','DAI','USDT'] // try these USP, PUSD, XUSD, LUSD, SUSDC, RUSD

res = await GetMaxPrice(tknSyms, tradeSize)
*/
