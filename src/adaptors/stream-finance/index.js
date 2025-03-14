const utils = require('../utils');
const axios = require('axios');
const sdk = require('@defillama/sdk5');
const vaultABI = require('./abiVault.json');

// Configuration constants
const SECONDS_PER_YEAR = 31536000;
const WEEKS_PER_YEAR = 52;

// Contract addresses
const ADDRESSES = {
  ethereum: {
    vaults: {
      xUSD: '0xE2Fc85BfB48C4cF147921fBE110cf92Ef9f26F94',
      xBTC: '0x12fd502e2052CaFB41eccC5B596023d9978057d6',
      xETH: '0x7E586fBaF3084C0be7aB5C82C04FfD7592723153'
    },
    wrappers: {
      xUSD: '0x6eAf19b2FC24552925dB245F9Ff613157a7dbb4C',
      xBTC: '0x12fd502e2052CaFB41eccC5B596023d9978057d6',
      xETH: '0xF70f54cEFdCd3C8f011865685FF49FB80A386a34'
    },
    underlyingTokens: {
      xUSD: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      xBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
      xETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'  // WETH
    }
  }
};


const UNDERLYING_SYMBOL_MAP = {
  XUSD: 'USDC',
  XBTC: 'wBTC',
  XETH: 'wETH'
};


const mapToUnderlying = (vault) => UNDERLYING_SYMBOL_MAP[vault] || vault;

const getContractData = async (target, abi, chain, params = []) => {
  try {
    const result = await sdk.api.abi.call({
      target,
      abi: vaultABI.find((m) => m.name === abi),
      chain,
      params
    });
    return result.output;
  } catch (error) {
    console.error(`Error fetching ${abi} for ${target}:`, error.message);
    throw error;
  }
};

const getTokenPrice = async (priceKey, amount, decimals) => {
  try {
    const response = await axios.get(`https://coins.llama.fi/prices/current/${priceKey}`);
    if (!response.data?.coins?.[priceKey]?.price) {
      console.warn(`No price found for ${priceKey}`);
      return 0;
    }
    return (response.data.coins[priceKey].price * amount) / 10 ** decimals;
  } catch (error) {
    console.error(`Error fetching price for ${priceKey}:`, error.message);
    return 0;
  }
};


const getVaultAPY = async (vaultAddress, chain) => {
  const [currRound] = await getContractData(vaultAddress, 'vaultState', chain);
  
  const prevPricePerShare = await getContractData(
    vaultAddress, 
    'roundPricePerShare', 
    chain, 
    [currRound - 2]
  );
  
  const currPricePerShare = await getContractData(
    vaultAddress, 
    'roundPricePerShare', 
    chain, 
    [currRound - 1]
  );

  return ((currPricePerShare - prevPricePerShare) / prevPricePerShare) * 100 * WEEKS_PER_YEAR;
};

const getVaultTVL = async (chain, vaultType, vaultParams) => {
  const wrapperAddress = ADDRESSES[chain].wrappers[vaultType];
  const underlyingAddress = ADDRESSES[chain].underlyingTokens[vaultType];
  const priceKey = `${chain}:${underlyingAddress}`;
  
  const totalSupply = await getContractData(wrapperAddress, 'totalSupply', chain);
  
  return getTokenPrice(priceKey, Number(totalSupply), vaultParams[0]);
};


const main = async () => {
  const pools = [];
  
  for (const chain of Object.keys(ADDRESSES)) {
    for (const [vaultType, vaultAddress] of Object.entries(ADDRESSES[chain].vaults)) {
      try {
        const vaultParams = await getContractData(vaultAddress, 'vaultParams', chain);
        const underlyingTicker = mapToUnderlying(utils.formatSymbol(vaultType));
        
        pools.push({
          pool: `${vaultAddress}-${chain}`,
          chain: utils.formatChain(chain),
          project: 'stream-finance',
          symbol: underlyingTicker,
          tvlUsd: await getVaultTVL(chain, vaultType, vaultParams),
          apy: await getVaultAPY(vaultAddress, chain),
          poolMeta: utils.formatSymbol(vaultType)
        });
      } catch (error) {
        console.error(`Error processing vault ${vaultType} on ${chain}:`, error.message);
      }
    }
  }

  return pools.filter(utils.keepFinite);
};

module.exports = {
  timetravel: false,
  apy: main,
  url: 'https://app.streamprotocol.money'
}; 
