'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

/*
 * Copyright (c) 2017-present, Overline-BSI developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const BC_SUPER_COLLIDER = process.env.BC_SUPER_COLLIDER ? process.env.BC_SUPER_COLLIDER.toLowerCase() : 'bc';
const { writeFileSync } = require('fs');
const { inspect } = require('util');
const fkill = require('fkill');

const crypto = require('crypto');
const BN = require('bn.js');
const debug = require('debug')('bcnode:mining:officer');
const debugNew = require('debug')('bcnode:mining:officer:new');
const debugChild = require('debug')('bcnode:mining:officer:children');
const { calcTxFee } = require('bcjs/dist/transaction');
const { max, mean, merge, all, equals, values, min } = require('ramda');

const { blake2bl } = require('../utils/crypto');
const { distance, prepareWork, prepareNewBlock, getUniqueBlocks } = require('./primitives');
let numCPUs = max(1, Number(require('os').cpus().length) - 1);
const BC_MINER_WORKERS = process.env.BC_MINER_WORKERS !== undefined ? parseInt(process.env.BC_MINER_WORKERS) : numCPUs;
const { getLogger } = require('../logger');
const { Block, BcBlock, BlockchainHeaders } = require('@overline/proto/proto/core_pb');
const { MinerRequest, MinerResponseResult } = require('@overline/proto/proto/miner_pb');
const { RpcClient } = require('../rpc');
const { isDebugEnabled, ensureDebugPath } = require('../debug');
const { ROVER_SECONDS_PER_BLOCK, ROVER_RESYNC_PERIOD, shuffle } = require('../rover/utils');
const { LSK_MAX_FETCH_BLOCKS } = require('../rover/lsk/controller');
const { ETH_MAX_FETCH_BLOCKS } = require('../rover/eth/network');
const { childrenHeightSum, validateRoveredSequences, isValidBlock, validRoverChain, VALIDATION_GAP_BC_HEIGHT_INTERVAL, childrenHighestBlock } = require('../bc/validation');
const { getBlockchainsBlocksCount } = require('../bc/helper');
const ts = require('../utils/time').default; // ES6 default export
const { parseBoolean } = require('../utils/config');
const { getMaxDistanceWithEmblems, getTxsDistanceSum, getNrgGrant, txCreateCoinbase, getMaxBlockSize, COINBASE_TX_ESTIMATE_SIZE } = require('../core/txUtils');
const { MAX_NRG_VALUE } = require('../core/coin');

const BC_MINER_MUTEX = process.env.BC_MINER_MUTEX === 'true'; // open up cpu resources for AMD miner
const BC_MINER_BOOT = process.env.BC_MINER_BOOT === 'true'; // initialize new super collider
const BC_WISE_LINE = process.env.BC_WISE_LINE === 'true'; // trust rovers over child chain mainnet
const BC_LOW_POWER_MODE = process.env.BC_LOW_POWER_MODE === 'true'; // overline research station
const MIN_HEALTH_NET = process.env.MIN_HEALTH_NET === 'true';
const BC_ACCEPT_ALL_TXS = process.env.BC_ACCEPT_ALL_TXS === 'true';
const BC_USER_QUORUM = process.env.BC_USER_QUORUM ? Number(process.env.BC_USER_QUORUM) : 8;
const DISABLE_IPH_TEST = parseBoolean(process.env.DISABLE_IPH_TEST);
const BC_GRPC_MINER = parseBoolean(process.env.BC_GRPC_MINER);
const BC_MINER_NO_BROADCAST = parseBoolean(process.env.BC_MINER_NO_BROADCAST);

const BC_NETWORK_AGING_RATE = exports.BC_NETWORK_AGING_RATE = process.env.BC_NETWORK_AGING_RATE ? parseInt(process.env.BC_NETWORK_AGING_RATE) : 19800000;

const chainToGet = chain => `get${chain[0].toUpperCase() + chain.slice(1)}List`;

class MiningOfficer {

  constructor(pubsub, persistence, workerPool, txPendingPool, chainState, engineEmitter, options) {
    const opts = merge({ relayMode: false }, options);
    this._minerBootLock = false;
    this._logger = getLogger(__filename);
    this._minerKey = opts.minerKey;
    this._pubsub = pubsub;
    this._persistence = persistence;
    this._knownRovers = opts.rovers;
    this._unfinished = [];
    this._txsToMine = [];
    this._startupTimeMS = Number(new Date());
    this._workerPool = workerPool;
    this._emitter = engineEmitter;
    this._roverEmitter = opts.roverEmitter;
    this._highestBestChainHash = "hal";
    this._relayMode = opts.relayMode;

    this._speedResults = [];
    this._collectedBlocks = {};
    for (let roverName of this._knownRovers) {
      this._collectedBlocks[roverName] = 0;
    }
    this._canMine = false;
    this._timers = {};
    this._timerResults = {};
    this._unfinishedBlockData = {
      block: undefined,
      lastPreviousBlock: undefined,
      currentBlocks: {},
      timeDiff: undefined,
      iterations: undefined
    };
    this._paused = false;
    this._blockTemplates = [];

    this._rpc = new RpcClient();
    this._txPendingPool = txPendingPool;
    this._chainState = chainState;
    this._currentWork = null;
    if (opts.txHandler) {
      this._txHandler = opts.txHandler;
    }
  }

  get pubsub() {
    return this._pubsub;
  }

  get persistence() {
    return this._persistence;
  }

  get paused() {
    return this._paused;
  }

  set paused(paused) {
    this._paused = paused;
  }

  async getState(emblemPerformance = 0) {
    const keys = Object.keys(this._collectedBlocks);
    const complete = keys.length * 100;
    let progress = 0;
    let edge = await this._persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);
    if (!edge) {
      edge = 1;
    }
    const report = {};
    const ls = [];
    const silentRovers = [];
    const values = keys.reduce((all, a, i) => {
      const val = this._collectedBlocks[a];
      const requiredBlockCount = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[a]);
      if (this._collectedBlocks[a] && this._collectedBlocks[a] < 1) {
        silentRovers.push(a);
      } else if (!this._collectedBlocks[a]) {
        silentRovers.push(a);
      }

      let perc = parseFloat(this._collectedBlocks[a] / requiredBlockCount * 100).toFixed(2);
      progress = progress + parseFloat(perc);
      if (Number(perc) >= 100) {
        ls.push(a);
        report[a] = true;
        perc = '100.00';
      }
      if (Number(perc) >= 100) {
        ls.push(a);
        report[a] = true;
      }
      if (i === keys.length - 1) {
        //all = all + a + ':' + perc + '% ' + val
        all = all + a + ':' + perc + '% ';
      } else {
        all = all + a + ':' + perc + '%, ';
        //all = all + a + ':' + perc + '% ' + val + ', '
      }
      return all;
    }, '');

    const percProgress = parseFloat(progress / complete * 100).toFixed(2);
    const visProgress = percProgress >= 100 ? 10 : max(1, Math.floor(percProgress / 10) - 1);
    let visual = '          '.split('');
    visual = visual.map((c, i) => {
      if (i < visProgress) {
        c = '=';
      }
      return c;
    }).join('');
    ls.map(ab => {
      report[ab] = true;
    });
    //this._logger.info(`ROVERS ${edge}:[${visual}] ` + values + ' ')
    // check if the the network passed its stale limit
    const backSyncPeriodSet = process.env.BC__BACKSYNC_PERIOD && !Number.isNaN(process.env.BC__BACKSYNC_PERIOD);
    const nowMS = Number(new Date());
    const currentTime = nowMS - BC_NETWORK_AGING_RATE;
    if (this._startupTimeMS && currentTime > this._startupTimeMS && silentRovers.length > 0 && !backSyncPeriodSet) {
      this._startupTimeMS = false;
      for (let r of silentRovers) {
        const requiredBlockCount = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[r]);
        this._collectedBlocks[r] = requiredBlockCount + 1;
      }
    } else if (this._startupTimeMS && currentTime > this._startupTimeMS && silentRovers.length === 0 && !backSyncPeriodSet) {
      this._startupTimeMS = false;
    }
    if (percProgress > 99.99) {
      return true;
    }
    return false;
  }

  async printState(emblemPerformance = 0) {
    const keys = Object.keys(this._collectedBlocks);
    const backSyncPeriodSet = process.env.BC__BACKSYNC_PERIOD && !Number.isNaN(process.env.BC__BACKSYNC_PERIOD);
    const complete = keys.length * 100;
    let progress = 0;
    let edge = await this._persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);
    if (!edge) {
      edge = 1;
    }
    const report = {};
    const ls = [];
    const silentRovers = [];
    const values = keys.reduce((all, a, i) => {
      const val = this._collectedBlocks[a];
      const requiredBlockCount = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[a]);
      if (this._collectedBlocks[a] && this._collectedBlocks[a] < 1) {
        silentRovers.push(a);
      } else if (!this._collectedBlocks[a]) {
        silentRovers.push(a);
      }

      let perc = parseFloat(this._collectedBlocks[a] / requiredBlockCount * 100).toFixed(2);
      progress = progress + parseFloat(perc);
      if (Number(perc) >= 100) {
        ls.push(a);
        report[a] = true;
        perc = '100.00';
      }
      if (Number(perc) >= 100) {
        ls.push(a);
        report[a] = true;
      }
      if (i === keys.length - 1) {
        //all = all + a + ':' + perc + '% ' + val
        all = all + a + ':' + perc + '% ';
      } else {
        all = all + a + ':' + perc + '%, ';
        //all = all + a + ':' + perc + '% ' + val + ', '
      }
      return all;
    }, '');

    const percProgress = parseFloat(progress / complete * 100).toFixed(2);
    const visProgress = percProgress >= 100 ? 10 : max(1, Math.floor(percProgress / 10) - 1);
    let visual = '          '.split('');
    visual = visual.map((c, i) => {
      if (i < visProgress) {
        c = '=';
      }
      return c;
    }).join('');
    ls.map(ab => {
      report[ab] = true;
    });
    this._logger.info(`ROVERS ${edge}:[${visual}] ` + values + ' ');
    // check if the the network passed its stale limit
    const nowMS = Number(new Date());
    const currentTime = nowMS - BC_NETWORK_AGING_RATE;
    if (this._startupTimeMS && currentTime > this._startupTimeMS && silentRovers.length > 0 && !backSyncPeriodSet) {
      this._startupTimeMS = false;
      this._logger.info(`${silentRovers.join(', ')} rovers expanding to Overline network...`);
      for (let r of silentRovers) {
        const requiredBlockCount = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[r]);
        this._collectedBlocks[r] = requiredBlockCount + 1;
      }
    } else if (this._startupTimeMS && currentTime > this._startupTimeMS && silentRovers.length === 0 && !backSyncPeriodSet) {
      this._startupTimeMS = false;
    }
    return report;
  }

  getRawMarkedTxs(header) {
    const txsProto = header.getMarkedTxsList();
    return txsProto.reduce((all, tx) => {
      all.push(tx.toObject());
      return all;
    }, []);
  }

  async validateMarkedTxs(roveredBlock, cache) {
    if (!roveredBlock.getMarkedTransactionsList) {
      this._logger.warn(`rover sent malformed block`);
    }

    const rover = roveredBlock.getBlockchain();
    const foundMarkedTxs = this.getRawMarkedTxs(roveredBlock);
    const blockHashes = cache.keys();
    const invalidBlocks = [];

    for (let hash of blockHashes) {
      const block = cache.get(hash);
      if (!block || !block.getBlockchainHeaders) {
        continue;
      }
      if (block.getBlockchainHeaders) {
        const headers = block.getBlockchainHeaders()[chainToGet(rover)]();
        const txs = headers.reduce((all, header) => {
          if (all && header.getHash() === roveredBlock.getHash() && all.length === 0) {
            this._logger.info(`found matching rovered ${rover} block ${header.getHash()} in ${BC_SUPER_COLLIDER} block cached ${hash}`);
            all = this.getRawMarkedTxs(header);
          } else if (all && header.getHash() === roveredBlock.getHash() && all.length !== 0) {
            all = false;
          }
          return all;
        }, []);

        // malformed block has duplicate headers with the same hash
        if (!txs) {
          this._logger.warn(`critical warning for block ${hash} <- duplicate headers`);
          invalidBlocks.push(hash);
        }

        if (txs && txs.length === foundMarkedTxs.length) {
          const foundTxs = txs.reduce((all, tx) => {
            all = all.concat(foundMarkedTxs.filter(x => {
              // check if marked txs
              if (x.value === tx.value && x.hash === tx.hash && x.id === tx.id && x.token === tx.token && x.addrFrom === tx.addrFrom && x.addrTo === tx.addrTo && x.blockHeight === tx.blockHeight && x.index === tx.index) {
                return true;
              } else {
                return false;
              }
            }));
            return all;
          }, []);

          if (foundTxs.length !== foundMarkedTxs.length) {
            this._logger.warn(`missing marked transactions from ${rover} block ${roveredBlock.getHeight()} found by rover: ${foundMarkedTxs.length}, found in ${BC_SUPER_COLLIDER} block ${foundTxs.length}`);
            invalidBlocks.push(hash);
          }
        } else if (txs) {
          this._logger.warn(`malformed rovered ${rover} block ${roveredBlock.getHeight()}  ${hash} <- tx count mismatch ${foundMarkedTxs.length} and ${txs.length}`);
          invalidBlocks.push(hash);
        }
      }
    }
    return Promise.resolve(true);
  }

  async newRoveredBlock(rovers, block, blockCache, areRoversSynced, blockLruCache, emblemPerformance = 0) {
    let iph;
    debug(`DISABLE_IPH_TEST: ${DISABLE_IPH_TEST}`);
    debugNew('new rovered block called');
    if (this._relayMode) return;
    emblemPerformance = emblemPerformance && emblemPerformance > 0 ? emblemPerformance * 10 : 0;
    const radPower = emblemPerformance && emblemPerformance > 0 ? Math.floor(emblemPerformance * 6757) : 0;

    //if (BC_MINER_BOOT && this._minerBootLock) {
    //  this._logger.info(`miner boot yielding ${block.getBlockchain()} block ${block.getHeight()}`)
    //  return
    //}

    if (DISABLE_IPH_TEST === false) {
      iph = await this._persistence.get('bc.sync.initialpeerheader');
    } else {
      // allows mining to continue by force passing the IPH test
      this._logger.debug('SECURITY ALERT: IPH test is has been overridden by DISABLE_IPH_TEST');
      iph = 'complete';
    }

    if (BC_MINER_MUTEX) {
      const bcmm = await this._persistence.get(`${BC_SUPER_COLLIDER}.miner.mutex`);
      if (!bcmm) {
        this._logger.error(`BC MINER MUTEX is true but the key is unabled to be extracted from storage`);
        return;
      }
      if (bcmm !== 'open') {
        this._logger.info('[] <- [] ' + 'ROVER-BLOCKED BY MUTEX ' + block.getBlockchain() + ' block ' + block.getHeight() + ' ' + block.getHash().slice(0, 48) + ' <- EMB MINING POWER +' + emblemPerformance + '% OL (' + radPower + ' RAD/s)');
        return;
      }
      await this._persistence.put(`${BC_SUPER_COLLIDER}.miner.mutex`, 'closed');
    }

    const latestRoveredBlock = await this._persistence.get(`${BC_SUPER_COLLIDER}.rover.latest`);
    if (!latestRoveredBlock && !block) {
      this._logger.error(`no latest block assigned, unable to set miner`);
      if (BC_MINER_MUTEX) {
        await this._persistence.put(`${BC_SUPER_COLLIDER}.miner.mutex`, 'open');
      }
      return;
    } else if (latestRoveredBlock && !block) {
      block = latestRoveredBlock;
    } else if (!latestRoveredBlock && block) {
      await this._persistence.put(`${BC_SUPER_COLLIDER}.rover.latest`, block);
    }

    let synced = await this._persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
    if (!BC_MINER_BOOT && block && synced && synced !== 'complete') {
      this._logger.info('[] <- [] ' + 'ROVER ' + block.getBlockchain() + ' block ' + block.getHeight() + ' ' + block.getHash().slice(0, 48) + ' <- EMB MINING POWER +' + emblemPerformance + '% OL (' + radPower + ' RAD/s)');
      return;
    } else if (BC_MINER_BOOT !== false && block && synced && synced !== 'complete') {
      this._logger.info('[] <- [] ' + 'ROVER (BCMB: TRUE)' + block.getBlockchain() + ' block ' + block.getHeight() + ' ' + block.getHash().slice(0, 48) + ' <- EMB MINING POWER +' + emblemPerformance + '% OL (' + radPower + ' RAD/s)');
      await this._persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'complete');
      synced = 'complete';
    } else if (block && synced && synced === 'pending') {
      this._logger.info('[] <- [] EDGE <- ' + 'ROVER ' + block.getBlockchain() + ' block ' + block.getHeight() + ' ' + block.getHash().slice(0, 48) + ' <- EMB MINING POWER +' + emblemPerformance + '% OL (' + radPower + ' RAD/s)');
      //return
    } else if (block) {
      this._logger.info('[] <- [] MINER EDGE <- ' + 'ROVER ' + block.getBlockchain() + ' block ' + block.getHeight() + ' ' + block.getHash().slice(0, 48) + ' <- EMB MINING POWER +' + emblemPerformance + '% OL (' + radPower + ' RAD/s)');
    }

    if (synced !== 'complete') {
      this._logger.info(`multiverse edge evaluation is progress: ${block.getHeight()}`);
      return;
    }

    let minimumBlockCount = false;
    if (!this._canMine && all(numCollected => numCollected >= 1, values(this._collectedBlocks)) && areRoversSynced === true) {
      // only run heavier operation once the lite checks for mining readiness pass
      minimumBlockCount = true;
    }

    if (!this._canMine && minimumBlockCount) {
      this._canMine = true;
    }

    if (this._canMine === true && MIN_HEALTH_NET === false && !DISABLE_IPH_TEST) {
      try {
        const quorumConfig = await this._persistence.get(`${BC_SUPER_COLLIDER}.dht.quorum`);
        const quorum = BC_USER_QUORUM && !isNaN(BC_USER_QUORUM) ? BC_USER_QUORUM : quorumConfig;
        if (quorum === null) {
          this._canMine = false;
          this._logger.error('quorum state is not persisted on disk');
          return Promise.reject(new Error('critical error -> restart application'));
        }
        if (parseInt(quorum, 10) < 1 && this._canMine === true) {
          this._logger.info('peer waypoint discovery in progress');
          this._canMine = false;
          return Promise.resolve(false);
        }
      } catch (err) {
        this._canMine = false;
        this._logger.error('quorum state is not persisted on disk');
        this._logger.error(err);
        return Promise.reject(new Error('critical error -> restart application'));
      }
    }
    // Check if _canMine
    // if iph is pending mining can start
    // if iph is running mining can start
    if (BC_MINER_BOOT) {
      this._canMine = true;
      iph = 'complete';
    }
    if (!this._canMine || iph !== 'complete') {
      if (!DISABLE_IPH_TEST) {
        await this.printState(emblemPerformance);
        if (BC_MINER_MUTEX) {
          await this._persistence.put(`${BC_SUPER_COLLIDER}.miner.mutex`, 'open');
        }
        this._logger.info(`mining yielding multiverse threshold`);
        return Promise.resolve(false);
      }
    }

    // Check if peer is syncing
    if (this.paused) {
      this._logger.info(`mining and ledger updates disabled until initial multiverse threshold is met`);
      return Promise.resolve(false);
    }

    // Check if all rovers are enabled
    if (!rovers || !Array.isArray(rovers)) {
      rovers = this._knownRovers;
    }

    if (equals(new Set(this._knownRovers), new Set(rovers)) === false && !BC_MINER_BOOT) {
      this._logger.info(`consumed blockchains manually overridden, mining services disabled, active multiverse rovers: ${JSON.stringify(rovers)}, known: ${JSON.stringify(this._knownRovers)})`);
      return Promise.resolve(false);
    }

    return this.startMining(rovers, block).then(res => {
      if (res) {
        this._logger.info('mining work successfully updated');
        return Promise.resolve(res);
      } else {
        return Promise.resolve(false);
      }
    }).catch(err => {
      this._logger.error(err);
      return Promise.reject(err);
    });
  }

  async terminate() {
    try {
      await fkill('bcworker', { force: true, silent: true });
    } catch (err) {
      this._logger.warn(`Could not clean up miner processes due to error: ${err.message}, you have to manually clean all "bcworker" processes`);
    }
    this._cleanUnfinishedBlock();
  }

  startTimer(name) {
    this._timers[name] = Math.floor(Date.now() * 0.001);
  }

  // TODO: will have to remake, no boundaries
  stopTimer(name) {
    if (this._timers[name] !== undefined) {
      const startTime = this._timers[name];
      delete this._timers[name];
      const elapsed = Math.floor(Date.now() * 0.001) - startTime;
      if (this._timerResults[name] === undefined) {
        this._timerResults[name] = [];
      }
      this._timerResults[name].push(elapsed);
      return elapsed;
    }
    return 0;
  }

  getTimerResults(name) {
    if (this._timerResults[name] !== undefined && this._timerResults[name].length > 4) {
      return mean(this._timerResults[name]);
    }
  }

  async startMining(rovers, block, givenWorkId) {

    if (BC_LOW_POWER_MODE || this._relayMode) {
      this._logger.info(`[] -> [] NOT MINING (low power turret mode)`);
      return true;
    }
    //try {
    let lastPreviousBlock = await this.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`, { sync: true });
    // let lastUTXOBlock = await this.persistence.get(`bc.block.last.utxoSaved`)
    // if(lastPreviousBlock && lastUTXOBlock && (lastUTXOBlock.getHeight() > lastPreviousBlock.getHeight())){
    //   lastPreviousBlock = lastUTXOBlock;
    // }

    const initialSync = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`, { sync: true });

    if (!initialSync || initialSync !== 'complete') {
      this._logger.info(`mining begins after initial sync is complete, current status: ${initialSync}`);
      return;
    }

    if (!lastPreviousBlock) {
      //const lbc = await this._persistence.getBlockByHeight(6882911, BC_SUPER_COLLIDER)
      //const lbd = await this._persistence.getBlockByHeight(6882910, BC_SUPER_COLLIDER)
      //const lbe = await this._persistence.getBlockByHeight(6882909, BC_SUPER_COLLIDER)
      //if (lbc) {
      //  await this._persistence.put(`${BC_SUPER_COLLIDER}.block.latest`, lbc)
      //  await this._persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, lbc.getHeight())
      //  lastPreviousBlock = lbc
      //} else if (lbd) {
      //  await this._persistence.put(`${BC_SUPER_COLLIDER}.block.latest`, lbd)
      //  await this._persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, lbd.getHeight())
      //  lastPreviousBlock = lbd
      //} else if (lbe) {
      //  await this._persistence.put(`${BC_SUPER_COLLIDER}.block.latest`, lbe)
      //  await this._persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, lbe.getHeight())
      //  lastPreviousBlock = lbe
      //} else {
      const msg = `${BC_SUPER_COLLIDER}.block.latest not available on disk`;
      this._logger.error(msg);
      throw new Error(msg);
      //}
    }

    const ch = parseInt(lastPreviousBlock.getHeight(), 10);
    const collideAtRover = ch > 4851565 && ch < 4851965 ? 'lsk' : false;

    let { bestChain, missingBlocks } = await validRoverChain(this._knownRovers, this.persistence, BC_WISE_LINE && parseInt(lastPreviousBlock.getHeight(), 10) === 1771220, collideAtRover);
    if (!missingBlocks) {
      missingBlocks = {};
    }

    if (lastPreviousBlock.getHeight() > VALIDATION_GAP_BC_HEIGHT_INTERVAL[0] && lastPreviousBlock.getHeight() < VALIDATION_GAP_BC_HEIGHT_INTERVAL[0]) {
      delete missingBlocks['lsk'];
    }
    const mbs = Object.keys(missingBlocks);

    if (!bestChain) {
      this._logger.info(`cannot assert best chain from local disk until rover range is complete...yielding mining`);
      return false;
    }

    if (mbs.length > 0) {
      const ts = Math.floor(Date.now() * 0.001);
      const rmraw = await this.persistence.get(`${BC_SUPER_COLLIDER}.rover.mutex`);
      if (rmraw) {
        const rm = parseInt(rmraw, 10);
        const diff = ts - rm;
        debug(`evaluating last rover request ${diff} seconds ago <- ${rm}`);
        let maxHeight = 8;
        //if (mbs.indexOf('btc') > -1 && diff >= 385) {
        if (diff >= 55) {
          debug(`last rover request approved`);
          await this.persistence.put(`${BC_SUPER_COLLIDER}.rover.mutex`, ts);
          let s = shuffle(mbs);
          for (let rov of s) {
            const sr = missingBlocks[rov];
            const highest = min(sr.highest, sr.lowest + maxHeight);

            await this.persistence.put(`${rov}.range.lowest.height`, sr.lowest);
            await this.persistence.put(`${rov}.range.highest.height`, highest);

            this._logger.info(`requesting ${rov} rover search for ${sr.lowest} -> ${highest}`);
            this.pubsub.publish('rover.request', {
              type: 'rover.request',
              data: {
                rover: rov,
                highest: highest,
                lowest: sr.lowest - 1
              }
            });
          }
        } else if (mbs.indexOf('lsk') > -1 && diff > 55) {
          const rov = 'lsk';
          const sr = missingBlocks[rov];
          const highest = sr.lowest + LSK_MAX_FETCH_BLOCKS;
          await this.persistence.put(`${rov}.range.lowest.height`, sr.lowest);
          await this.persistence.put(`${rov}.range.highest.height`, highest);
          this._logger.info(`requesting ${rov} rover search for ${sr.lowest} -> ${highest}`);
          this.pubsub.publish('rover.request', {
            type: 'rover.request',
            data: {
              rover: rov,
              highest: highest,
              lowest: sr.lowest
            }
          });
        } else if (mbs.indexOf('wav') > -1 && diff > 55) {
          const rov = 'wav';
          const sr = missingBlocks[rov];
          const highest = min(sr.highest, sr.lowest + maxHeight);
          await this.persistence.put(`${rov}.range.lowest.height`, sr.lowest);
          await this.persistence.put(`${rov}.range.highest.height`, highest);
          this._logger.info(`requesting ${rov} rover search for ${sr.lowest} -> ${highest}`);
          this.pubsub.publish('rover.request', {
            type: 'rover.request',
            data: {
              rover: rov,
              highest: highest,
              lowest: sr.lowest
            }
          });
        } else if (mbs.indexOf('eth') > -1 && diff > 55) {
          const rov = 'eth';
          const sr = missingBlocks[rov];
          const highest = min(sr.highest, sr.lowest + ETH_MAX_FETCH_BLOCKS);
          await this.persistence.put(`${rov}.range.lowest.height`, sr.lowest);
          await this.persistence.put(`${rov}.range.highest.height`, highest);
          this._logger.info(`requesting ${rov} rover search for ${sr.lowest} -> ${highest}`);
          this.pubsub.publish('rover.request', {
            type: 'rover.request',
            data: {
              rover: rov,
              highest: highest,
              lowest: sr.lowest
            }
          });
        } else if (mbs.indexOf('neo') > -1 && diff > 55) {
          const rov = 'neo';
          const sr = missingBlocks[rov];
          const highest = min(sr.highest, sr.lowest + maxHeight);
          await this.persistence.put(`${rov}.range.lowest.height`, sr.lowest);
          await this.persistence.put(`${rov}.range.highest.height`, highest);
          this._logger.info(`requesting ${rov} rover search for ${sr.lowest} -> ${highest}`);
          this.pubsub.publish('rover.request', {
            type: 'rover.request',
            data: {
              rover: rov,
              highest: highest,
              lowest: sr.lowest
            }
          });
        } else {
          debug(`rover transmission in ${55 - diff} seconds...`);
        }
      } else {
        await this.persistence.put(`${BC_SUPER_COLLIDER}.rover.mutex`, ts);
        let s = shuffle(mbs);
        for (let rov of s) {
          const sr = missingBlocks[rov];
          const highest = min(sr.highest, sr.lowest + maxHeight);

          await this.persistence.put(`${rov}.range.lowest.height`, sr.lowest);
          await this.persistence.put(`${rov}.range.highest.height`, highest);

          this._logger.info(`requesting ${rov} rover search for ${sr.lowest} -> ${highest}`);
          this.pubsub.publish('rover.request', {
            type: 'rover.request',
            data: {
              rover: rov,
              highest: highest,
              lowest: sr.lowest - 1
            }
          });
        }
      }
    }

    // $FlowFixMe
    debug(`all blocks ready, starting mining`);

    if (bestChain.length < 1) {
      // no potential new blocks to mine on
      debug(`multichain is at edge of global state`);

      if (BC_MINER_MUTEX) {
        await this._persistence.put(`${BC_SUPER_COLLIDER}.miner.mutex`, 'open');
      }

      return;
    } else {

      bestChain = bestChain.sort((a, b) => {
        if (parseInt(a.getHeight(), 10) < parseInt(b.getHeight(), 10)) {
          return -1;
        }
        if (parseInt(a.getHeight(), 10) > parseInt(b.getHeight(), 10)) {
          return 1;
        }
        return 0;
      });

      if (bestChain.length > 10) {
        this._minerBootLock = true;
      }

      for (let bk of bestChain) {
        if (bk && bk.getBlockchain) {
          debug(`preparing ${bestChain.length} block(s) for collision: ${bk.getBlockchain()} ${bk.getHeight()} : ${bk.getHash().slice(0, 8)}, prev: ${bk.getPreviousHash().slice(0, 8)}`);
        }
      }

      // TD
      debug(`collision edge: ${bestChain[0].getBlockchain()} ${bestChain[0].getHeight()} hash: ${bestChain[0].getHash().slice(0, 8)} segment: ${bestChain.length}`);
    }

    debug('----------- MISSING BLOCKS --------');
    debug(missingBlocks);

    this._highestBestChainHash = bestChain[0].getHash();
    if (this._relayMode) {
      this._logger.info(`[] -> [] NOT MINING "--relay-mode" flag is set <- colliding blocks: ${bestChain.length}, missing links: ${Object.keys(missingBlocks).length}`);
      return true;
    }

    if (BC_LOW_POWER_MODE) {
      this._logger.info(`[] -> [] NOT MINING "BC_LOW_POWER_MODE=TRUE" is set <- colliding blocks: ${bestChain.length}, missing links: ${Object.keys(missingBlocks).length}`);
      return true;
    }

    const currentTimestamp = ts.nowSeconds();

    if (this._unfinishedBlockData && this._unfinishedBlockData.lastPreviousBlock && this._unfinishedBlockData.lastPreviousBlock.getHash() !== lastPreviousBlock.getHash()) {
      this._logger.warn(`previous latest block ${this._unfinishedBlockData.lastPreviousBlock.getHash()} does not match last previous ${lastPreviousBlock.getHash()}`);
      //this._cleanUnfinishedBlock()
    }

    // TODO: After executive branches switch this
    let txsToMine = [];
    let txsSizeSoFar = 0;
    const maxBlockSize = (await getMaxBlockSize(this._minerKey, this.persistence)) - COINBASE_TX_ESTIMATE_SIZE;
    const maxNumberOfTx = Math.floor(maxBlockSize / COINBASE_TX_ESTIMATE_SIZE);
    const blockHeight = parseInt(lastPreviousBlock.getHeight(), 10) + 1;

    const candidateTxs = await this._txPendingPool.loadBestPendingTxs(maxNumberOfTx, lastPreviousBlock);
    for (let tx of candidateTxs) {
      if (tx.getInputsList().length > 0) {
        const thisTxSize = tx.serializeBinary().length;
        if (txsSizeSoFar + thisTxSize > maxBlockSize) {
          break;
        }
        // const {err,success} = await this._txHandler.isValidTxError(tx, {block:lastPreviousBlock,latestBlockHeight:lastPreviousBlock.getHeight()});
        // if(success){
        txsSizeSoFar += thisTxSize;
        txsToMine.push(tx);
        // }
      }
    }

    const wirelessTxs = blockHeight > 5786149 ? txsToMine : false;
    const emblemObject = await getMaxDistanceWithEmblems(this._minerKey, this.persistence, wirelessTxs);
    debug(`[] -> [ ] preparing MINER block ${parseInt(lastPreviousBlock.getHeight(), 10) + 1} max size: ${maxBlockSize}, est. max tx: ${maxNumberOfTx}, total distance: ${emblemObject.totalDistance}, EMBLEM (EMB) adding ${emblemObject.emblemBonus}`);

    debug(`loading ${txsToMine.length} txs for block template`);

    const coinbaseTx = await txCreateCoinbase(lastPreviousBlock.getHeight(), this.persistence, txsToMine, // txs without coinbase tx
    this._minerKey, emblemObject);

    if (!coinbaseTx) {
      this._logger.error(`critical error creating coinbase TX`);
      return;
    }
    // sum of distances without coinbase
    const txsDistanceSum = getTxsDistanceSum(txsToMine);
    const allTxs = [coinbaseTx].concat(txsToMine);
    let mintedNrg = await this._persistence.getNrgMintedSoFar();
    let nrgGrant = 0;

    if (!mintedNrg) {
      mintedNrg = 0;
    }

    if (mintedNrg < MAX_NRG_VALUE) {
      nrgGrant = getNrgGrant(emblemObject.emblemBonus, emblemObject.totalDistance, txsDistanceSum, parseInt(lastPreviousBlock.getHeight(), 10) + 1);
    }

    if (mintedNrg + nrgGrant > MAX_NRG_VALUE) {
      nrgGrant = MAX_NRG_VALUE - mintedNrg;
    }

    debug(`Adding ${allTxs.length} Txs to Block #${lastPreviousBlock.getHeight() + 1}`);
    debug(`txs unclaimed, length: ${allTxs.length}, size: ${txsSizeSoFar + coinbaseTx.serializeBinary().length}, maxBlockSize: ${maxBlockSize}`);

    const [newBlock, finalTimestamp, triggerBlock] = await prepareNewBlock(currentTimestamp, lastPreviousBlock, bestChain, block, allTxs, this._minerKey, this._unfinishedBlock, this._persistence, nrgGrant);

    const prevChildBlocks = childrenHighestBlock(lastPreviousBlock);
    const currentChildBlocks = childrenHighestBlock(newBlock);
    const mergeChildChains = [].concat(rovers).filter(chain => {
      return currentChildBlocks.reduce((all, b) => {
        if (!all) {
          return;
        }
        if (b.blockchain === chain) {
          all = false;
        }
        return all;
      }, true);
    });
    debug(`chains to inject: ${mergeChildChains}`);
    debugChild(`chains to inject: ${mergeChildChains}`);

    //for (const b of mergeChildChains) {
    //  for (const i of prevChildBlocks) {
    //     if (i.blockchain === b) {
    //       currentChildBlocks.push(i)
    //       break
    //     }
    //  }
    //}

    debugChild({ prevChildBlocks });
    debugChild({ currentChildBlocks });
    const prevBlockHeightSum = childrenHeightSum(lastPreviousBlock);
    const newBlockChildHeightSum = childrenHeightSum(newBlock);

    if (prevBlockHeightSum >= newBlockChildHeightSum) {
      this._logger.info(`newest block does not increase weight <- weight change: ${prevBlockHeightSum - newBlockChildHeightSum} prev block: ${prevBlockHeightSum}, new block: ${newBlockChildHeightSum} yielding...`);
      return;
    }

    const workId = givenWorkId ? givenWorkId : lastPreviousBlock.getHeight() + '0000' + crypto.randomBytes(10).toString('hex');
    this._logger.info(`[] -> [] MINER work to collide: ${workId}, block ${newBlock.getHeight()}, ol grant: ${nrgGrant}, radians: ${newBlock.getDifficulty()}`);
    const work = prepareWork(lastPreviousBlock.getHash(), newBlock.getBlockchainHeaders());
    this._currentWork = work;
    newBlock.setNrgGrant(nrgGrant);
    newBlock.setTimestamp(finalTimestamp);
    this._unfinishedBlock = newBlock;
    this._unfinishedBlockData = {
      lastPreviousBlock,
      currentBlocks: newBlock.getBlockchainHeaders(),
      block: triggerBlock,
      iterations: undefined,
      timeDiff: undefined

      // start discarding templated blocks
    };if (this._unfinished.length > 250) {
      this._unfinished.shift();
    }

    this._unfinished.push({
      workId: workId,
      unfinishedBlock: newBlock,
      unfinishedBlockData: {
        lastPreviousBlock,
        currentBlocks: newBlock.getBlockchainHeaders(),
        block: triggerBlock,
        iterations: undefined,
        timeDiff: undefined
      }
    });

    if (this._unfinished.length > 240) {
      this._unfinished.shift();
    }

    this.setCurrentMiningHeaders(newBlock.getBlockchainHeaders());

    const update = {
      workId: workId,
      currentTimestamp,
      offset: ts.offset,
      work,
      minerKey: this._minerKey,
      merkleRoot: newBlock.getMerkleRoot(),
      newestChildBlock: triggerBlock,
      difficulty: newBlock.getDifficulty(),
      difficultyData: {
        currentTimestamp,
        lastPreviousBlock: lastPreviousBlock.serializeBinary(),
        // $FlowFixMe
        newBlockHeaders: newBlock.getBlockchainHeaders().serializeBinary()
      }
    };

    this._logger.info(`[] -> [] MINER colliding blocks: ${bestChain.length}, rover search requests: ${Object.keys(missingBlocks).length}`);

    //if (BC_MINER_MUTEX) {
    //  setTimeout(async () => {
    //    await this._persistence.put(`${BC_SUPER_COLLIDER}.miner.mutex`, 'open')
    //  }, 15000)
    //}

    //if (this._chainState) {
    //  debug(`setting chain state bc.work to ${workId}`)
    //  this._chainState._memory.put('bc.work', workId)
    //}
    //if (mbs.length > 0) {
    //  const s = shuffle(mbs).slice(0, 1)
    //  for (let rov of s) {
    //    const sr = missingBlocks[rov]
    //    this._logger.info(`requesting ${s} rover search for ${sr.lowest} -> ${sr.highest}`)
    //    this.pubsub.publish('rover.request', {
    //      type: 'rover.request',
    //      data: {
    //        rover: rov,
    //        highest: sr.highest,
    //        lowest: sr.lowest
    //      }
    //    })
    //  }
    //}

    if (BC_GRPC_MINER) {

      const minerRequest = new MinerRequest();
      minerRequest.setWorkId(workId);
      minerRequest.setCurrentTimestamp(currentTimestamp);
      minerRequest.setOffset(ts.offset || 1);
      minerRequest.setWork(work);
      minerRequest.setMinerKey(this._minerKey);
      minerRequest.setMerkleRoot(newBlock.getMerkleRoot());
      minerRequest.setDifficulty(newBlock.getDifficulty());
      minerRequest.setLastPreviousBlock(lastPreviousBlock);
      minerRequest.setNewBlockHeaders(newBlock.getBlockchainHeaders());

      this._logger.info(`[] -> [] OVERLINE MINER -> ${this._minerKey} with work id: ${workId}`);

      // const currentWork = await this.persistence.get(`${BC_SUPER_COLLIDER}.miner.work`)

      // if (currentWork) {
      //   this._logger.info(`waiting for work to return from miner for work id: ${workId}`)
      //   return
      // } else {
      // await this.persistence.put(`${BC_SUPER_COLLIDER}.miner.work`, workId)
      // }

      this._rpc.miner.mine(minerRequest, (err, response) => {

        this._minerBootLock = false;

        if (err || !response) {
          console.trace(err);
          this._logger.error('Native mining request failed', err);
          return;
        }

        if (response.getResult() === MinerResponseResult.CANCELED) {
          this._logger.info(`mining restarted for ${workId} because of new work`);
          return;
        }

        if (response.getResult() === MinerResponseResult.ERROR) {
          this._logger.info('mining restarted because of error');
          return;
        }

        const nonceHash = blake2bl(response.getNonce());
        const resultHash = blake2bl(minerRequest.getMinerKey() + minerRequest.getMerkleRoot() + nonceHash + response.getTimestamp());
        const resultDistance = distance(minerRequest.getWork(), resultHash);
        const distRpc = response.getDistance();
        response.setDistance(resultDistance.toString());

        this._logger.info(`response raw distance: ${distRpc}`);
        this._logger.info(`js recalc distance   : ${resultDistance}`);

        this._logger.info(`found work ${workId} from rust miner`);
        this._logger.info('response from rust miner', response.toObject());

        const transformed = _extends({}, response.toObject(), {
          workId
        });
        this._logger.info(`emit mined work id: ${workId}`);
        this._workerPool.emitter.emit('mined', transformed);
      });
    } else {
      debug(`MINING -> sending work ${workId} to thread manager`);
      await this._workerPool.updateWorkers({
        type: 'work',
        data: update,
        workId: workId,
        newestChildBlock: triggerBlock
      });
    }

    //if (mbs.length > 0) {
    //  let s = mbs

    //  //letif (mbs.indexOf('lsk') > -1) {
    //  //let  s = ['lsk']
    //  //let} else if (mbs.indexOf('neo') > -1) {
    //  //let  s = ['neo']
    //  //let} else if (mbs.indexOf('wav') > -1) {
    //  //let  s = ['wav']
    //  //let} else if (mbs.indexOf('eth') > -1) {
    //  //let  s = ['eth']
    //  //let} else if (mbs.indexOf('btc') > -1) {
    //  //let  s = ['btc']
    //  //let}

    //  for (let rov of s) {
    //    const sr = missingBlocks[rov]
    //    const highest = min(sr.highest, sr.lowest + 64)

    //    this._logger.info(`requesting ${s} rover search for ${sr.lowest} -> ${highest}`)
    //    this.pubsub.publish('rover.request', {
    //      type: 'rover.request',
    //      data: {
    //        rover: rov,
    //        highest: highest,
    //        lowest: sr.lowest
    //      }
    //    })
    //  }
    //}

    return Promise.resolve(true);
    //} catch (err) {
    //  this._logger.error(err)
    //  this._logger.warn(`Error while getting last previous BC block, reason: ${err.message}`)
    //  return Promise.reject(err)
    //}
  }

  /// **
  //* Manages the current most recent block template used by the miner
  //* @param blockTemplate
  //* /
  setCurrentMiningHeaders(blockTemplate) {
    if (this._blockTemplates.length > 0) {
      this._blockTemplates.pop();
    }
    this._blockTemplates.push(blockTemplate);
  }

  /**
   * Accessor for block templates
   */
  getCurrentMiningHeaders() {
    if (this._blockTemplates.length < 1) return;
    return this._blockTemplates[0];
  }

  stopMining(pool) {
    debug('stop mining');

    if (pool !== undefined) {
      pool.updateWorkers({ type: 'reset' });
    } else {
      this._workerPool.updateWorkers({ type: 'reset' });
    }
    return Promise.resolve(true);
  }

  /*
   * Alias for validation module
   */
  validateRoveredSequences(blocks) {
    return validateRoveredSequences(blocks);
  }

  /*
   * Restarts the miner by merging any unused rover blocks into a new block
   */
  async rebaseMiner() {
    try {
      const stopped = this.stopMining();
      this._logger.debug(`miner rebased, result: ${inspect(stopped)}`);
      const latestRoveredHeadersKeys = this._knownRovers.map(chain => `${chain}.block.latest`);
      this._logger.debug(latestRoveredHeadersKeys);
      const currentRoveredBlocks = await this.persistence.getBulk(latestRoveredHeadersKeys);
      const lastPreviousBlock = await this.persistence.get('bc.block.latest');
      const previousHeaders = lastPreviousBlock.getBlockchainHeaders();
      this._logger.debug(currentRoveredBlocks);
      if (lastPreviousBlock === null) {
        return Promise.resolve(false);
      }
      if (currentRoveredBlocks !== null && currentRoveredBlocks.length > 0) {
        const perc = currentRoveredBlocks.length / Object.keys(previousHeaders.toObject()).length * 100;
        this._logger.info('multiverse sync state: ' + perc + '%');
      }
      if (currentRoveredBlocks.length !== Object.keys(previousHeaders.toObject()).length) {
        return Promise.resolve(false);
      }
      const uniqueBlocks = getUniqueBlocks(previousHeaders, currentRoveredBlocks).sort((a, b) => {
        if (a.getHeight() > b.getHeight()) {
          return -1;
        }
        if (a.getHeight() < b.getHeight()) {
          return 1;
        }
        return 0;
      });

      this._logger.debug('stale branch blocks: ' + uniqueBlocks.length);

      if (uniqueBlocks.length < 1) {
        this._logger.info(uniqueBlocks.length + ' state changes ');
        return Promise.resolve(false);
      }
      return this.startMining(this._knownRovers, uniqueBlocks.shift());
    } catch (err) {
      return Promise.reject(err);
    }
  }

  restartMining() {
    debug('Restarting mining', this._knownRovers);
    return this.stopMining();
  }

  async _handleWorkerFinishedMessage(solution) {
    let unfinishedBlock = this._unfinishedBlock;
    let unfinishedBlockData = this._unfinishedBlockData;
    let workId = solution.workId;

    this._logger.info('loading work id ' + workId + ' from templated blocks ' + this._unfinished.length);
    // if (!unfinishedBlock || unfinishedBlock.workId !== workId) {

    const multichainLatest = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
    let foundBlock = false;
    if (workId !== undefined) {
      const candidates = this._unfinished.filter(b => {
        if (b.workId === workId) {
          return b;
        }
      });

      this._logger.info('loaded work id: ' + workId + ' candidates ' + candidates.length);
      if (candidates.length > 0) {

        for (const candidate of candidates) {
          if (foundBlock) {
            continue;
          }

          const { nonce, distance, timestamp, difficulty, iterations, timeDiff } = solution;
          const ub = candidate.unfinishedBlock;
          const chainWeight = ub.getDistance();
          const totalDistance = new BN(multichainLatest.getTotalDistance()).add(new BN(distance)).toString();

          ub.setNonce(nonce);
          ub.setDistance(distance);
          ub.setTotalDistance(totalDistance);
          ub.setTimestamp(timestamp);
          ub.setDifficulty(difficulty);

          if (isValidBlock(ub)) {
            foundBlock = ub;
            unfinishedBlockData = candidate.unfinishedBlockData;
            unfinishedBlock = foundBlock;
            break;
          }
        }

        if (foundBlock) {

          unfinishedBlock = foundBlock;

          const remainingUnfinished = this._unfinished.filter(b => {
            if (b && b.workId && b.unfinishedBlock && b.unfinishedBlock.getHeight) {
              if (b.workId !== b.workId && parseInt(b.unfinishedBlock.getHeight(), 10) < parseInt(unfinishedBlock.getHeight(), 10)) {
                return b;
              }
            }
          });

          if (remainingUnfinished && remainingUnfinished.length > 0) {
            this._unfinished = remainingUnfinished;
          } else {
            this._unfinished.length = 0;
            this._cleanUnfinishedBlock();
          }
        } else {
          this._logger.warn(`no valid candidates for solution provided`);
          //this._cleanUnfinishedBlock()
          return;
        }
      } else {
        this._logger.warn(`no candidates for solution provided`);
        //this._cleanUnfinishedBlock()
        return;
      }
    }

    let latestBlock = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
    const synced = await this._persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
    if (synced && synced === 'pending') {
      this._logger.info(`mining work pending sync status before processing ${workId}`);
      await this._persistence.processPeerExpiration();
      return;
    }

    this._logger.info(`loading work id ${workId} into frame ${unfinishedBlock.getHeight()} <- prev. hash  ${unfinishedBlock.getPreviousHash().slice(0, 20)} local: ${latestBlock.getHash().slice(0, 20)}`);

    if (latestBlock && latestBlock.getHash() !== foundBlock.getPreviousHash() && !BC_MINER_BOOT) {
      // LDL
      this._logger.info(`solution discovered is stale latest is ${latestBlock.getHeight()}:${latestBlock.getHash().slice(0, 10)}`);
      this._logger.info(`found block was ${foundBlock.getHeight()}:prev-${foundBlock.getPreviousHash().slice(0, 10)}`);
      this._cleanUnfinishedBlock();
      return;
    } else if (latestBlock && parseInt(latestBlock.getHeight(), 10) >= parseInt(foundBlock.getHeight(), 10) && !BC_MINER_BOOT) {
      this._logger.info(`solution discovered is stale latest is ${latestBlock.getHeight()}:${latestBlock.getHash().slice(0, 10)}`);
      this._logger.info(`found block was ${foundBlock.getHeight()}:prev-${foundBlock.getPreviousHash().slice(0, 10)}`);
      this._cleanUnfinishedBlock();

      if (latestBlock.getMiner() !== foundBlock.getMiner()) {
        this._emitter.emit('announceMinedBlock', { unfinishedBlock: false, solution: false });
      }
      return;
    } else if (BC_MINER_BOOT) {
      this._logger.info(`solution discovered latest is ${latestBlock.getHeight()}:${latestBlock.getHash().slice(0, 10)}`);
      await this.persistence.putLatestBlock(unfinishedBlock);
    }

    const { nonce, distance, timestamp, difficulty, iterations, timeDiff } = solution;

    this._logger.info(' ------ SUCCESSFUL COLLISION ------ ');
    this._logger.info(' nonce: ' + nonce);
    this._logger.info(' distance: ' + distance);
    this._logger.info(' timestamp: ' + timestamp);
    this._logger.info(' difficulty: ' + difficulty);
    this._logger.info(' shift: ' + timeDiff);
    this._logger.info(' work ID: ' + workId);

    const chainWeight = unfinishedBlock.getDistance();
    const totalDistance = new BN(latestBlock.getTotalDistance()).add(new BN(foundBlock.getDistance())).toString();
    unfinishedBlock.setNonce(nonce);
    unfinishedBlock.setDistance(distance);
    unfinishedBlock.setTotalDistance(totalDistance);
    unfinishedBlock.setTimestamp(timestamp);
    unfinishedBlock.setDifficulty(difficulty);
    this._logger.info(' chain weight: ' + chainWeight);
    this._logger.info(' total distance: ' + totalDistance);
    this._logger.info(' hash: ' + foundBlock.getHash().slice(0, 10));
    this._logger.info(' nonce: ' + foundBlock.getNonce());
    this._logger.info(' height: ' + foundBlock.getHeight());

    if (unfinishedBlockData) {
      unfinishedBlockData.iterations = iterations;
      unfinishedBlockData.timeDiff = timeDiff;
    }

    if (unfinishedBlock !== undefined && isDebugEnabled()) {
      this._writeMiningData(unfinishedBlock, solution);
    }

    if (BC_MINER_NO_BROADCAST) {
      this._logger.warn(`BC_MINER_NO_BROADCAST is enabled not storing block`);
      return;
    }

    this._cleanUnfinishedBlock();

    if (BC_MINER_BOOT) {
      const lat = await this.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
      if (lat && lat.getHeight() > unfinishedBlock.getHeight()) {
        this._logger.info(`block already stored at height - latest : ${lat.getHeight()}`);
        return;
      }
      this._logger.info(`${parseInt(unfinishedBlock.getHeight(), 10)} using BC_MINER_BOOT...`);
      await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(unfinishedBlock.getHeight(), 10));
      await this.persistence.put(`${BC_SUPER_COLLIDER}.block.${unfinishedBlock.getHash()}`, unfinishedBlock);
      await this.persistence.put(`${BC_SUPER_COLLIDER}.block.${unfinishedBlock.getHeight()}`, unfinishedBlock);
      await this.persistence.put(`${BC_SUPER_COLLIDER}.block.latest`, unfinishedBlock);

      this._emitter.emit('announceMinedBlock', { unfinishedBlock, solution });

      if (BC_MINER_MUTEX) {
        await this._persistence.put(`${BC_SUPER_COLLIDER}.miner.mutex`, 'open');
      }
      return;
    } else {
      this._logger.info(`miner storing block ${parseInt(unfinishedBlock.getHeight(), 10)}`);

      const synced = await this._persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
      const reorgBlock = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.reorgto`);
      if (reorgBlock && reorgBlock.getHeight && !BC_MINER_BOOT && parseInt(reorgBlock.getHeight(), 10) > parseInt(unfinishedBlock.getHeight(), 10) + 1) {
        if (synced === 'pending') {
          this._logger.info(`multiverse state is changing to new edge: ${reorgBlock.getHeight()}, setting sync status to 'pending'`);
          await this._persistence.processPeerExpiration();
          return;
        }
      }
      await this._persistence.saveBlock(unfinishedBlock);
      this.pubsub.publish('miner.block.new', { unfinishedBlock, solution });
      this._emitter.emit('announceMinedBlock', { unfinishedBlock, solution });
    }
  }

  _handleWorkerError(error) {
    this._logger.error(error);
    this._logger.warn(`mining worker process errored, reason: ${error.message}`);
    this._cleanUnfinishedBlock();

    // return this.stopMining()
  }

  _handleWorkerExit(code, signal) {
    // this.stopMining()
    this._logger.info('miner pending new work');

    if (code === 0 || code === null) {
      // 0 means worker exited on it's own correctly, null that is was terminated from engine
      this._logger.info(`mining worker finished its work (code: ${code})`);
    } else {
      this._logger.warn(`mining worker process exited with code ${code}, signal ${signal}`);
      this._cleanUnfinishedBlock();
    }
  }

  _cleanUnfinishedBlock() {
    debug('cleaning unfinished block');
    this._unfinishedBlock = undefined;
    this._unfinishedBlockData = undefined;
  }

  _writeMiningData(newBlock, solution) {
    // block_height, block_difficulty, block_distance, block_total_distance, block_timestamp, iterations_count, mining_duration_ms, btc_confirmation_count, btc_current_timestamp, eth_confirmation_count, eth_current_timestamp, lsk_confirmation_count, lsk_current_timestamp, neo_confirmation_count, neo_current_timestamp, wav_confirmation_count, wav_current_timestamp
    const row = [newBlock.getHeight(), newBlock.getDifficulty(), newBlock.getDistance(), newBlock.getTotalDistance(), newBlock.getTimestamp(), solution.iterations, solution.timeDiff];

    this._knownRovers.forEach(roverName => {
      if (this._unfinishedBlockData && this._unfinishedBlockData.currentBlocks) {
        const methodNameGet = `get${roverName[0].toUpperCase() + roverName.slice(1)}List`; // e.g. getBtcList
        // $FlowFixMe - flow does not now about methods of protobuf message instances
        const blocks = this._unfinishedBlockData.currentBlocks[methodNameGet]();
        row.push(blocks.map(block => block.getBlockchainConfirmationsInParentCount()).join('|'));
        row.push(blocks.map(block => block.getTimestamp() / 1000 << 0).join('|'));
      }
    });

    row.push(getBlockchainsBlocksCount(newBlock));
    const dataPath = ensureDebugPath(`bc/mining-data.csv`);
    writeFileSync(dataPath, `${row.join(',')}\r\n`, { encoding: 'utf8', flag: 'a' });
  }
}
exports.MiningOfficer = MiningOfficer;