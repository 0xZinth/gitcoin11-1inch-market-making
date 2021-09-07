# OpenDefi-Hackathon-DHedge-Strat

This repo contains code for running two simple automated trading strategies using the dHEDGE platform. 

- [Stable Coin Re-balancing](StrategyStables.md)
- [Eth Trend Chasing](StrategyEth.md)

Addresses this gitcoin [bounty](https://gitcoin.co/issue/dhedge/dhedge-docs/4/100026363).
## How to run

- Clone this repository
- Install Dependencies ```npm install```
- [Setup the env file](#env-file-setup)

Review the code and modify for your own purpose.

To run the strategies:

- Stable Swapping strategy ```node main.js```
- Eth Trend Chaser strategy ```node main-eth.js```

### Comments on DHedge API

Some points about using the DHedge API

- I used the API to create the pool. I passed performance fee as 10 but it shows as 0 on the web site
- There is no way to override gasLimit and gasPrice. For trading I inherited pool class and create override for trade function.
  - Note I had to over ride gasLimit as my trade transactions were failing
  - In polygon the gas price is volatile so I am overriding with fast gas.

### .env file setup

Rename `.env.sample` to `.env` and review/set the parameters:

- RPC=https://polygon-rpc.com/
- PRIVATE_KEY= Your Private Key Goes Here
- ADDR=<add your address here>
- STABLES_POOL=<strategy: dHedge pool address>
- ETH_POOL=<strategy: dHedge pool address>
- MAX_GAS=31
- GAS_LIMIT=1000000
- TRADE_SIZE=20
- ETH_TRADE_SIZE=0.01
- ETH_TRIGGER_BP=10
- ETH_POLL_TIME=10
- LOOP_TIME_MS=10000
- NUM_OF_LOOPS=100000

## Links to the strategys on dHEDGE

- [Eth Trend Chaser](https://app.dhedge.org/manager/0x4ccd4510d7ae04dcc36e4bb541ebce5dc5023c34)
- [Stable Swapping](https://app.dhedge.org/manager/0x32fab5a22b5545b9dff82f6db6c87434960955d3)

## Resources

- [dHEDGE Docs](https://docs.dhedge.org/)
- [Announcing dHEDGE V2](https://medium.com/dhedge-org/announcing-dhedge-v2-ed741b529b73)
- [dHEDGE V2 SDK (npm)](https://www.npmjs.com/package/@dhedge/v2-sdk)
- [dHEDGE V2 SDK (Medium)](https://medium.com/dhedge-org/dhedge-v2-sdk-d5d008fe255d)
- [dHEDGE V2 SDK Example (boilerplate)](https://github.com/dhedge/dhedge-v2-sdk-examples)
- [dHEDGE Discord](https://discord.gg/BAWTbRA)