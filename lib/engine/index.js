'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Engine = exports.BC_LOG_BLOCK_STATS = undefined;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _externals = require('ethereumjs-util/dist/externals');

/*
 * Copyright (c) 2017-present, Overline developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const { RoverMessage, RoverMessageType } = require('@overline/proto/proto/rover_pb');
const { machineId } = require('node-machine-id');

// $FlowFixMe: disable warnings from libraries
console.warn = () => {}; // eslint-disable-line no-console

const crypto = require('crypto');
const fetch = require('node-fetch');
const { spawn } = require('child_process');
const { Multiverse } = require('../bc/multiverse');
const { EventEmitter } = require('events');
const QueueEventEmitter = require('queue-event-emitter');
const { join, resolve } = require('path');
const { existsSync, writeFileSync } = require('fs');
const { queue } = require('async');

const io = require('@pm2/io');
const blocked = require('blocked');
const debug = require('debug')('bcnode:engine');
const debugUTXO = require('debug')('bcnode:utxoemitter');
const debugExtend = require('debug')('bcnode:engine:extend');
const debugReorg = require('debug')('bcnode:engine:reorg');
const { max, merge, uniq, values, last, min } = require('ramda');
const maxmind = require('maxmind');
const LRUCache = require('lru-cache');
//const BN = require('bn.js')
const semver = require('semver');
const fkill = require('fkill');
const fs = require('fs');

const { Server } = require('../server/index');
const { config } = require('../config');
const { ensureDebugPath, isDebugEnabled } = require('../debug');
const { getLogger } = require('../logger');
const { Monitor } = require('../monitor');
const { DISABLE_IPH_TEST, Node } = require('../p2p');
const { Overline } = require('../overline');
const { encodeTypeAndData } = require('../p2p/codec');
const { addressToHost, BC_MAX_DATA_RANGE } = require('../p2p/node');
const { MESSAGES } = require('../p2p/protocol');
const { RoverManager } = require('../rover/manager');
const { ROVER_SECONDS_PER_BLOCK, ROVER_RESYNC_PERIOD, ROVER_CONFIRMATIONS, shuffle } = require('../rover/utils');
const { LSK_MAX_FETCH_BLOCKS } = require('../rover/lsk/controller');
const { ETH_MAX_FETCH_BLOCKS } = require('../rover/eth/network');
const { BC_SUPER_COLLIDER, ChainState } = require('../bc/chainstate');
const rovers = require('../rover/manager').rovers;
const PersistenceRocksDb = require('../persistence').RocksDb;
const { UtxoManager } = require('../bc/utxoManager');
const { PubSub } = require('./pubsub');
const { RpcServer } = require('../rpc/index');
const { getGenesisBlock } = require('../bc/genesis');
const { getBootBlock } = require('../bc/bootblock');
const { validateSequenceDifficulty, updateUTXO, VALIDATION_GAP_BC_HEIGHT_INTERVAL } = require('../bc/validation');
const { Block, BcBlock, Transaction } = require('@overline/proto/proto/core_pb');
const { RpcTransactionResponseStatus } = require('@overline/proto/proto/bc_pb');
const { errToString } = require('../helper/error');
const { getVersion } = require('../helper/version');
const { MiningOfficer, BC_NETWORK_AGING_RATE } = require('../mining/officer');
const { WorkerPool } = require('../mining/pool');
const ts = require('../utils/time').default; // ES6 default export
const { sortBlocks } = require('../utils/protoBuffers');
const { indexChatDb } = require('../utils/chat');
const { parseBoolean } = require('../utils/config');
const { getMaxDistanceWithEmblems, BC_COINBASE_MATURITY } = require('../core/txUtils');
const { TxHandler } = require('../primitives/txHandler');
const { FeedHandler } = require('../primitives/feedHandler');
const { EvmHandler } = require('../primitives/evmHandler');
const { default: TxPendingPool } = require('../bc/txPendingPool');
const { Wallet } = require('../bc/wallet');
const { Dex } = require('../bc/dex');

let numCPUs = max(1, Number(require('os').cpus().length) - 1);

const GEO_DB_PATH_A = resolve(__dirname, '..', '..', 'data', 'GeoLite2-City.mmdb');
// const PKG = require('../../package.json')
const BC_ORTHOGONAL_WAYPOINTS = process.env.BC_ORTHOGONAL_WAYPOINTS !== 'false' ? process.env.BC_ORTHOGONAL_WAYPOINTS : false;
const REMOVE_UTXOS_FROM = process.env.REMOVE_UTXOS_FROM;
const BC_MINER_MUTEX = parseBoolean(process.env.BC_MINER_MUTEX); // open up cpu resources for AMD miner
const BC_APE_CHAT_DB = parseBoolean(process.env.BC_APE_CHAT_DB); // initialize the database with NFT ownerhip
const BC_MINER_BOOT = parseBoolean(process.env.BC_MINER_BOOT); // initialize new super collider
const BC_WISE_LINE = parseBoolean(process.env.BC_WISE_LINE); // trust rovers over child chain mainnet
const BC_PRUNE_MULTICHAIN = parseBoolean(process.env.BC_PRUNE_MULTICHAIN); // used during development to descrease size of Super Colliders
const BC_SAVE_TXS = parseBoolean(process.env.BC_SAVE_TXS); // used during development to descrease size of Super Colliders
const BC_RELAY_MODE = parseBoolean(process.env.BC_RELAY_MODE); // used during development to descrease size of Super Colliders
const BC_MULTICHAIN_EDGE = process.env.BC_MULTICHAIN_EDGE !== undefined ? parseInt(process.env.BC_MULTICHAIN_EDGE) : false;
const BC_NETWORK = process.env.BC_NETWORK || 'main';
const dataDirSuffix = BC_NETWORK === 'main' ? '' : `_${BC_NETWORK}net`;
const DATA_DIR = `${process.env.BC_DATA_DIR || config.persistence.path}${dataDirSuffix}`;
const MONITOR_ENABLED = process.env.BC_MONITOR === 'true';
const BC_CHECK = process.env.BC_CHECK === 'true';
const BC_LOW_POWER_MODE = process.env.BC_LOW_POWER_MODE === 'true';
const BC_CALCULATE_NRG_SUPPLY = process.env.BC_CALCULATE_NRG_SUPPLY === 'true';
const BC_STOP_TRACKING = process.env.BC_STOP_TRACKING === 'true';
const BC_ONLY_TRACK = process.env.BC_ONLY_TRACK ? process.env.BC_ONLY_TRACK : null;
const BC_BUILD_GENESIS = process.env.BC_BUILD_GENESIS === 'true';
const BC_MINER_POOL = process.env.BC_MINER_POOL && process.env.BC_MINER_POOL.indexOf('.') > -1 ? process.env.BC_MINER_POOL : false;
const PERSIST_ROVER_DATA = process.env.PERSIST_ROVER_DATA === 'true';
const CHAINSTATE_DIR = process.env.BC_CHAINSTATE_DIR ? process.env.BC_CHAINSTATE_DIR : DATA_DIR;
const BC_REMOVE_BTC = parseBoolean(process.env.BC_REMOVE_BTC);
const BC_PM2 = parseBoolean(process.env.BC_PM2);
const BC_FETCH_MISSING_BLOCKS = !!process.env.BC_FETCH_MISSING_BLOCKS;
const BC_RUST_MINER = !!process.env.BC_RUST_MINER;
const BC_PREVENT_INITIAL_SYNC = parseBoolean(process.env.BC_PREVENT_INITIAL_SYNC);
const BC_MINER_WORKERS = process.env.BC_MINER_WORKERS !== undefined ? parseInt(process.env.BC_MINER_WORKERS) : numCPUs;
const BC_LOG_BLOCK_STATS = exports.BC_LOG_BLOCK_STATS = process.env.BC_LOG_BLOCK_STATS === 'true';
const OL_FAST_SYNC = process.env.OL_FAST_SYNC ? parseBoolean(process.env.OL_FAST_SYNC) : false;
const BC_FORCE_ROVERS = process.env.BC_FORCE_ROVERS ? process.env.BC_FORCE_ROVERS.split(',').map(a => a.toLowerCase().trim().replace(';', '')) : [];
const BC_RUST_CLI_PATH = isDebugEnabled() ? resolve(__dirname, '..', '..', 'rust', 'bcrust-core', 'target', 'release', 'bcrust-miner') : resolve(__dirname, '..', '..', 'rust', 'bcrust-core', 'target', 'debug', 'bcrust-miner');
const BTC_BOOT_BLOCK = process.env.BTC_BOOT_BLOCK;
const LOAD_LAST_UTXO = process.env.LOAD_LAST_UTXO ? parseBoolean(process.env.LOAD_LAST_UTXO) : false;
const BC_REINDEX_TXS = process.env.BC_REINDEX_TXS ? parseBoolean(process.env.BC_REINDEX_TXS) : false;
const CLEAN_UP_UTXOS = process.env.CLEAN_UP_UTXOS ? parseBoolean(process.env.CLEAN_UP_UTXOS) : false;
const THROTTLE = {};
const BC_NO_ROVERS = parseBoolean(process.env.BC_NO_ROVERS);
let blockStatStream = false;

const chainToGet = chain => `get${chain[0].toUpperCase() + chain.slice(1)}List`;
const rebaseWorkers = () => {
  try {
    // LDL
    debug(`rebase workers event fired on process: ${process.pid}`);
    //Promise.all([
    //  fkill('bcworker1', {force: true, silent: true}),
    //  fkill('bcworker2', {force: true, silent: true}),
    //  fkill('bcworker3', {force: true, silent: true}),
    //  fkill('bcworker4', {force: true, silent: true})
    //]).then(() => {
    //  debug(`bcworkers exited`)
    //}).catch((e) => {
    //  debug(e)
    //})
  } catch (_) {}
};

const rebasePool = () => {
  try {
    fkill('bcpool', { force: true, silent: true }).then(() => {
      debug(`pool exited`);
    }).catch(err => {
      debug(err);
    });
  } catch (err) {
    console.trace(err);
  }
};

const getLeaseBalances = async type => {
  return new Promise((resolve, reject) => {
    const urla = `https://d2hxcwrpmn9jbk.cloudfront.net/db_prelease.json`;
    const urlb = `https://d2hxcwrpmn9jbk.cloudfront.net/db_lease.json`;
    const url = type === 'a' ? urla : urlb;
    fetch(urla, { method: "get", headers: { "Content-Type": "application/json" } }).then(response => {
      response.json().then(data => {
        if (data) {
          resolve(data);
        }
      });
    }).catch(err => {
      reject(err);
    });
  });
};

class Engine {

  constructor(opts) {

    if (OL_FAST_SYNC) console.log('fast sync enabled');

    if (BC_LOG_BLOCK_STATS) {
      const statFilePath = process.cwd() + '/block_stats.csv';
      blockStatStream = fs.createWriteStream(statFilePath);
      blockStatStream.write(`timestamp,blockTimestamp,height,hash,distance,difficulty,totalDistance,miner,minerReward,txs,nrgMined,newBlocks,reportedBlockTimeVsReceived,mineUnique,logType,waypoint\n`);
      this._blockStats = blockStatStream;
      console.log(`block stat stream file path: ${statFilePath}`);
    }

    this._blockQueue = queue((task, callback) => {
      let triggered = false;
      const t = setTimeout(() => {
        triggered = true;
        callback(null, false);
      }, 9000);
      this.blockFromRover(task).then(b => {
        if (!triggered) {
          clearTimeout(t);
          callback(null, b);
        }
      });
    }, 2);

    this._blockQueue.error(err => {
      console.trace(err);
    });

    const globalVariablesLog = Object.keys(process.env).reduce((all, key) => {
      if (key.slice(0, 3) === 'BC_') {
        all = `${all}\n${key}: ${process.env[key]}`;
      }
      return all;
    }, 'BC GLOBAL CONFIGRUATION');

    this._metrics = {
      rovers: {}
    };

    this.evalBlocks = [];
    this.indexBlocks = [];
    this.multiverseEvalBlocks = [];
    this.multiverseIndexBlocks = [];
    this._pm2 = BC_PM2 ? {} : false;
    this._lastCollectedBlock = {};
    this._startTime = Math.floor(Date.now() / 1000);
    this._loggedBcBlocks = [];
    this._loggedBcBalances = { lastMiner: false };
    this._emblemPerformance = 0;
    this._emblemFixedCount = 0;
    this._lastOlBlock = false;
    this._lastOlBlockTime = false;
    this._lastMinedBlock = false;
    this._logger = getLogger(__filename);
    this._knownRovers = opts.rovers;
    this._minerKey = opts.minerKey;
    this._rawBlock = [];
    this._blockCache = [];
    this._roveredBlocksToProcess = [];
    this._monitor = new Monitor(this, {});
    this._relayMode = BC_RELAY_MODE || opts.relayMode;

    const p = new PersistenceRocksDb(DATA_DIR);
    const cs = new ChainState(CHAINSTATE_DIR, opts.rovers, { writable: true, persistence: p });
    const utxoManager = new UtxoManager(p);

    this._persistence = p;
    this._chainState = cs;
    this._utxoManager = utxoManager;
    this._pubsub = new PubSub();
    this._txPendingPool = new TxPendingPool(this._persistence, this._utxoManager);
    this._node = new Node(this);

    this._emitter = new EventEmitter();
    this._utxoEventEmitter = new EventEmitter();
    this._miningEmitter = new EventEmitter();
    this._roverEmitter = new EventEmitter();
    this._asyncEmitter = new EventEmitter();

    this._rovers = new RoverManager(this._persistence, this._emitter, this._roverEmitter);
    this._rpc = new RpcServer(this);
    this._server = new Server(this, this._rpc);
    this._subscribers = {};
    this._verses = [];
    this._trackAddresses = !BC_STOP_TRACKING;
    this._onlyTrack = BC_ONLY_TRACK;
    this._stepSyncTimestamps = [];
    this._isOpen = false;
    this._latestGpuMinerUpdate = 0;
    this._latestGpuMinerUpdateCount = 0;
    // release max
    this._emitter.setMaxListeners(0);
    this._utxoEventEmitter.setMaxListeners(0);
    this._roverEmitter.setMaxListeners(0);
    this._asyncEmitter.setMaxListeners(0);

    this._utxoEventEmitter.on('newListener', utxo => {
      this._utxoManager.utxoListeners++;
    });

    this._utxoEventEmitter.on('removeListener', utxo => {
      this._utxoManager.utxoListeners--;
    });

    // Open Maxmind Geo DB
    this._geoDb = maxmind.openSync(GEO_DB_PATH_A);
    this._geoDbValidate = maxmind.validate;

    this._knownEvaluationsCache = new LRUCache({
      max: config.engine.knownBlocksCache.max
    });

    this._knownBlocksCache = new LRUCache({
      max: config.engine.knownBlocksCache.max
    });

    this._knownFullBlocksCache = new LRUCache({
      max: config.engine.knownFullBlocksCache.max
    });

    this._rawBlocks = new LRUCache({
      max: config.engine.rawBlocksCache.max
    });

    this._peerRequestCache = new LRUCache({
      max: 50
    });

    this._peerIsSyncing = false;
    this._peerIsResyncing = false;
    this._txHandler = new TxHandler(this._persistence, this._txPendingPool, this._utxoManager);
    this._wallet = new Wallet(this._persistence, this._txPendingPool, this._utxoManager);
    this._feedHandler = new FeedHandler(this._persistence, this._txPendingPool, this._utxoManager, this._wallet, this._pubsub);
    this._evmHandler = new EvmHandler(this._persistence, this._txPendingPool, this._utxoManager, this._wallet, this._pubsub);
    this._dex = new Dex(this._persistence, this._utxoManager);
    this._disableEmblemCheck = false;
    this._roverTimeTable = {};

    this._seenTxsCache = new LRUCache({
      max: 1000
    });

    // prints log with state of tx pending pool
    setInterval(() => {
      if (this._txPendingPool) {
        try {
          const rep = this._txPendingPool.getSummary();
          this._logger.info(`tx pool online ${rep.secondsElapsedSinceStart}s using ${rep.dataSize} pending waypoints ${rep.pendingWaypoints} and ${Object.keys(THROTTLE).length} pending rovered blocks, gpu updated: ${this._latestGpuMinerUpdateCount} (${this._latestGpuMinerUpdate}) utxo listeners: ${this._utxoManager.utxoListeners}, (${this._utxoEventEmitter._eventsCount})`);
        } catch (err) {
          this._logger.debug(err);
        }
      }
      //}, 136000)
    }, 36000);

    setInterval(async () => {
      const exp = await this._persistence.processPeerExpiration({ chainState: this._chainState });
      if (exp && exp === 1) {
        this._logger.info(`waypoint expiration detected`);
        if (this.node && this.node._PEER_BLACKLIST) {
          this.node._PEER_BLACKLIST.length = 0;
          this.node._PEER_QUARANTINE.length = 0;
        }
      }

      const synced = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
      const waypoint = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);

      if (synced && synced === 'pending' && !waypoint) {
        this._logger.info(`updating sync status to complete without waypoints`);
        await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'complete');
      }

      const currentHeight = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.latest.height`);
      const cb = await this._persistence.get(`lease.db.update`);
      if (!cb && currentHeight && new _externals.BN(currentHeight).gt(new _externals.BN(6710606)) && new _externals.BN(currentHeight).lt(new _externals.BN(6711006))) {
        const balances = await getLeaseBalances('b');
        this._logger.info(`index window loaded ${Object.keys(balances).length}`);
        await this._persistence.putLeaseDb(balances, 'update');
      }
    }, 28000);

    setInterval(async () => {
      const req = await this._persistence.get(`eth.markedtx.queue`);
      if (req) {
        this._logger.info(`${req.getMarkedTransactionsList().length} queued transactions : ${req.getBlockHash()}`);
      } else {
        this._logger.info(`0 queued transactions`);
      }
    }, 310000);

    // Start NTP sync
    ts.start();
  }

  /**
   * Get node
   * @return {Node}
   */
  get node() {
    return this._node;
  }

  /**
   * Get persistence
   * @return {Persistence}
   */
  get persistence() {
    return this._persistence;
  }

  /**
   * Get pubsub wrapper instance
   * @returns {PubSub}
   */
  get pubsub() {
    return this._pubsub;
  }

  /**
   * Get rovers manager
   * @returns RoverManager
   */
  get rovers() {
    return this._rovers;
  }

  /**
   * Get instance of RpcServer
   * @returns RpcServer
   */
  get rpc() {
    return this._rpc;
  }

  /**
   * Get instance of Server (Express on steroids)
   * @returns Server
   */
  get server() {
    return this._server;
  }

  // TODO only needed because of server touches that - should be passed using constructor?

  // TODO only needed because of server touches that - should be passed using constructor?
  get minerKey() {
    return this._minerKey;
  }

  /**
   * Get rawBlock
   * @return {Object}
   */
  get rawBlock() {
    return this._rawBlock;
  }

  /**
   * Set rawBlock
   * @param block
   */
  set rawBlock(block) {
    this._rawBlock = block;
  }

  get miningOfficer() {
    return this._miningOfficer;
  }

  get geoDb() {
    return this._geoDb;
  }

  get geoDbValidate() {
    return this._geoDbValidate;
  }

  /**
   * Get WorkerPool
   * @returns {WorkerPool|*}
   */
  get workerPool() {
    return this._workerPool;
  }

  get wallet() {
    return this._wallet;
  }

  get chainState() {
    return this._chainState;
  }

  /**
   * Get multiverse
   * @returns {Multiverse|*}
   */
  get multiverse() {
    return this.node.multiverse;
  }

  set multiverse(multiverse) {
    this.node.multiverse = multiverse;
  }

  /**
   * Get UTXO manager
   * @return {UtxoManager}
   */
  get utxoManager() {
    return this._utxoManager;
  }

  initRustMiner() {
    this._logger.info('Starting rust miner', BC_RUST_CLI_PATH);
    const env = isDebugEnabled() ? { RUST_BACKTRACE: 'full' } : {};
    if (existsSync(BC_RUST_CLI_PATH)) {
      const proc = spawn(BC_RUST_CLI_PATH, [], { env: merge(process.env, env) });
      proc.stdout.on('data', data => {
        this._logger.info(`bcrust-miner: ${data}`);
      });
      proc.stderr.on('data', data => {
        this._logger.info(`bcrust-miner: ${data}`);
      });
      proc.on('close', code => {
        this._logger.info(`bcrust-miner: process exited with code ${code}`);
        this.initRustMiner();
      });
    } else {
      this._logger.error("bcrust-miner: rust miner binary doesn't exist");
    }
  }

  /**
   * Initialize engine internals
   *
   * - Open database
   * - Store name of available rovers
   */
  async init(dbPath = DATA_DIR) {
    rebaseWorkers();
    rebasePool();

    if (false || BC_RUST_MINER) {
      this.initRustMiner();
    }

    const roverNames = Object.keys(rovers);
    const {
      npm,
      git: {
        long
      }
    } = getVersion();
    const newGenesisBlock = getGenesisBlock();
    const versionData = {
      version: npm,
      commit: long,
      db_version: 1
    };

    const DB_LOCATION = resolve(`${__dirname}/../../${dbPath}`);
    const DELETE_MESSAGE = `DB data structure is stale, delete data folder '${DB_LOCATION}' and run bcnode again`;
    // TODO get from CLI / config
    try {

      await this._persistence.open();

      if (BC_REINDEX_TXS) {
        const latest = await this.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
        if (latest) {
          this._logger.info(`latest block found ${latest.getHeight()} : ${latest.getHash()}`);
          this._logger.info(`running large tx reindex...`);
          await this.persistence.saveTxs(7000000, latest);
          this._logger.info(`save index complete <- shutting down...`);
          process.exit();
        }
      }
      // initialize the EVM
      await this._evmHandler.init();

      let version = await this.persistence.get('appversion');
      await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'pending');
      await this.persistence.del(`${BC_SUPER_COLLIDER}.pruned`);
      // silently continue if version === null - the version is not present so
      // a) very old db
      // b) user just remove database so let's store it
      if (version && semver.lt(version.version, '0.7.7')) {
        // GENESIS BLOCK 0.9
        this._logger.warn(DELETE_MESSAGE);
        process.exit(8);
      }
      let res = await this.persistence.put('rovers', roverNames);
      if (res) {
        this._logger.debug('stored rovers to persistence');
      }
      res = await this.persistence.put('appversion', versionData);
      if (res) {
        this._logger.debug('stored appversion to persistence');
      }

      if (BC_APE_CHAT_DB) {
        this._logger.info(`BC_APE_CHAT_DB enabled...`);
        await indexChatDb(this.persistence, this._knownRovers);
      }

      const now = Math.floor(Date.now() * 0.001);
      await this.persistence.put('minelock', now);

      if (BC_REMOVE_BTC === true) {
        this._logger.warn('REMOVE BTC BLOCK LATEST FLAG TRIGGERED');
        try {
          // remove btc block
          await this.persistence.del(`btc.block.latest`);
        } catch (err) {
          this._logger.debug(err);
        }
      }

      if (this._relayMode) {
        this._logger.info('Starting in relay mode');
      }

      if (REMOVE_UTXOS_FROM) {
        await this._utxoManager.removeUTXOsFrom(parseInt(REMOVE_UTXOS_FROM));
      }
      // TD why does not not run on every start
      // Does this remove utxos
      //if (CLEAN_UP_UTXOS) {
      // await this._utxoManager.viewUTXOs()
      await this._utxoManager.cleanUpUTXOs();
      //}
      if (BC_SAVE_TXS) {
        await this.persistence.saveTxs();
      }
      if (BC_CALCULATE_NRG_SUPPLY) {
        await this._utxoManager.calculateNRGSupply();
      }

      let latestBlock = await this.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
      let highestKnownHeight = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);

      if (latestBlock) {
        this._logger.info(`setting latest edge ${highestKnownHeight} to latest block height: ${latestBlock.getHeight()}`);
        await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, latestBlock.getHeight());
      }

      if (LOAD_LAST_UTXO) {
        let lastutxo = await this.persistence.get(`bc.block.last.utxoSaved`);
        if (lastutxo) {
          latestBlock = lastutxo;
          await this.persistence.put(`bc.range.lowest.height`, latestBlock.getHeight());
        }
      }

      if (latestBlock) {
        await this.persistence.putLatestBlock(latestBlock, BC_SUPER_COLLIDER, { iterateUp: true });
        latestBlock = await this.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
      }

      let latestDataStr = await this.persistence.get(`${BC_SUPER_COLLIDER}.data.latest`);

      await this.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      await this.persistence.del(`${BC_SUPER_COLLIDER}.block.reorgto`);
      await this.persistence.del(`${BC_SUPER_COLLIDER}.block.reorgfrom`);

      if (latestDataStr) {
        await this.persistence.put(`${BC_SUPER_COLLIDER}.range.lowest.height`, latestDataStr.split(":")[0]);
        await this.persistence.del(`${BC_SUPER_COLLIDER}.range.lowest.hash`);
      } else {
        await this.persistence.del(`${BC_SUPER_COLLIDER}.range.lowest.height`);
        await this.persistence.del(`${BC_SUPER_COLLIDER}.range.lowest.hash`);
      }

      if (latestBlock && BC_FORCE_ROVERS && BC_FORCE_ROVERS.length > 0) {
        const headersMap = latestBlock.getBlockchainHeaders();
        const headers = Object.keys(headersMap.toObject()).reduce((all, listName) => {
          const getMethodName = `get${listName[0].toUpperCase()}${listName.slice(1)}`;
          const chainHeaders = headersMap[getMethodName]();
          return all.concat(sortBlocks(chainHeaders));
        }, []);
        const putLatestHeadersOpts = {
          asBuffer: true,
          saveHeaders: false
          //iterateUp: opts.iterateUp
        };
        await Promise.all(headers.map(header => this.persistence.putLatestBlock(header, header.getBlockchain(), putLatestHeadersOpts))); // put child blocks
      }

      for (let key of this._knownRovers) {
        if (BC_FORCE_ROVERS && BC_FORCE_ROVERS.length > 0 && BC_FORCE_ROVERS.indexOf(key) < 0) {
          this._logger.info(`instructing ${key} rover to find latest edge`);
          //if (key !== 'btc' && key !== 'neo' && key !== 'lsk') {
          if (key !== 'btc') {
            await this.persistence.del(`${key}.query`); // remove any pending query flags
            await this.persistence.del(`${key}.block.latest`); // remove any pending latest blocks
          }
        } else if (BC_SUPER_COLLIDER !== key) {
          const r = await this.persistence.get(`${key}.block.latest`); // latest rover block
          if (r && latestBlock) {
            this._logger.info(`starting ${key} rover at edge: ${r.getHeight()} ${r.getHash()}`);
          } else {
            this._logger.info(`restarting ${key} rover at local latest edge`);
            if (key !== 'btc') {
              await this.persistence.del(`${key}.block.latest`);
            }
          }
          await this.persistence.del(`${key}.range.lowest.height`);
          await this.persistence.del(`${key}.range.lowest.hash`);
          await this.persistence.del(`${key}.range.highest.height`);
          await this.persistence.del(`${key}.range.highest.hash`);
        }
      }

      this._logger.info(`latestBlock: ${latestBlock ? latestBlock.getHeight() : "NA"}, latestDataStr: ${latestDataStr}, cond: ${!latestBlock && !latestDataStr}`);
      if (!latestBlock && !latestDataStr || BC_BUILD_GENESIS) {

        if (!latestDataStr) {
          latestDataStr = "1:1";
        }

        if (BC_BUILD_GENESIS) {
          this._logger.info(`BC_BUILD_GENESIS === true -> building new database`);
          if (BC_SUPER_COLLIDER === 'bc') {
            this._logger.info(`Multichain 'bc' is already built, manually remove this from src/engine to run with BC_BUILD_GENESIS === true`);
            process.exit();
          }
        } else {
          this._logger.info(`latest block not found <- building new database`);
        }
        try {
          // reset event loop
          await this.persistence.put(`_`, `${1}`);
          await this.persistence.put('synclock', newGenesisBlock);
          await this.persistence.putBlock(newGenesisBlock);

          if (this._chainState) {
            await this._chainState.putLatestBlock(BC_SUPER_COLLIDER, 1, newGenesisBlock.getHash());
            await this._chainState._persistence.put(`${BC_SUPER_COLLIDER}.range.highest.height`, 1);
            await this._chainState._persistence.put(`${BC_SUPER_COLLIDER}.range.lowest.height`, 1);
            await this._chainState._persistence.put(`${BC_SUPER_COLLIDER}.range.highest.hash`, newGenesisBlock.getHash());
            await this._chainState._persistence.put(`${BC_SUPER_COLLIDER}.range.lowest.hash`, newGenesisBlock.getHash());
          }
          await this.persistence.del(`${BC_SUPER_COLLIDER}.miner.radians`);
          await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'pending');
          await this.persistence.put(`${BC_SUPER_COLLIDER}.block.latest`, newGenesisBlock);
          await this.persistence.put(`${BC_SUPER_COLLIDER}.block.parent`, newGenesisBlock);
          await this.persistence.put(`${BC_SUPER_COLLIDER}.block.oldest`, newGenesisBlock);
          await this.persistence.put(`${BC_SUPER_COLLIDER}.block.checkpoint`, newGenesisBlock);
          await this.persistence.put(`${BC_SUPER_COLLIDER}.dht.quorum`, 0);
          await this.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
          await this.persistence.put(`${BC_SUPER_COLLIDER}.depth`, 2);
          this._logger.info(``);
          this._logger.info(``);
          this._logger.info(`     OVERLINE BC PROTOCOL ${npm} (${new Date().toString()})`);
          this._logger.info('     GENESIS HASH: ' + newGenesisBlock.getHash());
          this._logger.info('     SUPER COLLIDER CTX: ' + BC_SUPER_COLLIDER);
          this._logger.info('     DATA: ' + latestDataStr);
          this._logger.info('     MINELOCK: ' + now);
          this._logger.info('     ENGINE CACHE: ' + config.engine.knownBlocksCache.max);
          this._logger.info('     ROVERS REPORTING: ' + Object.keys(this._knownRovers).length);
          this._logger.info('     NETWORK AGING RATE: ' + BC_NETWORK_AGING_RATE);
          this._logger.info('     BLOCKCHAIN FINGERPRINT: ' + config.blockchainFingerprintsHash);
          this._logger.info(``);
          this._logger.info(``);
          await updateUTXO(newGenesisBlock, this.persistence, this._txHandler, this._txPendingPool, this._utxoManager, 'engine');
        } catch (e) {
          console.trace(e);
          this._logger.error(`error while creating genesis block ${e.message}`);
          process.exit(1);
        }
      } else {

        if (!latestDataStr) {
          latestDataStr = "1:1";
        }
        // if chainstate is available minimally ensure latest block is in line with persistence
        if (this._chainState) {
          const hasLatestBlock = await this._chainState._persistence.get(`${BC_SUPER_COLLIDER}.block.latest.height`);
          if (!hasLatestBlock) {
            await this._chainState.putLatestBlock(BC_SUPER_COLLIDER, parseInt(latestBlock.getHeight(), 10), latestBlock.getHash());
          }
        }
        // reset event loop
        await this.persistence.put(`_`, `${1}`);
        await this.persistence.del(`${BC_SUPER_COLLIDER}.miner.radians`);
        await this.persistence.put('synclock', newGenesisBlock);
        await this.persistence.put(`${BC_SUPER_COLLIDER}.block.oldest`, newGenesisBlock);
        await this.persistence.put(`${BC_SUPER_COLLIDER}.block.parent`, newGenesisBlock);
        await this.persistence.put(`${BC_SUPER_COLLIDER}.dht.quorum`, 0);
        let sumSoFar = await this.persistence.getNrgMintedSoFar();
        this._logger.info(``);
        this._logger.info(``);
        this._logger.info(`     OVERLINE BC PROTOCOL ${npm} (${new Date().toString()})`);
        this._logger.info(`     GENESIS BLOCK: ${newGenesisBlock.getHeight()} : ${newGenesisBlock.getHash()}`);
        this._logger.info(`     LATEST BLOCK: ${latestBlock.getHeight()} : ${latestBlock.getHash()}`);
        this._logger.info(`     LATEST BLOCK DIFFICULTY: ${latestBlock.getDifficulty()}`);
        this._logger.info(`     COLLATERAL MINED: ${sumSoFar}`);
        this._logger.info(`     SUPER COLLIDER CTX: ${BC_SUPER_COLLIDER}`);
        this._logger.info('     DATA: ' + latestDataStr);
        this._logger.info(`     MINELOCK: ${now}`);
        this._logger.info(`     ENGINE CACHE: ${config.engine.knownBlocksCache.max}`);
        this._logger.info('     ROVERS REPORTING: ' + Object.keys(this._knownRovers).length);
        this._logger.info('     NETWORK AGING RATE: ' + BC_NETWORK_AGING_RATE);
        this._logger.info(`     BLOCKCHAIN FINGERPRINT: ${config.blockchainFingerprintsHash}`);
        this._logger.info(``);
        this._logger.info(``);
      }

      if (process.env.BC_BOOT_BLOCK) {
        const bootBlock = getBootBlock(process.env.BC_BOOT_BLOCK);
        await this.persistence.put(`${BC_SUPER_COLLIDER}.block.latest`, bootBlock);
        await this.persistence.putBlock(bootBlock);
        await this.multiverse._chain.unshift(bootBlock);
        this._logger.warn('boot block ' + bootBlock.getHeight() + ' assigned as latest block');
      }
    } catch (e) {
      console.trace(e);
      this._logger.warn(`could not store rovers to persistence, reason ${e.message}`);
    }

    if (BC_CHECK === true) {
      await this.integrityCheck();
    }

    if (MONITOR_ENABLED) {
      this._monitor.start();
    }

    this.pubsub.subscribe('update.block.latest', '<engine>', msg => {
      try {
        if (!this._knownEvaluationsCache.has(msg.data.getHash())) {
          this._knownEvaluationsCache.set(msg.data.getHash(), true);
          this.updateLatestAndStore(msg).then(previousBlock => {
            if (msg.mined === true) {
              this._logger.debug(`latest block ${msg.data.getHeight()} has been updated`);
            } else {
              this._blockCache.length = 0;
            }
          }).catch(err => {
            //this._logger.info(errToString(err))
            console.trace(err);
            this._logger.error(`error occurred during updateLatestAndStore(), reason: ${err.message}`);
            process.exit();
          });
        }
      } catch (err) {
        this._logger.error(err);
      }
    });

    // GENERATE BLOCKS - BEGIN

    this._workerPool = new WorkerPool(this._persistence, {
      minerKey: this._minerKey,
      emitter: this._asyncEmitter,
      relayMode: this._relayMode
    });

    const miningOfficerOpts = {
      minerKey: this._minerKey,
      rovers: this._knownRovers,
      emblemPerformance: this._emblemPerformance,
      txHandler: this._txHandler,
      relayMode: this._relayMode,
      roverEmitter: this._roverEmitter
    };

    this._miningOfficer = new MiningOfficer(this._pubsub, this._persistence, this._workerPool, this._txPendingPool, this._chainState, this._miningEmitter, miningOfficerOpts);

    for (let rover of this._miningOfficer._knownRovers) {
      if (BC_FORCE_ROVERS && BC_FORCE_ROVERS.indexOf(rover) > -1) {
        this._logger.warn(`BC FORCE ROVERS: ${rover} is set moving resync period to complete`);
        this._miningOfficer._collectedBlocks[rover] = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[rover]) + 100;
      }
    }

    this._asyncEmitter.on('mined', data => {
      this._latestGpuMinerUpdate = Date.now() * 0.001 << 0;
      this._latestGpuMinerUpdateCount++;
      this.miningOfficer._handleWorkerFinishedMessage(data);
    });

    this._workerPool.emitter.on('blockCacheRebase', () => {
      this._logger.info('block cache rebase requested');
      this.persistence.get('bc.block.latest').then(async previousBlock => {
        if (this._blockCache.length > 0 && previousBlock) {
          const candidates = this._blockCache.reduce((all, block) => {
            const blockchains = previousBlock.getBlockchainHeaders().toObject();
            const key = block.getBlockchain() + 'List';
            const headers = blockchains[key];
            const found = headers.reduce((f, header) => {
              if (all === false) {
                if (block.getHeight() > header.getHeight()) {
                  f = true;
                }
              }
              return f;
            }, false);

            if (found === true) {
              all.push(block);
            }
            return all;
          }, []);
          this._blockCache.length = 0;
          if (candidates.length > 0) {
            this._blockCache = candidates;
            const allRoversHaveSufficientBlocks = this._miningOfficer._knownRovers.reduce((state, chain) => {
              if (state) {
                const minBlockCount = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[chain]);
                return this._miningOfficer._collectedBlocks[chain] && this._miningOfficer._collectedBlocks[chain] > minBlockCount && this._miningOfficer._collectedBlocks[chain] > 0;
              } else {
                return false;
              }
            }, true);
            const nextBlock = this._blockCache.shift();
            const syncComplete = this.node._discovery.connected < 2 ? true : this.node._syncComplete;
            const roversClaimToBeSynced = this._rovers.areRoversSynced() && syncComplete && allRoversHaveSufficientBlocks;
            this._logger.info(`mining work will be sent ${roversClaimToBeSynced} follow block cache rebase`);
            const fullBlockCache = roversClaimToBeSynced ? this._knownFullBlocksCache : false;
            await this._chainState._persistence.put(`${BC_SUPER_COLLIDER}.work`, nextBlock.getHash());
            this.miningOfficer._cleanUnfinishedBlock();
            if (BC_MINER_WORKERS < 1 && !this._relayMode) {
              rebaseWorkers();
            }
            this._workerPool._sendMessage({ type: 'segment' }).then(() => {
              this.miningOfficer.newRoveredBlock(roverNames, nextBlock, this._blockCache, roversClaimToBeSynced, fullBlockCache, this._emblemPerformance).then(pid => {
                if (pid !== false) {
                  this._logger.info(`collectBlock reassigned sent to miner`);
                }
              }).catch(err => {
                this._logger.error(`could not send to mining worker, reason: ${errToString(err)}`);
                console.trace(err);
                process.exit();
              });
            });
          }
        }
      }).catch(err => {
        this._logger.debug(err);
      });
    });
    return Promise.resolve(true);
  }

  /**
   * Store a block in persistence unless its Genesis Block
   * @returns Promise
   */
  async updateLatestAndStore(msg) {
    const block = msg.data;
    this._logger.info('store block: ' + block.getHeight() + ' ' + block.getHash());
    try {
      const previousLatest = await this.persistence.get('bc.block.latest');
      const parent = await this.persistence.get('bc.block.parent');
      const synclock = await this.persistence.get('synclock');

      // check if there is a decision tree cycle required
      if (previousLatest && parent && parent.getHash() !== previousLatest.getPreviousHash() && new _externals.BN(block.getTotalDistance()).gt(new _externals.BN(previousLatest.getTotalDistance())) && new _externals.BN(block.getTimestamp()).gte(new _externals.BN(previousLatest.getTimestamp()))) {
        // reset to previousLatestPath
        // behavior must be echoed in multiverse
        await this.persistence.put('bc.block.latest', block);
        await this.persistence.putBlock(block);
      } else if (previousLatest && previousLatest.getHash() === block.getPreviousHash() && new _externals.BN(block.getTimestamp()).gt(new _externals.BN(parent.getTimestamp())) === true && validateSequenceDifficulty(previousLatest, block) === true) {
        await this.persistence.put('bc.block.parent', previousLatest);
        await this.persistence.put('bc.block.latest', block);
        await this.persistence.putBlock(block);
      } else if (previousLatest.getHeight() === 1) {
        await this.persistence.put('bc.block.parent', previousLatest);
        await this.persistence.put('bc.block.latest', block);
        await this.persistence.putBlock(block);
      } else if (msg.force === true && msg.multiverse !== undefined && msg.multiverse.constructor === Array.constructor && synclock && synclock.getHeight() === 1) {
        const oldest = msg.multiverse[msg.multiverse - 1];
        // get the block before the oldest available block
        const grandparent = await this.persistence.get(`bc.block.${oldest.getHeight() - 1}`);
        if (!grandparent || oldest.getPreviousHash() !== grandparent.getHash()) {
          // this is a new chain branch and we must sync for it
          await this.persistence.put('synclock', oldest);
        }
        await this.persistence.put('bc.block.parent', msg.multiverse[1]);
        await this.persistence.put('bc.block.latest', block);
        await this.persistence.putBlock(block);
        /*
         * Remove this after block 100,000
         */
      } else if (msg.force === true && synclock.getHeight() === 1) {
        await this.persistence.put('synclock', block);
        // here we set it up so that on the next cycle we can compare paths
        await this.persistence.put('bc.block.parent', previousLatest);
        await this.persistence.put('bc.block.latest', block);
        await this.persistence.putBlock(block);
      } else if (parent.getHash() === block.getPreviousHash()) {
        await this.persistence.put('bc.block.latest', block);
        await this.persistence.put(block, 0);
      } else {
        this._logger.warn('block ' + block.getHeight() + ' ' + block.getHash() + ' as latest block <- mutates chain to stronger branch');
        await this.persistence.put('bc.block.latest', block);
        await this.persistence.put(block, 0);
      }

      if (msg.multiverse !== undefined) {
        while (msg.multiverse.length > 0) {
          const b = msg.multiverse.pop();
          // strict local only write of genesis block
          if (b.getHeight() > 1) {
            await this.persistence.putBlock(b);
          }
        }
        return Promise.resolve(block);
      }

      if (this.miningOfficer._canMine === false) {
        this._logger.info('determining if rovered headers include new child blocks');
        const latestRoveredHeadersKeys = this.miningOfficer._knownRovers.map(chain => `${chain}.block.latest`);
        const latestBlockHeaders = await this.persistence.getBulk(latestRoveredHeadersKeys);
        latestBlockHeaders.map(r => {
          if (r && this.miningOfficer._collectedBlocks[r.getBlockchain()] < 1) {
            this.miningOfficer._collectedBlocks[r.getBlockchain()]++;
          }
        });
      }
      return Promise.resolve(block);
    } catch (err) {
      this._logger.warn(err);
      this._logger.error(errToString(err));
      this._logger.warn('no previous block found');
      if (block !== undefined && msg.force === true) {
        await this.persistence.put('bc.block.parent', getGenesisBlock());
        await this.persistence.put('bc.block.latest', block);
        await this.persistence.putBlock(block);
      } else {
        this._logger.warn('submitted block ' + block.getHeight() + ' ' + block.getHash() + ' will not be persisted');
      }
      if (msg.multiverse !== undefined) {
        while (msg.multiverse.length > 0) {
          const b = msg.multiverse.pop();
          if (b.getHeight() > 1) {
            await this.persistence.putBlock(b);
          }
        }
        return Promise.resolve(block);
      }
      return Promise.resolve(block);
    }
  }

  /*
   * Set the Emblem performance in percentage on engine
   */
  async setEmblemPerformance() {
    let perf = 0;
    const emblemPerformance = await getMaxDistanceWithEmblems(this._minerKey, this.persistence);
    if (emblemPerformance) {
      // bonus minus default
      perf = max(0, (emblemPerformance.emblemBonus - 2) / emblemPerformance.emblemBonus);
      if (perf > 0) {
        perf = parseFloat(perf).toFixed(2);
      }
    }
    this._emblemPerformance = perf;
    if (emblemPerformance && emblemPerformance.emblemBalance) {
      this._emblemFixedCount = emblemPerformance.emblemBalance;
    }
    return Promise.resolve(perf);
  }

  /**
   * Start Server
   */
  async startNode() {

    if (BC_PRUNE_MULTICHAIN) {
      await this._persistence.pruneMultichain();
      this._logger.info(`pruning complete...exiting...`);
      process.exit();
    }

    if (this._minerKey) {
      this._emblemPerformance = await this.setEmblemPerformance();
    } else {
      this._emblemPerformance = 0;
    }
    this._logger.info('beginning network discovery');
    let nodeObject = false;
    const now = Math.floor(Date.now() * 0.001);
    if (BC_MINER_MUTEX) {
      const ts = Math.floor(Date.now() * 0.001);
      this._logger.warn(`BC_MINER_MUTEX is enabled rovered blocks will remain unique setting rover mutex time to ${ts}`);
      await this._persistence.put(`${BC_SUPER_COLLIDER}.miner.mutex`, 'open');
      await this._persistence.put(`${BC_SUPER_COLLIDER}.rover.mutex`, ts);
    }

    if (BC_WISE_LINE) {
      const tms = Math.floor(Date.now() * 0.001);
      this._logger.warn(`BC_WISE_LINE roverblocks will be weighted, setting time: ${tms}, edge: ${BC_MULTICHAIN_EDGE}`);
      if (BC_MULTICHAIN_EDGE) {
        await this.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${BC_MULTICHAIN_EDGE}:${Date.now()}`);
        await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, BC_MULTICHAIN_EDGE);
      }
      await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'complete');
      await this._persistence.put(`${BC_SUPER_COLLIDER}.miner.mutex`, 'open');
      await this._persistence.put(`${BC_SUPER_COLLIDER}.rover.mutex`, tms);
    }

    if (BC_COINBASE_MATURITY !== 100) {
      this._logger.warn(`BC_COINBASE_MATURITY set to ${BC_COINBASE_MATURITY} <- this invalidates consensus`);
    }

    try {
      this._logger.info('loading network key');
      const nodeObjectData = await this.persistence.get(`${BC_SUPER_COLLIDER}.dht.id`);
      try {
        nodeObject = JSON.parse(nodeObjectData);
      } catch (e) {
        nodeObject = nodeObjectData;
      }
    } catch (err) {
      console.trace(err);
      // empty catch for letting nodeObject be created
    }

    let nodeId;
    let nodeTimestamp;
    if (!nodeObject || DISABLE_IPH_TEST) {
      this._logger.warn('P2P node data not stored - creating machine network id');
      const mid = await machineId();
      nodeId = crypto.createHash('sha1').update(crypto.randomBytes(32).toString('hex')).digest('hex');
      nodeObject = {
        id: nodeId,
        timestamp: Math.floor(Date.now() * 0.001)
      };
      nodeTimestamp = nodeObject.timestamp;
      this._logger.info('assigned edge mutation key <- ' + nodeId);
      this._logger.info('assigned machine key <- ' + mid);
      await this.persistence.put(`${BC_SUPER_COLLIDER}.dht.id`, nodeObject);
    } else if (nodeObject) {
      nodeId = crypto.createHash('sha1').update(crypto.randomBytes(32).toString('hex')).digest('hex');
      //nodeId = crypto.createHash('sha1').update(mid).digest('hex')
      nodeTimestamp = nodeObject.timestamp;
    } else {
      nodeId = crypto.createHash('sha1').update(crypto.randomBytes(32).toString('hex')).digest('hex');
      nodeTimestamp = Math.floor(Date.now() * 0.001);
      await this.persistence.put(`${BC_SUPER_COLLIDER}.dht.id`, {
        id: nodeId,
        timestamp: nodeTimestamp
      });
    }
    this._logger.info('network creation epoch ' + nodeTimestamp);

    // if the key is more than 1 week old reset it
    if (new _externals.BN(new _externals.BN(nodeTimestamp).add(new _externals.BN(604800))).lt(new _externals.BN(now))) {
      this._logger.warn('key needs to be set');
      nodeId = crypto.createHash('sha1').update(crypto.randomBytes(32).toString('hex')).digest('hex');
      this._logger.info('asssigned node ID <- ' + nodeId);
      await this.persistence.put(`${BC_SUPER_COLLIDER}.dht.id`, {
        id: nodeId,
        timestamp: Math.floor(Date.now() * 0.001)
      });
    }

    this._emitter.on('peerCount', count => {
      if (this._server) {
        this._server._wsBroadcastPeerCount(count);
      }
    });

    // let evalBlocks = []
    // let indexBlocks = []

    // this._utxoEventEmitter.on('utxoUpdate', async (data) => {
    //   debugUTXO(`events count is ${this._utxoEventEmitter.eventNames()}`);
    //    //setImmediate(async () => {
    //     let callback = false
    //     if (!data) {
    //       callback = true
    //       debugUTXO(`callback from previous block evaluation - popping from ${evalBlocks.length}`)
    //       if (evalBlocks.length === 0) {
    //         return
    //       }
    //       data = evalBlocks.shift()
    //       indexBlocks.shift()
    //       debugUTXO(`POPPING ${data.block.getHeight()}:${data.block.getHash()} off stack ${evalBlocks.length}`)
    //       // debugUTXO(`running utxo on ${data.block.getHeight()}:${data.block.getHash()}`)
    //     }
    //     let {block, rand, date} = data
    //
    //     if (callback || evalBlocks.length === 0) {
    //       debugUTXO(`PUSHING ${block.getHeight()}:${block.getHash()} onto stack ${evalBlocks.length} with key utxoUpdate.${block.getHash()}.${date}.${rand}`)
    //       evalBlocks.push({block, date, rand})
    //       indexBlocks.push(`${block.getHash()}${date}${rand}`)
    //       try {
    //         setImmediate(async () => {
    //           let res = await updateUTXO(block, this.persistence, this._txHandler, this._txPendingPool, this._utxoManager, 'engine')
    //           debugUTXO(`Eval of ${block.getHeight()}:${block.getHash()} took ${Date.now() - date}ms, emitting utxoUpdate.${block.getHash()}.${date}.${rand}`);
    //           this._utxoEventEmitter.emit(`utxoUpdate.${block.getHash()}.${date}.${rand}`, res)
    //           if(indexBlocks.indexOf(`${block.getHash()}${date}${rand}`) > -1){
    //             evalBlocks.splice(indexBlocks.indexOf(`${block.getHash()}${date}${rand}`), 1)
    //             indexBlocks.splice(indexBlocks.indexOf(`${block.getHash()}${date}${rand}`), 1)
    //           }
    //           if(evalBlocks.length > 0) this._utxoEventEmitter.emit(`utxoUpdate`, null)
    //         })
    //       }
    //       catch(err){
    //         this._logger.error(`err processing ${block.getHeight()}:${block.getHash()} - ${err}, emitting utxoUpdate.${block.getHash()}.${date}.${rand}`)
    //         this._utxoEventEmitter.emit(`utxoUpdate.${block.getHash()}.${date}.${rand}`, false)
    //         if(indexBlocks.indexOf(`${block.getHash()}${date}${rand}`) > -1){
    //           evalBlocks.splice(indexBlocks.indexOf(`${block.getHash()}${date}${rand}`), 1)
    //           indexBlocks.splice(indexBlocks.indexOf(`${block.getHash()}${date}${rand}`), 1)
    //         }
    //         if(evalBlocks.length > 0) this._utxoEventEmitter.emit(`utxoUpdate`, null)
    //       }
    //     } else if (evalBlocks.length > 5) {
    //       this._logger.info(`too many blocks being evaluated while evaluating ${block.getHeight()}:${block.getHash()} emitting utxoUpdate.${block.getHash()}.${date}.${rand}`);
    //       this._utxoEventEmitter.emit(`utxoUpdate.${block.getHash()}.${date}.${rand}`, false)
    //     } else {
    //       debugUTXO(`PUSHING ${block.getHeight()}:${block.getHash()} onto stack ${evalBlocks.length} with key utxoUpdate.${block.getHash()}.${date}.${rand}`)
    //       evalBlocks.push({block, date, rand})
    //       indexBlocks.push(`${block.getHash()}${date}${rand}`)
    //     }
    //     return;
    //   })
    //})

    return this.node.start(nodeId);
  }

  async evaluateForRoverRequests(block) {
    if (BC_NO_ROVERS) {
      debug(`no rovers enabled`);
      return;
    }

    try {
      const headers = block.getBlockchainHeaders();
      const blockHeaders = this._knownRovers.reduce((all, rover) => {
        all = all.concat(headers[chainToGet(rover)]());
        return all;
      }, []);

      const missingBlocks = {};

      const synced = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
      if (synced && synced === 'pending') {
        this._logger.info(`returning evaluation of ${blockHeaders.length} rovered blocks from ${block.getHeight()} : ${block.getHash().slice(0, 6)}...`);
        return;
      }

      debug(`evaluating ${blockHeaders.length} rovered blocks from ${block.getHeight()} : ${block.getHash().slice(0, 6)}...`);

      for (const h of blockHeaders) {
        const blockchain = h.getBlockchain();
        const roveredKey = `${blockchain}.rovered.${h.getHash()}`;
        const rovered = await this.persistence.get(roveredKey);

        if (!rovered) {
          debug(`${blockchain} rover manager <- reevaluate request: ${h.getHeight()}`);
          if (!missingBlocks[blockchain]) {
            missingBlocks[blockchain] = {
              lowest: h.getHeight() - 1,
              highest: h.getHeight()
            };
          } else {
            if (missingBlocks[blockchain].lowest > h.getHeight()) {
              missingBlocks[blockchain].lowest = h.getHeight();
            } else if (missingBlocks[blockchain].highest < h.getHeight()) {
              missingBlocks[blockchain].highest = h.getHeight();
            }
          }
        }
      }

      const mbs = Object.keys(missingBlocks);
      const ts = Math.floor(Date.now() * 0.001);
      let maxHeight = 8;

      if (mbs && mbs.length > 0) {
        debug(`requesting rover range from block ${block.getHeight()}:${block.getHash().slice(0, 6)}... ${mbs.join(', ')}`);
        const rmraw = await this.persistence.get(`${BC_SUPER_COLLIDER}.rover.mutex`);
        if (rmraw) {
          const rm = parseInt(rmraw, 10);
          const diff = ts - rm;
          debug(`evaluating last rover request ${diff} seconds ago <- ${rm}`);
          //if (mbs.indexOf('btc') > -1 && diff >= 385) {
          if (diff >= 55) {
            debug(`last rover request approved`);
            await this.persistence.put(`${BC_SUPER_COLLIDER}.rover.mutex`, ts);
            let s = shuffle(mbs);
            for (let rov of s) {
              const sr = missingBlocks[rov];
              const highest = min(sr.highest, sr.lowest + maxHeight);

              await this.persistence.put(`${rov}.range.lowest.height`, sr.lowest - 2);
              await this.persistence.put(`${rov}.range.highest.height`, highest);

              debug(`${rov} rover manager <- discovery transmission: ${sr.lowest - 2} -> ${highest}`);
              this.pubsub.publish('rover.request', {
                type: 'rover.request',
                data: {
                  rover: rov,
                  highest: highest,
                  lowest: sr.lowest - 2
                }
              });
            }
          } else if (mbs.indexOf('lsk') > -1 && diff > 15) {
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
          } else if (mbs.indexOf('wav') > -1 && diff > 15) {
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
          } else if (mbs.indexOf('neo') > -1 && diff > 15) {
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

      return mbs.length !== 0;
    } catch (err) {

      this._logger.error(err);
      return false;
    }
  }

  /**
   * Create interface to Overline
   */
  async startOverline() {}

  throttleUpdate(rover) {
    const now = Math.floor(Date.now() / 100);
    const key = rover + now;

    if (!THROTTLE[key]) {
      THROTTLE[key] = true;
      return false;
    }

    return true;
  }

  /**
   * Enable FIX 4 data protocol
   */
  async startFix() {}
  // Install module bc-fix-rpc bridge
  // use LAUNCH KEY-CODE


  /**
   * Forces blocks into ordered processing queue
   */
  blockFromRoverQueue(task) {

    return new Promise((resolve, reject) => {

      const queueLength = this._blockQueue.length();
      let higher = true;
      let removed = 0;
      if (queueLength > 0) {
        debug(`blocks being processed <- ${queueLength}`);

        higher = this._blockQueue._tasks.toArray().reduce((all, t) => {
          if (!all) {
            return all;
          }
          if (parseInt(t.newBlock.getHeight(), 10) > parseInt(task.newBlock.getHeight(), 10)) {
            all = false;
          }
          return all;
        }, true);

        //this._blockQueue.remove((b) => {
        //  if (parseInt(task.newBlock.getHeight(), 10) > parseInt(b.data.newBlock.getHeight(), 10)) {
        //    removed++
        //    this._logger.info(parseInt(b.data.newBlock.getHeight(), 10) + ' removed from queue')
        //    return false
        //  }
        //  return true
        //})
      }

      const finalBlockQueueLength = this._blockQueue.length();

      if (higher) {
        // put the block at the end of the queue
        this._blockQueue.unshift(task, err => {
          if (err) {
            console.trace(err);
          }
          resolve();
        });
      } else {
        // put the block at the start of the queue
        this._blockQueue.push(task, err => {
          if (err) {
            console.trace(err);
          }
          resolve();
        });
      }
    });
  }

  async blockFromPeer({ conn, newBlock, options }) {

    debug(`--- DEBUG ---`);

    this._lastOlBlockTime = Math.floor(Date.now() / 1000);
    this._lastOlBlock = newBlock;

    const roverList = [];
    for (let key of this._knownRovers) {
      roverList.push(key);
    }

    const address = conn.remoteAddress + ':' + conn.remotePort;
    const { fullBlock, ipd, iph } = options;
    debug(`${BC_SUPER_COLLIDER} [] <- [] block ${newBlock.getHeight()} : ${newBlock.getHash()}`);
    const cache = fullBlock ? this._knownFullBlocksCache : this._knownBlocksCache;
    const heardFromPeer = this._peerRequestCache.has(conn.remoteAddress + newBlock.getHash());
    let synced = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);

    if (BC_MINER_BOOT) {
      synced = 'complete';
    }

    debug(`following boundaries new block: ${newBlock.getHeight()}:${newBlock.getHash()}`);
    debug(`blockFromPeer() iph: ${iph} ipd: ${ipd}`);

    //if (newBlock && !cache.get(newBlock.getHash()) && !heardFromPeer) {
    if (newBlock && !heardFromPeer) {

      const latestBlock = await this.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
      if (parseInt(newBlock.getHeight(), 10) > 1) {
        cache.set(newBlock.getHash(), true);
      }

      if (latestBlock) {
        const ch = parseInt(latestBlock.getHeight(), 10);
        if (ch > 4739506 && ch < 4740006) {
          const cb = await this._persistence.get(`lease.db.built`);
          if (!cb) {
            const balances = await getLeaseBalances('a');
            this._logger.info(`index window loaded ${Object.keys(balances).length}`);
            await this._persistence.putLeaseDb(balances, 'built');
          }
        } else if (ch > 6710606 && ch < 6711006) {
          const cb = await this._persistence.get(`lease.db.update`);
          if (!cb) {
            const balances = await getLeaseBalances('b');
            this._logger.info(`index window loaded ${Object.keys(balances).length}`);
            await this._persistence.putLeaseDb(balances, 'update');
          }
        }
      }

      const headersMap = newBlock.getBlockchainHeaders();
      const headers = Object.keys(headersMap.toObject()).reduce((all, listName) => {
        const getMethodName = `get${listName[0].toUpperCase()}${listName.slice(1)}`;
        const chainHeaders = headersMap[getMethodName]();
        return all.concat(sortBlocks(chainHeaders));
      }, []);

      const missingHeaders = await Promise.all(headers.filter(header => !this.persistence.getBlockByHash(header.getHash(), header.getBlockchain()))); // put child blocks
      if (missingHeaders && missingHeaders.length > 0) {
        debug(`missing headers in block ${newBlock.getHeight()} <- ${missingHeaders.length}`);
      }

      // Add block to LRU cache to avoid processing the same block twice
      debug(`Adding received ${fullBlock ? 'full ' : ''}block into cache of known blocks - ${newBlock.getHash()}`);
      debug(`received new ${fullBlock ? 'full ' : ''}block from peer, height ${newBlock.getHeight()}`);
      if (fullBlock) {

        debug('fullBlock to be expanded');
        if (!latestBlock) {
          this._logger.warn(`blockFromPeer() could not find latest BC block - cannot validate transactions`);
          return Promise.resolve(false);
        }

        // first evaluate if the block itself is valid
        const replaceLatestBlock = cache.get(newBlock.getHeight());
        if (BC_MINER_BOOT === true && parseInt(newBlock.getHeight(), 10) > parseInt(latestBlock.getHeight(), 10) + 1) {
          this._logger.info(`BC_MINER_BOOT enabled and purposed block height ${newBlock.getHeight()} is above boot standard ${latestBlock.getHeight()} `);
          this._peerRequestCache.set(conn.remoteAddress + newBlock.getHash(), true);
          this._emitter.emit(`sendblock`, { data: latestBlock, connection: conn });
          return;
        }

        debugExtend(`passing block to multiverse.extendMultiverse ${newBlock.getHeight()} : ${newBlock.getHash()} iph: ${iph} ipd: ${ipd}`);

        if (BC_LOG_BLOCK_STATS) {
          const previousMiner = this._loggedBcBalances.lastMiner;
          this._loggedBcBalances.lastMiner = newBlock.getMiner();
          if (this._loggedBcBlocks.indexOf(newBlock.getHash()) < 0) {
            this._loggedBcBlocks.push(newBlock.getHash());
            if (!this._loggedBcBalances[newBlock.getMiner()]) {
              this._loggedBcBalances[newBlock.getMiner()] = Math.round(newBlock.getNrgGrant());
            } else {
              this._loggedBcBalances[newBlock.getMiner()] += Math.round(newBlock.getNrgGrant());
            }
          }
          const newBlocks = newBlock.getBlockchainHeadersCount ? newBlock.getBlockchainHeadersCount() : 0;
          blockStatStream.write(`${Math.floor(new Date() / 1000)},${newBlock.getTimestamp()},${newBlock.getHeight()},${newBlock.getHash()},${newBlock.getDistance()},${newBlock.getDifficulty()},${newBlock.getTotalDistance()},${newBlock.getMiner().slice(2, 30)},${this._loggedBcBalances[newBlock.getMiner()]},${newBlock.getTxsList().length},${Math.round(newBlock.getNrgGrant())},${newBlocks},${Math.floor(new Date() / 1000) - newBlock.getTimestamp()},${newBlock.getMiner() === previousMiner ? 1 : 0},1,${addressToHost(conn.remoteAddress)}\n`);
        }

        const { stored, valid, needsResync, rangeRequest, schedules, assertSyncComplete, remount, blockSendingAlternative } = await this.multiverse.extendMultiverse(newBlock, 'peer', true, options.handleAsNewPeer, address, false);
        let currentSyncedStatus = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
        //
        if (remount) {
          this._logger.warn(`remount active on waypoint remount: ${remount}, current synced status: ${currentSyncedStatus}, waypoint: ${addressToHost(conn.remoteAddress)}`);
          this.node.addToQuarantine(addressToHost(conn.remoteAddress), "remount active on waypoint", true);
          return;
        }

        if (!stored && !needsResync && !rangeRequest) {
          debug(`sending better edge for block ${newBlock.getHeight()} from peer...`);

          if (!valid && !blockSendingAlternative) {
            this._logger.info(`sending stronger edge for block ${newBlock.getHeight()} from waypoint...`);
          }

          cache.delete(newBlock.getHash());
          if (!this._peerRequestCache.has(conn.remoteAddress + newBlock.getHash())) {
            this._peerRequestCache.set(conn.remoteAddress + newBlock.getHash(), true);
            this._emitter.emit(`sendblock`, { data: latestBlock, connection: conn });
          } else {
            this._peerRequestCache.del(conn.remoteAddress + newBlock.getHash());
          }
          return;
        }

        debug(`stored: ${stored} ${newBlock.getHeight()}`);
        const shouldRoverSearch = await this.evaluateForRoverRequests(newBlock);
        if (stored && !this._relayMode) {
          // send block to other peers
          cache.delete(newBlock.getHeight(), newBlock);
          // immediate update the miner
          //if (Object.keys(this._lastCollectedBlock).length > 0) {
          //  const cachedBlocks = Object.keys(this._lastCollectedBlock)
          //  const r = cachedBlocks[Math.floor(Math.random()*cachedBlocks.length)]
          //  this._roverEmitter.emit('collectBlock', { block: this._lastCollectedBlock[r] })
          //}
          await this.miningOfficer.newRoveredBlock(roverList, false, this._blockCache, true, this._knownFullBlocksCache, this._emblemPerformance);
          if (!this._relayMode) {
            rebaseWorkers();
          }
          this.miningOfficer._cleanUnfinishedBlock();

          if (!options.alreadyBroadcasted && !blockSendingAlternative && latestBlock.getHeight() !== newBlock.getHeight() && valid) {
            this.node.broadcastNewBlock(newBlock, parseInt(latestBlock.getHeight(), 10));
          }

          this._knownFullBlocksCache.set(newBlock.getHash(), newBlock);

          await this._chainState._persistence.put(`${BC_SUPER_COLLIDER}.work`, newBlock.getHash());
        }

        if (needsResync && rangeRequest && rangeRequest.highestHeight) {

          this._node._knownBlockSegments.clear();
          this._emitter.emit('requestBlockRange', [min(rangeRequest.highestHeight, rangeRequest.lowestHeight + BC_MAX_DATA_RANGE), rangeRequest.lowestHeight, conn], 3);

          if (!stored) {
            this.miningOfficer._cleanUnfinishedBlock();
            if (!this._relayMode) {
              rebaseWorkers();
            }
          }
        } else if (needsResync && rangeRequest && rangeRequest.highestHeight) {
          this._logger.info(`range request highest: ${rangeRequest.highestHeight} lowest: ${rangeRequest.lowestHeight} pending while multichain searches for edge`);
        }
      } else {
        //
        //
        //  OVERLINE USE
        //  complete the partial block
        //
        //
        debugExtend('no full block found');
        const { valid, stored, needsResync, rangeRequest, schedules, assertSyncComplete, remount, blockSendingAlternative } = await this.multiverse.extendMultiverse(newBlock, 'peer', true, false, address);

        if (remount) {
          this._logger.warn(`remount active on waypoint remount: ${remount}, needs resync: ${needsResync}, waypoint: ${addressToHost(conn.remoteAddress)}`);
          this.node.addToQuarantine(addressToHost(conn.remoteAddress), "remount active on waypoint", true);
          return;
        }

        if (!needsResync && synced === 'complete') {
          this.node._syncComplete = false;
        }

        // store any relavent block schedules to evaluate when/if that child chain block height is available
        if (schedules.length > 0) {
          await Promise.all(schedules.map((schedule, i) => {
            this._logger.info(`adding schedule ${i}`);
            return this.persistence.scheduleAtBlockHeight(schedule[0], schedule[1], schedule[2], schedule[3], schedule[4]);
          }));
        }

        if (needsResync && rangeRequest && rangeRequest.highestHeight) {
          this._node._knownBlockSegments.clear();
          this._emitter.emit('requestBlockRange', [rangeRequest.highestHeight, rangeRequest.lowestHeight], 3);
        }

        const request = { dimension: 'hash', id: newBlock.getHash(), connection: conn };
        this._emitter.emit('getTxs', request);
        // make sure IPH and IPD are complete before asking for sets to catch up
        resyncFullNode = needsResync && iph === 'complete' && ipd === 'complete';
        resyncTestNode = DISABLE_IPH_TEST && rangeRequest && rangeRequest.highestHeight;
        if (resyncTestNode || resyncFullNode) {
          if (latestBlock !== null) {
            const diff = new _externals.BN(parseInt(newBlock.getHeight(), 10)).sub(new _externals.BN(parseInt(latestBlock.getHeight(), 10)).sub(new _externals.BN(1))).toNumber();
            debug(`passing block to multiverse.extendMultiverse ${newBlock.getHeight()} : ${newBlock.getHash()} iph: ${iph} ipd: ${ipd}`);

            if (stored) {

              await this._chainState._persistence.put(`${BC_SUPER_COLLIDER}.work`, newBlock.getHash());

              if (!options.alreadyBroadcasted && !blockSendingAlternative && !options.alreadyBroadcasted) {
                this.node.broadcastNewBlock(newBlock);
              }

              if (!needsResync && !this._relayMode) {
                rebaseWorkers();
                this.miningOfficer._cleanUnfinishedBlock();
                // immediately check if there is work available
                await this.miningOfficer.newRoveredBlock(roverList, false, this._blockCache, true, this._knownFullBlocksCache, this._emblemPerformance);
                //if (Object.keys(this._lastCollectedBlock).length > 0) {
                //  const cachedBlocks = Object.keys(this._lastCollectedBlock)
                //  const r = cachedBlocks[Math.floor(Math.random()*cachedBlocks.length)]
                //  this._roverEmitter.emit('collectBlock', { block: this._lastCollectedBlock[r] })
                //}
              }
              // send partial block to other peers
              this._logger.info(`new Block from peer: ${newBlock.getHeight()}`);
              this.pubsub.publish('block.peer', {
                type: 'block.peer',
                data: newBlock
              });
            }

            debug(`blockFromPeer() iph: ${iph} ipd: ${ipd}`);
            if (needsResync && iph === 'complete' && ipd !== 'pending') {
              const getBlockListMessage = {
                data: {
                  high: newBlock.getHeight(),
                  low: new _externals.BN(latestBlock.getHeight()).sub(new _externals.BN(6)).toNumber()
                },
                connection: conn
              };
              this._emitter.emit('getblocklist', getBlockListMessage);
            } else if (needsResync) {
              debug(`ignored resync from multiverse IPH: ${iph} IPD: ${ipd}`);
            }
          }
        } else {
          // get a full block
          const request = { dimension: 'hash', id: newBlock.getHash(), connection: conn };
          this._emitter.emit('getTxs', request);
          // make sure IPH and IPD are complete before asking for sets to catch up
          if (needsResync && iph === 'complete' && ipd !== 'pending') {
            this.persistence.get('bc.block.latest').then(latestBlock => {
              if (latestBlock !== null) {
                const getBlockListMessage = {
                  data: {
                    high: newBlock.getHeight(),
                    low: new _externals.BN(latestBlock.getHeight()).sub(new _externals.BN(6)).toNumber()
                  },
                  connection: conn
                };
                this._emitter.emit('getblocklist', getBlockListMessage);
              } else {
                this._logger.error(new Error('critical error: unable to get bc.block.latest <- all super collider nodes will be vulnerable'));
              }
            }).catch(err => {
              debug(err);
            });
          }
        }
      }
    } else {
      this._logger.info(`block seen ${newBlock.getHash()}`);
    }
  }

  /**
   * Start rovers
   * @param rovers - list (string; comma-delimited) of rover names to start
   */
  async startRovers(rovers, forceResync = false) {

    const syncComplete = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
    let now = Math.floor(Date.now() / 1000);

    if (BC_NO_ROVERS) {
      this._logger.info(`no rovers enabled`);
      return;
    }

    // do not evaluate if rovers has already started
    if (this._roverTimeTable && Object.keys(this._roverTimeTable).length > 0) {
      return;
    }

    this._logger.info(`evaluating boot sequence for rovers '${rovers.join(',')} now: ${now}, start: ${this._startTime}, sync: ${syncComplete}`);

    this._knownRovers = rovers;
    this.miningOfficer._knownRovers = rovers;

    const roverList = [];
    for (let key of this._knownRovers) {

      if (BC_PM2) {
        this._pm2[key + '.block.latency'] = io.histogram({
          name: 'latency',
          measurement: 'mean'
        });
      }
      roverList.push(key);
    }

    const p = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
    const highestKnownHeight = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);
    const lb = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);

    if (!BC_MINER_BOOT) {

      if (now - 120 < this._startTime || syncComplete !== 'complete') {
        if (highestKnownHeight && lb && lb.getHeight && new _externals.BN(lb.getHeight()).lt(new _externals.BN(highestKnownHeight).sub(new _externals.BN(100)))) {
          this._logger.info(`yielding rovers for highest edge ${highestKnownHeight} <- ${rovers.join(',')}`);
        }
        setTimeout(async () => {
          await this.startRovers(rovers, forceResync);
        }, 18000);
        return;
      }
    }

    if (!BC_NO_ROVERS) {
      setInterval(async () => {

        for (let rover of this._miningOfficer._knownRovers) {

          now = Math.floor(Date.now() / 1000);
          if (BC_FORCE_ROVERS.indexOf(rover) < 0) {

            const requiredBlockCount = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[rover]) >= this._miningOfficer._collectedBlocks[rover];

            if (!this._roverTimeTable[rover]) {
              this._roverTimeTable[rover] = {
                updated: Math.floor(Date.now() / 1000),
                start: Math.floor(Date.now() / 1000),
                edge: false
              };
            } else {

              const s = 299;
              const syncComplete = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
              const elapsed = now - this._roverTimeTable[rover].updated;
              const fromDeploy = now - this._roverTimeTable[rover].start;

              if (now - 22 < this._startTime && syncComplete === 'complete' || now - 22 < this._startTime) {
                this._logger.info(`${elapsed}s pending ${rover} rover deployment`);
              } else {

                if (this._roverTimeTable[rover].updated + s < now && !this._roverTimeTable[rover].edge) {
                  this._logger.info(`direct connect mode <- ${rover}`);
                  this._miningOfficer._collectedBlocks[rover] = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[rover]) + 100;
                  this._roverTimeTable[rover].edge = true;
                  this._roverTimeTable[rover].updated = Math.floor(Date.now() / 1000);
                } else if (!process.env.BC__BACKSYNC_PERIOD && now - this._roverTimeTable[rover].start > 390 && !this._roverTimeTable[rover].edge) {
                  this._logger.info(`direct communication opened <- ${rover}`);
                  this._miningOfficer._collectedBlocks[rover] = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[rover]) + 100;
                  this._roverTimeTable[rover].edge = true;
                  this._roverTimeTable[rover].updated = Math.floor(Date.now() / 1000);
                } else if (!this._roverTimeTable[rover].edge) {
                  this._logger.info(`${rover} rover age ${fromDeploy}s <- last communication: ${elapsed}s `);
                }
              }
            }
          }
        }
      }, 60060);
    }

    //if ((now - this._startTime) < 303 && !BC_MINER_BOOT && !BC_NO_ROVERS) {
    //  this._logger.info(`boot sequence for rovers waiting for warm up period`)
    //  setTimeout(async () => {
    //    await this.startRovers(rovers, forceResync)
    //  }, 18000)
    //  return
    //}

    this._logger.info(`boot sequence accepted for rovers ${rovers.join(',')} after ${now - this._startTime}s`);

    for (let r of Object.keys(this._rovers._roverSyncStatus)) {
      if (rovers.indexOf(r) < 0) {
        this._rovers._roverSyncStatus[r] = true;
        this.miningOfficer._collectedBlocks[r] = 5000;
      }
    }

    // LDL
    for (let r of Object.keys(this._rovers._roverSyncStatus)) {
      if (BC_FORCE_ROVERS && BC_FORCE_ROVERS.indexOf(r) > -1) {
        this._rovers._roverSyncStatus[r] = true;
        this.miningOfficer._collectedBlocks[r] = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[r]) + 100;
      }
    }

    const needsResyncData = await this.persistence.getDecisivePeriodOfCrossChainBlocksStatus();
    const sendRoverUpdate = [];
    for (const roverName of rovers) {
      if (roverName) {
        // Removing the rover latest block forces the rover to rebuild the start
        // await this._persistence.del(`${roverName}.block.latest`)
        const lb = await this._persistence.get(`${roverName}.block.latest`);
        if (lb && lb.getHash) {

          if (BC_MINER_BOOT && roverName === 'eth') {
            this._logger.info(`miner boot enabled not sending eth request...`);
            continue;
          }
          sendRoverUpdate.push(roverName);
          //await this._persistence.del(`${roverName}.block.latest`)
        }

        if (!BC_PREVENT_INITIAL_SYNC) {
          await this._rovers.startRover(roverName, false, forceResync);
        }

        if (!BC_PREVENT_INITIAL_SYNC && roverName === 'btc') {
          const needsResyncData = await this.persistence.getDecisivePeriodOfCrossChainBlocksStatus(Date.now(), [roverName]);
          if (needsResyncData[roverName].latestBlock && needsResyncData[roverName].latestBlock.getPreviousHash() === BTC_BOOT_BLOCK) {
            this.miningOfficer._collectedBlocks[roverName] = 1;
          }
        }
      }
    }

    setInterval(async () => {

      Object.keys(THROTTLE).map(k => {
        delete THROTTLE[k];
      });

      const lbc = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
      const synced = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
      if (lbc && lbc.getHash && synced && synced === 'complete') {
        const headers = lbc.getBlockchainHeaders();
        this._logger.info(`notifying rovers of current edge from OL latest block ${lbc.getHeight()}`);
        for (const roverName of sendRoverUpdate) {
          const lb = last(headers[chainToGet(roverName)]());
          if (!lb) {
            continue;
          }
          const msg = new RoverMessage();
          const latestBlockPayload = new RoverMessage.LatestBlock();
          latestBlockPayload.setRoverName(roverName);
          latestBlockPayload.setBlock(lb);
          msg.setType(RoverMessageType.LATESTBLOCK);
          msg.setLatestBlock(latestBlockPayload);
          this._rovers.messageRover(roverName, 'latest_block', msg);
        }
      } else if (synced && synced === 'pending') {
        this._logger.info(`rovers not updating with latest block while status is pending`);
      }
    }, 856600);

    setTimeout(async () => {
      const lbc = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
      if (lbc && lbc.getHash) {
        const headers = lbc.getBlockchainHeaders();
        for (const roverName of sendRoverUpdate) {
          const lb = last(headers[chainToGet(roverName)]());
          if (!lb) {
            continue;
          }
          const msg = new RoverMessage();
          const latestBlockPayload = new RoverMessage.LatestBlock();
          latestBlockPayload.setRoverName(roverName);
          latestBlockPayload.setBlock(lb);
          msg.setType(RoverMessageType.LATESTBLOCK);
          msg.setLatestBlock(latestBlockPayload);
          this._rovers.messageRover(roverName, 'latest_block', msg);
        }
      }
    }, 126600);

    this.pubsub.subscribe('rover.request', '<engine>', async msg => {
      const now = Math.floor(Date.now() / 1000);
      const multichainSyncStatus = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);

      //if (this._lastOlBlockTime && (now - this._lastOlBlockTime) < 200) {
      this._logger.info(`transferring rover request ${msg.data.rover} ${msg.data.lowest} -> ${msg.data.highest}`);
      if (this._rovers._roverSyncStatus[msg.data.rover] === true) {
        this._emitter.emit('requestRoverRange', msg.data);
      } else {
        this._rovers._roverRangeRequests[msg.data.rover]++;
        this._logger.info(`yielding fetch request ${this._rovers._roverRangeRequests[msg.data.rover]} for rover ${msg.data.rover} until sync is complete`);

        if (this._rovers._roverRangeRequests[msg.data.rover] > 20 && ['neo', 'wav'].indexOf(msg.data.rover) > -1) {
          this._logger.warn(`overriding rover sync delay for API based rover ${msg.data.rover} -> setting sync to complete`);
        }
      }
      //} else {
      //  this._logger.info(`not transferring rover request ${msg.data.rover} ${msg.data.lowest} -> ${msg.data.highest} until network block`)
      //}
    });

    this._asyncEmitter.on('blockFromPeer', async ({ conn, newBlock, options }) => {
      debug(`--- DEBUG ---`);
      debug(JSON.stringify(options, null, 2));
      const address = conn.remoteAddress + ':' + conn.remotePort;
      const { fullBlock, ipd, iph } = options;
      const cache = fullBlock ? this._knownFullBlocksCache : this._knownBlocksCache;
      const heardFromPeer = this._peerRequestCache.has(conn.remoteAddress + newBlock.getHash());
      debug(`${BC_SUPER_COLLIDER} [] <- [] block ${newBlock.getHeight()} : ${newBlock.getHash()}`);
      debug(`following boundaries new block: ${newBlock.getHeight()}:${newBlock.getHash()}`);
      debug(`blockFromPeer() iph: ${iph} ipd: ${ipd}`);

      if (newBlock && !cache.get(newBlock.getHash()) && !heardFromPeer) {
        const latestBlock = await this.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
        if (parseInt(newBlock.getHeight(), 10) > 1) {
          cache.set(newBlock.getHash(), true);
        }

        const headersMap = newBlock.getBlockchainHeaders();
        const headers = Object.keys(headersMap.toObject()).reduce((all, listName) => {
          const getMethodName = `get${listName[0].toUpperCase()}${listName.slice(1)}`;
          const chainHeaders = headersMap[getMethodName]();
          return all.concat(sortBlocks(chainHeaders));
        }, []);

        const missingHeaders = await Promise.all(headers.filter(header => !this.persistence.getBlockByHash(header.getHash(), header.getBlockchain()))); // put child blocks
        if (missingHeaders && missingHeaders.length > 0) {
          debug(`missing headers in block ${newBlock.getHeight()} <- ${missingHeaders.length}`);
        }

        // Add block to LRU cache to avoid processing the same block twice
        debug(`Adding received ${fullBlock ? 'full ' : ''}block into cache of known blocks - ${newBlock.getHash()}`);
        debug(`received new ${fullBlock ? 'full ' : ''}block from peer, height ${newBlock.getHeight()}`);
        if (fullBlock) {
          debug('fullBlock to be expanded');
          if (!latestBlock) {
            this._logger.warn(`blockFromPeer() could not find latest BC block - cannot validate transactions`);
            return Promise.resolve(false);
          }

          // first evaluate if the block itself is valid
          debugExtend(`passing #2 block to multiverse.extendMultiverse ${newBlock.getHeight()} : ${newBlock.getHash()} iph: ${iph} ipd: ${ipd}`);
          const { stored, needsResync, rangeRequest, schedules, assertSyncComplete, blockSendingAlternative } = await this.multiverse.extendMultiverse(newBlock, 'peer', true, options.handleAsNewPeer, address);

          if (!needsResync && synced === 'complete') {
            this.node._syncComplete = false;
          }

          if (!stored && !needsResync && !rangeRequest && !blockSendingAlternative) {
            debug(`sending better edge for block ${newBlock.getHeight()} from peer...`);
            cache.del(newBlock.getHash());
            if (!this._peerRequestCache.has(conn.remoteAddress + newBlock.getHash())) {
              this._peerRequestCache.set(conn.remoteAddress + newBlock.getHash(), true);
              this._emitter.emit(`sendblock`, { data: latestBlock, connection: conn });
            } else {
              this._peerRequestCache.del(conn.remoteAddress + newBlock.getHash());
            }
            return Promise.resolve(false);
          }

          if (blockSendingAlternative) {
            // LDL
            this._logger.info(`stored: false, needsResync: false, rangeRequest: false block ${newBlock.getHeight()} from waypoint is being ignored`);
            return Promise.resolve(false);
          }

          if (BC_LOG_BLOCK_STATS) {
            const previousMiner = this._loggedBcBalances.lastMiner;
            this._loggedBcBalances.lastMiner = newBlock.getMiner();
            if (this._loggedBcBlocks.indexOf(newBlock.getHash()) < 0) {
              this._loggedBcBlocks.push(newBlock.getHash());
              if (!this._loggedBcBalances[newBlock.getMiner()]) {
                this._loggedBcBalances[newBlock.getMiner()] = Math.round(newBlock.getNrgGrant());
              } else {
                this._loggedBcBalances[newBlock.getMiner()] += Math.round(newBlock.getNrgGrant());
              }
            }
            const newBlocks = newBlock.getBlockchainHeadersCount ? newBlock.getBlockchainHeadersCount() : 0;
            blockStatStream.write(`${Math.floor(new Date() / 1000)},${newBlock.getTimestamp()},${newBlock.getHeight()},${newBlock.getHash()},${newBlock.getDistance()},${newBlock.getDifficulty()},${newBlock.getTotalDistance()},${newBlock.getMiner().slice(2, 30)},${this._loggedBcBalances[newBlock.getMiner()]},${newBlock.getTxsList().length},${Math.round(newBlock.getNrgGrant())},${newBlocks},${Math.floor(new Date() / 1000) - newBlock.getTimestamp()},${newBlock.getMiner() === previousMiner ? 1 : 0},1\n`);
          }

          debug(`stored: ${stored} ${newBlock.getHeight()}`);
          if (needsResync && rangeRequest && rangeRequest.highestHeight) {

            if (stored) {
              if (parseInt(latestBlock.getHeight(), 10) - parseInt(newBlock.getHeight(), 10) < 4) {
                this._node._knownBlockSegments.clear();
                this._emitter.emit('requestBlockRange', [rangeRequest.highestHeight, rangeRequest.lowestHeight, conn], 2);
                if (!options.alreadyBroadcasted) {
                  this.node.broadcastNewBlock(newBlock, parseInt(latestBlock.getHeight(), 10));
                }
              }
            } else {
              debug(`range request highest height: ${rangeRequest.highestHeight} lowest height: ${rangeRequest.lowestHeight}`);
              this._node._knownBlockSegments.clear();
              this._emitter.emit('requestBlockRange', [rangeRequest.highestHeight, rangeRequest.lowestHeight], 3);
            }

            return;
          }

          if (stored) {

            if (!options.alreadyBroadcasted) {
              this.node.broadcastNewBlock(newBlock, parseInt(latestBlock.getHeight(), 10));
            } else if (!options.alreadyBroadcasted && !needsResync) {
              this.node.broadcastNewBlock(newBlock, parseInt(latestBlock.getHeight(), 10));
            }
            rebaseWorkers();
            await this._chainState._persistence.put(`${BC_SUPER_COLLIDER}.work`, newBlock.getHash());
            this._knownFullBlocksCache.set(newBlock.getHash(), newBlock);
            // drain all of the remaining blocks in the queue
            this.pubsub.publish('block.peer', {
              type: 'block.peer',
              data: newBlock
            });

            if (!this._relayMode) {
              await this.miningOfficer.newRoveredBlock(roverList, false, this._blockCache, true, this._knownFullBlocksCache, this._emblemPerformance);
            }
          }
        } else {
          //
          //  OVERLINE USE
          //  complete the partial block
          //
          debugExtend('#2 no full block found');
          const { stored, needsResync, rangeRequest, schedules, assertSyncComplete, blockSendingAlternative } = await this.multiverse.extendMultiverse(newBlock, 'peer', true, false, address);

          if (!needsResync && synced === 'complete') {
            this.node._syncComplete = false;
          }

          // store any relavent block schedules to evaluate when/if that child chain block height is available
          if (schedules.length > 0) {
            await Promise.all(schedules.map((schedule, i) => {
              this._logger.info(`adding schedule ${i}`);
              return this.persistence.scheduleAtBlockHeight(schedule[0], schedule[1], schedule[2], schedule[3], schedule[4]);
            }));
          }

          if (needsResync && rangeRequest && rangeRequest.highestHeight) {
            this._node._knownBlockSegments.clear();
            this._emitter.emit('requestBlockRange', [rangeRequest.highestHeight, rangeRequest.lowestHeight]);
          }

          const request = { dimension: 'hash', id: newBlock.getHash(), connection: conn };
          this._emitter.emit('getTxs', request);
          // make sure IPH and IPD are complete before asking for sets to catch up
          resyncFullNode = needsResync && iph === 'complete' && ipd === 'complete';
          resyncTestNode = DISABLE_IPH_TEST && rangeRequest && rangeRequest.highestHeight;
          if (resyncTestNode || resyncFullNode) {
            if (latestBlock !== null) {
              const diff = new _externals.BN(parseInt(newBlock.getHeight(), 10)).sub(new _externals.BN(parseInt(latestBlock.getHeight(), 10)).sub(new _externals.BN(1))).toNumber();
              const high = parseInt(newBlock.getHeight(), 10);
              const low = new _externals.BN(parseInt(newBlock.getHeight(), 10)).sub(new _externals.BN(diff)).toNumber();
              debug(`passing block to multiverse.extendMultiverse ${newBlock.getHeight()} : ${newBlock.getHash()} iph: ${iph} ipd: ${ipd}`);

              if (stored) {

                if (!needsResync && !this._relayMode) {
                  rebaseWorkers();
                  // immediately check if there is work available
                  //this._blockQueue.process()
                  await this.miningOfficer.newRoveredBlock(roverList, false, this._blockCache, true, this._knownFullBlocksCache, this._emblemPerformance);
                }
                await this._chainState._persistence.put(`${BC_SUPER_COLLIDER}.work`, newBlock.getHash());
                // send partial block to other peers
                this._logger.info(`new Block from peer: ${newBlock.getHeight()}`);
                this.pubsub.publish('block.peer', {
                  type: 'block.peer',
                  data: newBlock
                });
              }

              debug(`blockFromPeer() iph: ${iph} ipd: ${ipd}`);
              if (needsResync && iph === 'complete' && ipd !== 'pending') {
                const getBlockListMessage = {
                  data: {
                    high: newBlock.getHeight(),
                    low: new _externals.BN(latestBlock.getHeight()).sub(new _externals.BN(6)).toNumber()
                  },
                  connection: conn
                };
                this._emitter.emit('getblocklist', getBlockListMessage);
              } else if (needsResync) {
                debug(`ignored resync from multiverse IPH: ${iph} IPD: ${ipd}`);
              }
            }
          } else {
            // get a full block
            const request = { dimension: 'hash', id: newBlock.getHash(), connection: conn };
            this._emitter.emit('getTxs', request);
            // make sure IPH and IPD are complete before asking for sets to catch up
            if (needsResync && iph === 'complete' && ipd !== 'pending') {
              this.persistence.get('bc.block.latest').then(latestBlock => {
                if (latestBlock !== null) {
                  const getBlockListMessage = {
                    data: {
                      high: newBlock.getHeight(),
                      low: new _externals.BN(latestBlock.getHeight()).sub(new _externals.BN(6)).toNumber()
                    },
                    connection: conn
                  };
                  this._emitter.emit('getblocklist', getBlockListMessage);
                } else {
                  this._logger.error(new Error('critical error: unable to get bc.block.latest <- all super collider nodes will be vulnerable'));
                }
              }).catch(err => {
                debug(err);
              });
            }
          }
        }
      } else {
        this._logger.info(`newBlock already in cache ${newBlock.getHash()}`);
      }
    });

    this.workerPool.allRise({ minerKey: this._minerKey, emblemPerformance: this._emblemPerformance }).then(() => {

      this._logger.info(`worker pool initialized with mining address: ${this._minerKey}`);
      this._miningEmitter.on('announceMinedBlock', async ({ unfinishedBlock, solution }) => {

        if (!unfinishedBlock) {
          const roverList = [];
          for (let key of this._knownRovers) {
            roverList.push(key);
          }
          delete this._lastCollectedBlock[rover];
          await this.miningOfficer.newRoveredBlock(roverList, false, this._blockCache, true, this._knownFullBlocksCache, this._emblemPerformance);
          return;
        }

        if (this._lastMinedBlock !== false) {
          if (this._lastOlBlock && this._lastOlBlock.getHeight() >= unfinishedBlock.getHeight() && this._lastOlBlock.getMiner() === unfinishedBlock.getMiner()) {
            this._logger.info(`solution submitted too quickly ${unfinishedBlock.getHeight()}`);
            return;
          }
        }

        this._lastMinedBlock = unfinishedBlock;
        const res = await this._processMinedBlock(unfinishedBlock, solution);
        debug(`res is ${res}`);
        if (res === true) {
          const newBlock = unfinishedBlock;
          if (BC_LOG_BLOCK_STATS) {
            const previousMiner = this._loggedBcBalances.lastMiner;
            this._loggedBcBalances.lastMiner = newBlock.getMiner();
            if (this._loggedBcBlocks.indexOf(newBlock.getHash()) < 0) {

              this._loggedBcBlocks.push(newBlock.getHash());
              if (!this._loggedBcBalances[newBlock.getMiner()]) {
                this._loggedBcBalances[newBlock.getMiner()] = Math.round(newBlock.getNrgGrant());
              } else {
                this._loggedBcBalances[newBlock.getMiner()] += Math.round(newBlock.getNrgGrant());
              }
            }
            const newBlocks = newBlock.getBlockchainHeadersCount ? newBlock.getBlockchainHeadersCount() : 0;
            blockStatStream.write(`${Math.floor(new Date() / 1000)},${newBlock.getTimestamp()},${newBlock.getHeight()},${newBlock.getHash()},${newBlock.getDistance()},${newBlock.getDifficulty()},${newBlock.getTotalDistance()},${newBlock.getMiner().slice(2, 30)},${this._loggedBcBalances[newBlock.getMiner()]},${newBlock.getTxsList().length},${Math.round(newBlock.getNrgGrant())},${newBlocks},${Math.floor(new Date() / 1000) - newBlock.getTimestamp()},${newBlock.getMiner() === previousMiner ? 1 : 0},1,127.0.0.1\n`);
          }
          // set the block in the local cache
          this._knownBlocksCache.set(newBlock.getHash(), true);
          this._knownFullBlocksCache.set(newBlock.getHash(), newBlock);
        } else {
          debug(`yielding block ${unfinishedBlock.getHeight()} broadcasted to network`);
        }
      });

      this._emitter.on('requestRoverRange', async data => {
        if (!data) {
          return;
        }

        const now = Date.now();
        const { rover, highest, lowest } = data;
        let dataLatestStr = await this.persistence.get(`${rover}.data.latest`);
        let lowestHeight = false;
        let makeRequest = true;
        if (dataLatestStr === null) {
          await this.persistence.put(`${rover}.data.latest`, `${lowest}:${now}`);
        } else {
          let prevTime = parseInt(dataLatestStr.split(':')[1], 10) + 5000;
          lowestHeight = parseInt(dataLatestStr.split(':')[0], 10);
          if (lowestHeight < lowest || prevTime < now) {
            this._logger.info(`new higher threshold, ${rover} moving to ${lowest}`);
          } else {
            this._logger.info(` ${rover} rover threshold searching for ${lowestHeight}, yielding request for ${lowest}`);
            makeRequest = false;
          }
        }

        if (makeRequest) {
          debug(`direct range request rover ${rover} from: ${lowest},  to: ${highest}`);
          const msg = new RoverMessage();
          const blockRangePayload = new RoverMessage.RoverBlockRange();
          blockRangePayload.setRoverName(rover);
          blockRangePayload.setHighestHeight(highest);
          blockRangePayload.setLowestHeight(lowest);
          blockRangePayload.setSynced(false);
          msg.setType(RoverMessageType.ROVER_BLOCK_RANGE);
          msg.setRoverBlockRange(blockRangePayload);
          this._rovers.messageRover(data.rover, 'open_block_range_request', msg);
        }
      });

      this._emitter.on('roverSyncStatus', async msg => {
        if (this._chainState) {
          await this._chainState.putSyncStatus(msg.rover, msg.status);
        }
      });

      this._emitter.on('roverBlockRange', async roverRange => {
        /*
         * range protobuf
         *  getRoverName
         *  getHighestHeight
         *  getLowestHeight
         *  getHighestHash
         *  getLowestHash
         */
        const rover = roverRange.getRoverName();
        const requiredBlockCount = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[rover]);
        const roverHasSufficientBlocks = this._miningOfficer._collectedBlocks[rover] && this._miningOfficer._collectedBlocks[rover] > requiredBlockCount && this._miningOfficer._collectedBlocks[rover] > 1;
        const currentLatestBlock = await this.persistence.get(`${rover}.block.latest`);

        try {
          if (!roverRange || !roverRange.getRoverName) {
            this._logger.warn('rover range recieved in engine is malformed');
            return;
          }

          // determine if this is an event from the BC p2p module
          if (roverRange.getRoverName() === 'bc') {
            // the rover range to be evaluated is from the BC p2p module
            try {
              //const confirmations = ROVER_CONFIRMATIONS[rover] || 8
              const missingBlocks = await this._persistence.getMissingBlocks(rover, roverRange.getLowestHeight(), roverRange.getHighestHeight(), confirmations);
              const rangeRequest = await this._chainState.closeBlockRangeRequest(rover, roverRange, missingBlocks);
              const { highestHeight, lowestHeight, highestHash, lowestHash } = rangeRequest;
              if (rangeRequest.notifyRover) {
                this._node.setBlockRange([highestHeight, lowestHeight], [highestHash, lowestHash]);
              } else {
                // apply reorg
                //const block = await this.persistence.getBlockByHash(highestHash, rover)
              }
            } catch (err) {
              debug(err);
            }
          } else if (this._rovers._roverSyncStatus[rover] === true && roverHasSufficientBlocks) {
            // the rover range to be evaluated is from the Rovers
            // LDL
            debug(`rover ${roverRange.getRoverName()} close block range claim received ${roverRange.getHighestHeight()} ${roverRange.getRoverName()} - ${roverRange.getLowestHeight()} ${roverRange.getRoverName()}`);
            const rover = roverRange.getRoverName();
            const confirmations = ROVER_CONFIRMATIONS[rover] || 8;
            const areRoversSynced = await this.persistence.isBlockchainSynced(rover, {
              givenLowestHeight: await this._chainState.getRangeLowestHeight(rover),
              givenHighestHeight: await this._chainState.getLatestBlockHeight(rover),
              returnRangeIfMissing: true,
              chainState: this._chainState
            });
            let missingBlocks = [];
            // LDL
            debug(`rover ${roverRange.getRoverName()} about to run close block missingBlocks BEFORE are rovers synced : ${missingBlocks.length}`);
            let s = true;
            if (!areRoversSynced) {
              s = false;
            } else if (areRoversSynced.length > 0) {
              s = false;
              missingBlocks = missingBlocks.concat(areRoversSynced);
            }
            // LDL
            debug(`rover ${roverRange.getRoverName()} about to run close block range claim with missingBlocks: ${missingBlocks.length}, confirmations: ${confirmations} s: ${s} printing are rovers synced`);
            const rangeRequest = await this._chainState.closeBlockRangeRequest(rover, roverRange, missingBlocks);
            const { highestHeight, lowestHeight, highestHash, lowestHash } = rangeRequest;
            if (rangeRequest.notifyRover && !s && parseInt(currentLatestBlock.getHeight(), 10) < highestHeight) {
              const msg = new RoverMessage();
              const blockRangePayload = new RoverMessage.RoverBlockRange();

              blockRangePayload.setRoverName(rover);
              blockRangePayload.setHighestHeight(highestHeight);
              blockRangePayload.setLowestHeight(lowestHeight);
              blockRangePayload.setHighestHash(highestHash);
              blockRangePayload.setLowestHash(lowestHash);
              blockRangePayload.setSynced(s);

              msg.setType(RoverMessageType.ROVER_BLOCK_RANGE);
              msg.setRoverBlockRange(blockRangePayload);

              debug(`rover ${roverRange.getRoverName()} opened block range request ${highestHeight} ${rover} <- ${lowestHeight} ${rover}`);
              this._rovers.messageRover(rover, 'open_block_range_request', msg);
            } else if (highestHash && highestHeight) {
              let currentLatestBlockHeight = await this._chainState.getLatestBlockHeight(rover);
              const block = await this.persistence.getBlockByHeight(highestHeight, rover);
              this._logger.info(`currentLatestBlockHeight: ${currentLatestBlockHeight} highestHeight: ${highestHeight}`);
              debug(`block range request already open ${highestHeight} ${rover} <- ${lowestHeight} ${rover}`);
              // conduct reorg
              if (block && new _externals.BN(block.getHeight()).gt(new _externals.BN(currentLatestBlockHeight))) {
                //
                // reput the block in case there are external operations to run
                //
                if (rover !== 'bc') {
                  this.miningOfficer._collectedBlocks[rover] += 1;
                }
              }
            }
          }
        } catch (err) {
          debug(err);
        }
        // this._chainState.printState()
      });

      setInterval(async () => {

        //const synced = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`)
        //if (synced && synced === 'complete') {
        //  if (this._lastCollectedBlockTime && Math.floor(Date.now() / 1000) - 9 > this._lastCollectedBlockTime) {
        //    const roverList = []
        //    for (let key of this._knownRovers) { roverList.push(key) }
        //    await this.miningOfficer.newRoveredBlock(roverList, false, this._blockCache, true, this._knownFullBlocksCache, this._emblemPerformance)
        //  }

        //  //if (this._roveredBlocksToProcess.length > 0) {
        //  //  for (const b of this._roveredBlocksToProcess) {
        //  //    const block = this._roveredBlocksToProcess.shift()
        //  //    this._blockQueue.push(block, (err) => {
        //  //      this._lastCollectedBlockTime = Math.floor(Date.now() / 1000)
        //  //      if (err) {
        //  //        this._logger.error(err)
        //  //      } else {
        //  //        debug(`block ${block.getHeight()} ${block.getBlockchain()} added to queue`)
        //  //      }
        //  //    })
        //  //  }
        //  //}
        //}


      }, 9000);

      this._roverEmitter.on('collectBlock', async ({ block }) => {
        //const synced = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`)
        //if (synced && synced === 'complete') {
        this._blockQueue.push(block, err => {
          this._lastCollectedBlockTime = Math.floor(Date.now() / 1000);
          if (err) {
            this._logger.error(err);
          } else {
            debug(`block ${block.getHeight()} ${block.getBlockchain()} added to queue`);
          }
        });
        //} else {
        //let found = false
        //for (const b of this._roveredBlocksToProcess) {
        //  if (found) continue
        //  if (b.getHash && b.getHash() === block.getHash()) {
        //    found = true
        //    break
        //  }
        //}
        //if (!found) {
        //  this._roveredBlocksToProcess.push(block)
        //}
        //}
      });
      this._logger.info('mining controller initialized');
    }).catch(err => {
      console.trace(err);
      this._logger.info(new Error('critical error <- protocol shutdown in progress...'));
      this._rovers.killRovers();
      process.exit(3);
    });
  }

  async blockFromRover(block) {

    try {

      debug(`events on emitter emitter ${this._emitter._eventsCount}`);
      debug(`events on rover emitter ${this._roverEmitter._eventsCount}`);
      debug(`events on utxo emitter ${this._utxoEventEmitter._eventsCount}`);
      debug(`events on async emitter ${this._asyncEmitter._eventsCount}`);

      // Persist block if needed
      if (PERSIST_ROVER_DATA === true) {
        this._writeRoverData(block);
      }

      // if a block is recieved from rover set connection sync status to true (this is only means the rover is recieving updates from it's respective network and not that the local blockchain is 'synced')
      if (!block || !block.getPreviousHash) {
        this._logger.warn(`malformed hash`);
        return;
      }

      const rover = block.getBlockchain ? block.getBlockchain().toLowerCase() : BC_SUPER_COLLIDER;

      if (!this._metrics.rovers[rover]) {
        this._metrics.rovers[rover] = {
          latency: Math.floor(Date.now() / 1000)
        };
      }

      if (BC_PM2) {
        if (this._pm2[rover + '.block.latency']) {
          if (this._metrics.rovers[rover].latency !== Math.floor(Date.now() / 1000)) {
            const ld = Math.floor(Date.now() / 1000) - this._metrics.rovers[rover].latency;
            this._metrics.rovers[rover].latency = Math.floor(Date.now() / 1000);
            this._pm2[rover + '.block.latency'].update(ld);
          }
        }
      }

      if (block.getBlockchain && block.getBlockchain() === 'eth' && parseInt(block.getHeight(), 10) < 12390428) {
        const rlbe = await this.persistence.get(`${rover}.block.latest`);
        if (rlbe) {
          debug(`indexing pre-berlin block: ${block.getHeight()}-${block.getHash()}`);
          await this.persistence.putBlock(block, 0, rover, { rovered: false });
          await this.persistence.put(`${block.getBlockchain()}.block.${block.getHash()}`, block);
          await this.persistence.putBlockHashAtHeight(block.getHash(), block.getHeight(), block.getBlockchain());
          this.persistence._blockByHeightCache.set(`${block.getBlockchain()}.block.${block.getHeight()}`, block);
          return;
        }
      }

      const requiredBlockCount = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[rover]);
      const blockHeight = block.getHeight();
      const blockHash = block.getHash();
      const blockPreviousHash = block.getPreviousHash();
      const cacheKey = `${rover}:${blockHash}`;
      let roverHasSufficientBlocks = this._miningOfficer._collectedBlocks[rover] && new _externals.BN(this._miningOfficer._collectedBlocks[rover]).gte(new _externals.BN(requiredBlockCount - 1)) && this._miningOfficer._collectedBlocks[rover] !== 0;
      let roverLatestBlock = await this.persistence.get(`${rover}.block.latest`);
      let updatedLatestBlock = true;
      const latestBlockHeight = roverLatestBlock ? parseInt(roverLatestBlock.getHeight(), 10) : 8;
      const multichainSyncStatus = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);

      if (roverLatestBlock && roverLatestBlock.getHeight) {
        debug(`${rover} latest: ${roverLatestBlock.getHeight()} distance latest ${blockHeight - latestBlockHeight} (${blockHeight})`);
      }

      debug(`rover block received: ${blockHeight}, latest block: ${latestBlockHeight}`);

      let allRoversHaveSufficientBlocks = this._miningOfficer._knownRovers.reduce((roverState, chain) => {

        if (roverState) {
          const minBlockCount = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[chain]);
          const chainSuff = this._miningOfficer._collectedBlocks[chain] && this._miningOfficer._collectedBlocks[chain] >= minBlockCount && this._miningOfficer._collectedBlocks[chain] > 1;
          return chainSuff;
        } else {
          return false;
        }
      }, true);

      // store the block to restart the rover work after block is discovered
      if (allRoversHaveSufficientBlocks && this._lastCollectedBlock[rover] && block && block.getHash && this._lastCollectedBlock[rover].getHash() === block.getHash()) {

        //this._blockQueue.process()
        this._logger.info(`direct injection of work from previously rovered <- ${block.getHash()}`);
        const roverList = [];
        for (let key of this._knownRovers) {
          roverList.push(key);
        }
        //await this.miningOfficer.newRoveredBlock(roverList, false, this._blockCache, true, this._knownFullBlocksCache, this._emblemPerformance)
        return;
      } else {
        this._lastCollectedBlock[rover] = block;
      }

      if (!this._roverTimeTable[rover]) {
        this._roverTimeTable[rover] = {
          updated: Math.floor(Date.now() / 1000),
          start: Math.floor(Date.now() / 1000),
          edge: false
        };
      } else {
        this._roverTimeTable[rover].updated = Math.floor(Date.now() / 1000);
      }

      if (this._chainState) {
        await this._chainState.putSyncStatus(rover, true);
      }

      if (rover === 'eth' && !BC_MINER_MUTEX) {
        this._emblemPerformance = await this.setEmblemPerformance();
      }

      if (!allRoversHaveSufficientBlocks) {
        const roverState = this._miningOfficer.printState(this._emblemPerformance);
        allRoversHaveSufficientBlocks = Object.keys(roverState).reduce((all, b) => {
          if (all === true) {
            all = roverState[b];
          }
          return all;
        }, true);
      }

      if (!allRoversHaveSufficientBlocks) {
        allRoversHaveSufficientBlocks = await this._miningOfficer.getState(this._emblemPerformance);
        roverHasSufficientBlocks = allRoversHaveSufficientBlocks;
      }

      if (this._knownBlocksCache.has(cacheKey)) {
        debug(`block from rover already processed`);
        return;
      } else {
        this._knownBlocksCache.set(cacheKey, true);
      }

      if (roverLatestBlock && BC_MINER_BOOT) {
        this._logger.info(`${rover} rover is being returned from miner boot`);
        //return
      }

      if (!roverLatestBlock) {
        await this.persistence.putLatestBlock(block, rover, {
          chainState: this._chainState
        });
        await this.persistence.put(`${block.getBlockchain()}.block.latest.height`, new _externals.BN(block.getHeight()).toNumber());
        roverLatestBlock = block;
        updatedLatestBlock = true;
      } else if (roverLatestBlock && block && parseInt(roverLatestBlock.getHeight(), 10) < parseInt(block.getHeight(), 10)) {
        await this.persistence.putLatestBlock(block, rover, {
          chainState: this._chainState
        });
        roverLatestBlock = block;
        updatedLatestBlock = true;
      } else if (roverLatestBlock && block && parseInt(roverLatestBlock.getHeight(), 10) === parseInt(block.getHeight(), 10) && roverLatestBlock.getHash() !== block.getHash()) {
        await this.persistence.putLatestBlock(block, rover, {
          chainState: this._chainState
        });
        roverLatestBlock = block;
        updatedLatestBlock = true;
      }

      // lite check to determine if ths block is the immediate next block, requires access to persistence for full check
      for (let key of this._knownRovers) {
        if (key !== BC_SUPER_COLLIDER) {
          const reqCountBlock = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[key]);
          if (this._miningOfficer._collectedBlocks[key] && new _externals.BN(this._miningOfficer._collectedBlocks[key]).lt(new _externals.BN(reqCountBlock))) {
            this._rovers._roverSyncStatus[key] = false;
          } else {
            this._rovers._roverSyncStatus[key] = true;
          }
        }
      }

      if (BC_LOW_POWER_MODE) {
        this._logger.info(`node is opperating in low power mode <- rovered block only minmally validated: ${rover} -> ${block.getHeight()}`);
      }

      if (block.getBlockchain && block.getBlockchain() === 'lsk' && block.getHash().length > 60 && parseInt(block.getHeight(), 10) > VALIDATION_GAP_BC_HEIGHT_INTERVAL[0] && parseInt(block.getHeight(), 10) < VALIDATION_GAP_BC_HEIGHT_INTERVAL[1]) {
        this._logger.info(`lsk block ${block.getHeight()}:${block.getHash()} interval window`);
        const ch = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.latest.height`);
        if (parseInt(ch, 10) > 4851565 && parseInt(ch, 10) < 4851965) {
          // 538427c3a2c8ed560a2b21dc20ae6c5281707be4ac5e8d1ebffa538ec9e1e123
          let latestLsk = await this.persistence.get(`lsk.block.latest`);

          if (block.getHash().length > 60) {
            this._logger.info(`successful migration to interval window`);
            await this.persistence.put(`lsk.block.latest`, block);
          }
        } else if (parseInt(ch, 10) < 4851565) {

          return;
        }
      }

      if (rover !== 'bc') {
        this.miningOfficer._collectedBlocks[rover] += 1;
      }
      //if (multichainSyncStatus && multichainSyncStatus === 'pending') {
      //  const oLatestBlock = await this.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`)
      //  const oHighestEdge = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`)
      //  if (oHighestEdge && oLatestBlock && oLatestBlock.getHeight) {
      //    if (oLatestBlock.getHeight() + 10 < oHighestEdge) {
      //      this._logger.info(`${rover} rover sent ${blockHeight} sync: ${multichainSyncStatus}, highest: ${oHighestEdge}, latest: ${oLatestBlock.getHeight()}`)
      //      return
      //    }
      //  } else {
      //    this._logger.info(`${rover} rover sent  ${blockHeight} sync is ${multichainSyncStatus}`)
      //    return
      //  }
      //}

      // safety check
      if (rover !== BC_SUPER_COLLIDER && !BC_LOW_POWER_MODE) {
        const report = await this.persistence.putBlock(block, 0, rover, { rovered: multichainSyncStatus === 'complete' });
        //const report = await this.persistence.putBlock(block, 0, rover)
        debug(`${rover} rover edge: ${block.getHeight()}, latest edge: ${roverLatestBlock.getHeight()}, hash: ${roverLatestBlock.getHash().slice(0, 12)}...`);
        if (report && report.purgeBlocksTo && block.getHeight() > 7000000) {
          /*
           *  dont accept bad marked txs in blocks
           */
          const safeRoverBlock = await this.persistence.getBlockByHash(report.purgeBlocksTo, rover, { cached: false });
          if (safeRoverBlock) {
            const safeBlockHashes = await this.persistence.getRootedBlockFromBlock(safeRoverBlock, [], { returnParents: true });
            if (safeBlockHashes && safeBlockHashes.length > 0) {
              const safeHash = last(safeBlockHashes);
              const safeBlock = await this.persistence.getBlockByHash(safeHash, BC_SUPER_COLLIDER, { cached: false });
              const latestBlock = await this.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
              if (safeBlock && latestBlock) {
                rebaseWorkers();
                this._logger.info(`moving to secure block at ${BC_SUPER_COLLIDER} ${safeBlock.getHeight()} : ${safeBlock.getHash()}`);
                await this.persistence.put(`${BC_SUPER_COLLIDER}.block.reorgfrom`, safeBlock);
                await this.persistence.put(`${BC_SUPER_COLLIDER}.block.reorgto`, latestBlock);
                await this.persistence.reorgBlockchain({ force: true, iterateUp: false });
                await this.reorgTxPendingPool();
                await this.persistence.put(`${BC_SUPER_COLLIDER}.block.latest`, safeBlock);

                // continue on and start mining
              } else {
                this._logger.error(`unable to determine safe block hashes for ${rover} rovered block ${block.getHeight()} <- critical error ${BC_SUPER_COLLIDER} suggest shutdown...`);
                //await this.forceExit()
              }
            } else {
              this._logger.error(`unable to secure root for ${rover} rovered block ${block.getHeight()} <- critical error ${BC_SUPER_COLLIDER} suggest shutdown...`);
              //await this.forceExit()
            }
          } else {
            this._logger.warn(`unable to determine safe block for ${rover} rovered block ${block.getHeight()} <- critical warning ${BC_SUPER_COLLIDER}`);
          }
        } else if (!report && block) {
          debug(`new ${rover} rovered block ${block.getHeight()} ${BC_SUPER_COLLIDER} ...`);
        }
      } else if (BC_LOW_POWER_MODE) {
        await this.persistence.putBlock(block, 0, rover);
      }

      const hasMount = await this.persistence.getBlockByHash(block.getPreviousHash(), block.getBlockchain());

      if (roverLatestBlock.getHash() !== block.getHash()) {

        debug(`${rover} block ${block.getHeight()} EXTENDS local blockchain ${rover} of hash ${blockHash.slice(0, 21)}`);

        if (rover !== 'bc') {
          this.miningOfficer._collectedBlocks[rover] += 1;
        }

        if (BC_MINER_BOOT) {
          this._logger.info(JSON.stringify(this._rovers._roverSyncStatus));
        }

        // if the rovers sync status is true confirm this chain is synced and pass to the mining officer
        if (this._rovers._roverSyncStatus[rover] === true && roverHasSufficientBlocks || this._rovers._roverSyncStatus[rover] === true && BC_FORCE_ROVERS && BC_MINER_BOOT) {

          const areRoversSynced = await this.persistence.isBlockchainSynced(rover, {
            givenLowestHeight: await this._chainState.getRangeLowestHeight(rover),
            givenHighestHeight: new _externals.BN(roverLatestBlock.getHeight()).toNumber(),
            returnRangeIfMissing: true,
            chainState: this._chainState
          });
          let s = true;
          if (!areRoversSynced) {
            s = false;
          } else if (areRoversSynced.length > 0) {
            s = false;
          }

          if (s || BC_FORCE_ROVERS && BC_MINER_BOOT) {

            if (BC_MINER_BOOT && BC_FORCE_ROVERS) {
              this._logger.warn(`miner boot and force rovers is enabled, node will not function.`);
            }

            const syncComplete = true;
            const roversClaimToBeSynced = this._rovers.areRoversSynced() && syncComplete && roverHasSufficientBlocks && allRoversHaveSufficientBlocks;
            debug(`latest block from ${rover} rover stored and local chain is synced -> all rovers reporting synced: ${roversClaimToBeSynced}`);
            const v = values(this._rovers._roverSyncStatus);
            const allClaimSync = v.reduce((all, mv) => {
              if (all) {
                if (mv !== all) {
                  return false;
                }
              }
              return all;
            }, true);

            debug(`rovers reporting ${v.length}/${this._knownRovers.length}, link assertion required: ${allClaimSync}, all rovers have sufficient blocks: ${allRoversHaveSufficientBlocks}`);

            if (allClaimSync === true && roversClaimToBeSynced === true) {
              if (BC_BUILD_GENESIS) {
                await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'complete');
              }
              const fullBlockCache = roversClaimToBeSynced ? this._knownFullBlocksCache : false;
              await this._chainState._persistence.put(`${BC_SUPER_COLLIDER}.work`, block.getHash());

              if (!BC_MINER_BOOT) {
                this.miningOfficer._cleanUnfinishedBlock();
              }

              if (BC_MINER_WORKERS < 1 && !this._relayMode) {
                rebaseWorkers();
              } else {
                try {
                  //await this._workerPool._sendMessage({type: 'segment'})
                } catch (e) {
                  this._logger.error(e.message);
                  rebaseWorkers();
                }
              }

              if (this.throttleUpdate(rover)) {
                debug(`block update would be throttled ${block.getBlockchain()} ${block.getHeight()}`);
                //return
              }
              // broadcast rover block
              if (updatedLatestBlock) {
                const pid = await this.miningOfficer.newRoveredBlock(rovers, block, this._blockCache, roversClaimToBeSynced, fullBlockCache, this._emblemPerformance);
                if (pid !== false) {
                  debug(`collectBlock handler: sent to miner`);
                  return;
                }
              } else {
                debug(`block does not increase edge for mining`);
                return;
              }
            } else if (!syncComplete) {
              this._logger.info(`syncing multiverse...`);
            }
            return;
          }

          if (areRoversSynced.length > 0) {
            debug(`latest block from ${rover} rover stored and chain is NOT synced`);

            let lowest = areRoversSynced[0];

            if (rover === 'eth') {
              const lbcr = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
              const headers = lbcr.getBlockchainHeaders();
              if (lbcr && lbcr.getHash) {
                const lbr = last(headers[chainToGet(rover)]());
                lowest = parseInt(lbr.getHeight(), 10) < lowest ? parseInt(lbr.getHeight(), 10) : lowest;
                lowest = lowest - 10;
              }
            }

            const highest = areRoversSynced[areRoversSynced.length - 1];
            const rangeRequest = await this._chainState.openBlockRangeRequest(rover, highest, lowest, { missingBlocks: areRoversSynced });

            if (rangeRequest.notifyRover && roverHasSufficientBlocks) {

              const msg = new RoverMessage();
              const blockRangePayload = new RoverMessage.RoverBlockRange();
              const { highestHeight, lowestHeight, highestHash, lowestHash } = rangeRequest;
              if (new _externals.BN(highestHeight).gt(new _externals.BN(lowestHeight))) {

                blockRangePayload.setRoverName(rover);
                // set highest height to the given range request
                blockRangePayload.setHighestHeight(highest);
                // set lowest height to the chain states highest
                blockRangePayload.setLowestHeight(lowest);
                blockRangePayload.setSynced(s);

                msg.setType(RoverMessageType.ROVER_BLOCK_RANGE);
                msg.setRoverBlockRange(blockRangePayload);

                debug(`opened block range request ${highest} ${rover} <- ${lowest} ${rover} (${highest - lowest} blocks)`);
                //this._rovers.messageRover(rover, 'open_block_range_request', msg)
              } else {
                this._logger.info(`highest height ${highestHeight} < lowest height ${lowestHeight}`);
              }
            }
          } else {
            debug(`chain state is complete for ${rover} rover`);
          }
        }

        // the block is not considered the net block, if the rover believes it is synced determine if a request must be opened
      } else if (this._rovers._roverSyncStatus[rover] === true && roverHasSufficientBlocks) {

        let opts = {};

        // store the block regardless and this block is not connected do not run any scheduled operations

        if (rover !== 'bc') {
          this.miningOfficer._collectedBlocks[rover] += 1;
        }

        let evaluateRange = [];

        // check with chainstate for the current highest set block
        const currentBlockHighest = await this._chainState.getRangeHighestHeight(rover);
        if (currentBlockHighest) {
          evaluateRange.push(currentBlockHighest);
        }

        // check with chainstate for the current lowest set block
        const currentBlockLowest = await this._chainState.getRangeLowestHeight(rover);
        if (currentBlockLowest) {
          evaluateRange.push(currentBlockLowest);
        }

        // at the given block height to the evaluation range
        evaluateRange.push(blockHeight);

        const latestBlockHeight = await this._chainState.getLatestBlockHeight(rover);
        const latestBlockHash = await this._chainState.getLatestBlockHash(rover);
        const lowestBlockHash = await this._chainState.getRangeLowestHash(rover);
        const lowestBlockHeight = await this._chainState.getRangeLowestHeight(rover);

        if (latestBlockHeight === blockHeight) {
          //this._logger.warn(`storing but not evaluting block given at height ${latestBlockHeight} as it matches the latest block height`)
          //return
        }
        debug(`evaluating given block ${blockHeight} references previous hash ${blockPreviousHash} with latest block ${latestBlockHeight} whose hash is ${latestBlockHash} current highest: ${currentBlockHighest} current lowest: ${currentBlockLowest}`);
        debug(`current block height ${block.getHeight()} with latest block height ${latestBlockHeight}`);
        let prevHeight = 1;
        let forceNotify = false;
        let nextHeight = block.getHeight();
        if (latestBlockHeight && latestBlockHeight !== parseInt(block.getHeight(), 10)) {
          if (new _externals.BN(block.getHeight()).gte(new _externals.BN(latestBlockHeight))) {
            const latestBlock = await this.persistence.get(`${rover}.block.latest`);
            if (!latestBlock) {
              // DEBUG
              prevHeight = new _externals.BN(latestBlockHeight).toNumber();
              nextHeight = block.getHeight();
              evaluateRange.length = 0;
              // DEBUG
              debug(`pushing prevHeight: ${prevHeight}`);
              debug(`pushing block.getHeight(): ${nextHeight}`);
              evaluateRange.push(prevHeight); // prepare for reorgs
              evaluateRange.push(block.getHeight()); // prepare for reorgs
            } else {
              // DEBUG
              // we do not have the blocks on disk to complete the higher block
              const rootBlock = await this.persistence.getRootBlockFromBranch(latestBlock, block);
              debug(`about to print rootblock`);
              debug(rootBlock && rootBlock.toObject ? rootBlock.toObject() : rootBlock);
              if (!rootBlock && parseInt(block.getHeight(), 10) > parseInt(latestBlock.getHeight(), 10)) {
                // DEBUG
                prevHeight = new _externals.BN(latestBlockHeight).sub(new _externals.BN(1)).toNumber();
                debug(`pushing prevHeight: ${prevHeight}`);
                debug(`pushing block.getHeight(): ${nextHeight}`);
                this._logger.info(`seeking range size: ${nextHeight - prevHeight}`);
                evaluateRange.length = 0;
                evaluateRange.push(prevHeight); // prepare for reorgs
                evaluateRange.push(parseInt(block.getHeight(), 10)); // prepare for reorgs
              } else if (!rootBlock.getHash) {
                // DEBUG
                // if the sequence is not available on disk it will give you the height to request
                const rootBn = rootBlock;
                if (!isNaN(rootBn)) {
                  evaluateRange.length = 0;
                  evaluateRange.push(rootBn);
                  evaluateRange.push(nextHeight); // prepare for reorgs
                }
              } else if (new _externals.BN(latestBlockHeight).lt(new _externals.BN(block.getHeight())) && latestBlockHash !== block.getPreviousHash()) {
                this._logger.info(`multiverse change occured ${rover} ${block.getHeight()} from height ${latestBlockHeight}`);
                // send to miner no need to notify rover as chain is on disk
                if (this._chainState) {
                  await this._chainState.putSyncStatus(rover, true);
                }
                const syncComplete = true;
                const roversClaimToBeSynced = this._rovers.areRoversSynced() && syncComplete && allRoversHaveSufficientBlocks;
                const v = values(this._rovers._roverSyncStatus);
                const allClaimSync = v.reduce((all, mv, i) => {
                  if (all) {
                    if (mv !== all) {
                      return false;
                    }
                  }
                  return all;
                }, true);
                this._logger.info(`rovers reporting ${v.length}/${this._knownRovers.length}, link assertion required: ${allClaimSync}, all rovers have sufficient blocks ${allRoversHaveSufficientBlocks}`);
                if (allClaimSync && roversClaimToBeSynced) {
                  if (BC_BUILD_GENESIS) {
                    await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'complete');
                  }
                  const fullBlockCache = roversClaimToBeSynced ? this._knownFullBlocksCache : false;
                  await this._chainState._persistence.put(`${BC_SUPER_COLLIDER}.work`, block.getHash());

                  if (!BC_MINER_BOOT) {
                    this.miningOfficer._cleanUnfinishedBlock();
                  }

                  if (BC_MINER_WORKERS < 1 && !this._relayMode) {
                    rebaseWorkers();
                  } else {
                    try {
                      //await this._workerPool._sendMessage({type: 'segment'})
                    } catch (e) {
                      this._logger.error(e.message);
                      rebaseWorkers();
                    }
                  }
                  // broadcast rovered block
                  if (this.throttleUpdate(rover)) {
                    this._logger.info(`block update throttled ${block.getBlockchain()} ${block.getHeight()}`);
                    //return
                  }

                  if (updatedLatestBlock) {
                    const pid = await this.miningOfficer.newRoveredBlock(rovers, block, this._blockCache, roversClaimToBeSynced, fullBlockCache, this._emblemPerformance);
                  } else {
                    this._logger.info(`block edge does not increase with ${block.getBlockchain()} ${block.getHeight()}`);
                  }
                  return;
                } else if (!syncComplete) {
                  this._logger.info(`syncing multiverse...`);
                  return;
                } else {
                  return;
                }
              }
            }
          } else if (new _externals.BN(block.getHeight()).gt(new _externals.BN(latestBlockHeight))) {
            prevHeight = new _externals.BN(latestBlockHeight).sub(new _externals.BN(1)).toNumber();
            evaluateRange.push(prevHeight); // prepare for reorgs
            evaluateRange.push(latestBlockHeight);
          }
        }

        // assert only numbers in the array
        evaluateRange = evaluateRange.filter(e => {
          if (!isNaN(e)) {
            return e;
          }
        });

        // there must be more than 1 items to establish range
        if (evaluateRange.length > 1) {
          try {
            /*
                const rangeRequest = {
                  highestHeight: false,
                  lowestHeight: false,
                  highestHash: false,
                  lowestHash: false,
                  notifyRover: false
                }
             */
            debug(`${evaluateRange.length} available <- ${evaluateRange}`);

            let s = true;
            evaluateRange.sort((a, b) => {
              if (a > b) {
                return 1;
              }
              if (a < b) {
                return -1;
              }
              return 0;
            });

            let areRoversSynced = false;
            if (latestBlockHeight) {
              areRoversSynced = await this.persistence.isBlockchainSynced(rover, {
                givenLowestHeight: await this._chainState.getRangeLowestHeight(rover),
                givenHighestHeight: new _externals.BN(latestBlockHeight).toNumber(),
                returnRangeIfMissing: true,
                chainState: this._chainState
              });
            }
            if (!areRoversSynced) {
              s = false;
            } else if (areRoversSynced.length > 1) {
              s = false;
              debug(`adding synced range to evaluate complete range ${JSON.stringify(evaluateRange, null, 2)} + ${JSON.stringify(areRoversSynced, null, 2)}`);
              evaluateRange = evaluateRange.concat(areRoversSynced);
            }

            evaluateRange = uniq(evaluateRange);
            evaluateRange.sort((a, b) => {
              if (a > b) {
                return 1;
              }
              if (a < b) {
                return -1;
              }
              return 0;
            });

            let lowest = evaluateRange[0];
            const highest = evaluateRange[evaluateRange.length - 1];
            const highestHash = parseInt(block.getHeight(), 10) === highest ? block.getHash() : await this._chainState.getRangeHighestHash(rover);
            const lowestHash = parseInt(block.getHeight(), 10) === lowest ? block.getHash() : await this._chainState.getRangeLowestHash(rover);
            const currentLowest = await this._chainState.getRangeLowestHeight(rover);
            const syncComplete = true;
            const roversClaimToBeSynced = this._rovers.areRoversSynced() && syncComplete && allRoversHaveSufficientBlocks;
            const v = values(this._rovers._roverSyncStatus);
            const allClaimSync = v.reduce((all, mv) => {
              if (all) {
                if (mv !== all) {
                  return false;
                }
              }
              return all;
            }, true);
            // DEBUG
            debug(`evaluating ${rover} block heights lowest: ${lowest} to highest: ${highest}`);
            debug(`s is ${s}, roversClaimed is ${roversClaimToBeSynced}, allClaimSync is ${allClaimSync}, height greater is ${new _externals.BN(block.getHeight()).lt(new _externals.BN(latestBlockHeight))}`);
            if (roversClaimToBeSynced && allClaimSync) {
              debug(`ignoring given block ${block.getHeight()} is below latest ${latestBlockHeight} and status of rover is synced, lowest ${lowest} <> latest block height ${latestBlockHeight}`);
              const fullBlockCache = roversClaimToBeSynced ? this._knownFullBlocksCache : false;
              await this._chainState._memory.put(`${BC_SUPER_COLLIDER}.work`, block.getHash());
              if (!BC_MINER_BOOT) {
                this.miningOfficer._cleanUnfinishedBlock();
              }
              if (BC_MINER_WORKERS < 1 && !this._relayMode) {
                rebaseWorkers();
              } else {
                try {
                  //await this._workerPool._sendMessage({type: 'segment'})
                } catch (e) {
                  this._logger.error(e.message);
                  rebaseWorkers();
                }
              }
              // broadcast rovered block
              if (updatedLatestBlock) {
                const pid = await this.miningOfficer.newRoveredBlock(rovers, block, this._blockCache, roversClaimToBeSynced, fullBlockCache, this._emblemPerformance);
              } else {
                this._logger.info(`block edge not reached with ${block.getBlockchain()} ${block.getHeight()}`);
              }
              return;
            }

            const rangeRequest = await this._chainState.openBlockRangeRequest(rover, highest, lowest, {
              highestHash,
              lowestHash,
              missingBlocks: areRoversSynced
            });
            debug(`areRoversSynced === ${areRoversSynced}`);
            debug(`s === ${s} ---  1111 --- forceNotify: ${forceNotify} --- s: ${s} --- rangeRequest: ${rangeRequest.notifyRover}`);

            if (s && new _externals.BN(lowest).lt(new _externals.BN(currentLowest)) && currentLowest !== latestBlockHeight) {
              debug(`updated chainstate with given block height ${block.getHeight()} with lowest: ${lowest} and highest: ${highest} evaluation is continuing...`);
            }

            debug(`blockchain: ${rover} notifications for rover: ${rangeRequest.notifyRover} , are rovers synced: ${areRoversSynced}`);

            if (rangeRequest.notifyRover && this._rovers._roverSyncStatus[rover] === true && parseInt(block.getHeight(), 10) > parseInt(latestBlockHeight, 10)) {

              let requestHighest = highest;
              let requestLowest = lowest;
              const msg = new RoverMessage();
              const blockRangePayload = new RoverMessage.RoverBlockRange();
              const { highestHeight, lowestHeight, highestHash, lowestHash } = rangeRequest;

              if (new _externals.BN(highestHeight).gt(new _externals.BN(lowestHeight))) {

                if (highest !== highestHeight) {
                  this._logger.warn(`highest height: ${highest} has overridden Chain State to -> ${highestHeight}`);
                }
                const latestRoveredHeadersKeys = [range(lowest, highestHeight).map(height => `${rover}.block.${height}`)];
                const latestBlockHeaders = await this.persistence.getBulk(latestRoveredHeadersKeys);

                if (latestBlockHeaders) {
                  if (latestRoveredHeadersKeys && latestRoveredHeadersKeys.length === latestBlockHeaders.length) {
                    this._logger.warn(`highest height: ${highest} request overridden -> as ${highestHeight}`);
                    return;
                  }
                  debug(`latest rovered header keys: ${latestRoveredHeadersKeys.length} lowest: ${latestBlockHeaders[0].getHeight()}, highest: ${latestBlockHeaders[latestBlockHeaders - 1].getHeight()}`);
                }

                debug(`opened block range request highest: ${highest} lowest: ${lowest} highestHeight: ${highestHeight}\nhighestHash: ${highestHash} lowestHeight:${lowestHeight} lowestHash:${lowestHash}`);
                blockRangePayload.setRoverName(rover);
                // set highest height to the given range request
                blockRangePayload.setHighestHeight(highestHeight);
                // set lowest height to the chain states highest
                blockRangePayload.setLowestHeight(lowest);
                blockRangePayload.setHighestHash(highestHash);
                blockRangePayload.setLowestHash(lowestHash);
                blockRangePayload.setSynced(s);

                msg.setType(RoverMessageType.ROVER_BLOCK_RANGE);
                msg.setRoverBlockRange(blockRangePayload);

                this._rovers.messageRover(rover, 'open_block_range_request', msg);
              } else {
                this._logger.info(`highest height ${highestHeight} < lowest height ${lowestHeight}`);
              }
            } else {
              if (this._chainState) {
                await this._chainState.putSyncStatus(rover, true);
              }
            }
          } catch (err) {
            this._logger.error(err);
          }
        } else {
          debug(`not enough points to evaluate range: ${evaluateRange}`);
        }
      } else {
        debug(`rover found ${rover} block ${blockHeight} : ${blockHash}`);

        if (rover !== 'bc') {
          this.miningOfficer._collectedBlocks[rover] += 1;
        }
      }
    } catch (err) {
      this._logger.error(err.stack);
      console.log(err);
    }
    return Promise.resolve(true);
  }

  async integrityCheck() {
    try {
      const firstBlock = await this.persistence.get('bc.block.1');
      if (!firstBlock) {
        throw new Error('Fallback to catch to reset first block and sync');
      }
      this._logger.info('chain integrity check running');
      const limit = await this.persistence.stepFrom('bc.block', 1);
      this._logger.info('chain integrity: ' + limit);
      await this.persistence.flushFrom('bc.block', limit);
      return Promise.resolve(limit);
    } catch (err) {
      this._logger.error(err);
      this._logger.warn('unable to use default for integrity check');
      try {
        await this.persistence.putBlock(getGenesisBlock());
        await this.persistence.flushFrom('bc.block', 1);
      } catch (err) {
        this._logger.error(err);
      }
      return Promise.resolve(1);
    }
  }

  /**
   * Takes a range of blocks and validates them against within the contents of a parent and child
   * @param blocks BcBlock[]
   */
  async syncSetBlocksInline(blocks, blockKey) {
    // TODO blockKey never used
    let valid = true;
    if (blocks.length < 100) {
      valid = await this.multiverse.validateBlockSequenceInline(blocks);
    }
    if (valid === false) {
      return Promise.reject(new Error('invalid sequence of blocks')); // Enabled after target
    }
    let tasks = [];
    if (blockKey === undefined) {
      tasks = blocks.map(item => this.persistence.putBlock(item));
    } else {
      tasks = blocks.map(item => this.persistence.put(blockKey + '.bc.block.' + item.getHeight(), item));
    }
    await Promise.all(tasks);
    return Promise.resolve(tasks.length);
  }

  async stepSyncHandler(msg) {
    let cancelSync = false;
    const now = Math.floor(Date.now() * 0.001);
    const { connection, data } = msg;

    // sync is complete emit event
    if (data.low.getHeight() < 3) {
      this._emitter.emit('synccomplete', true);
      this._stepSyncTimestamps.length = 0;
      await this.persistence.put('synclock', getGenesisBlock());
      return;
    }

    let previousTimestamp = now;
    if (this._stepSyncTimestamps.length > 0) {
      previousTimestamp = this._stepSyncTimestamps[this._stepSyncTimestamps.length - 1];
    }

    this._logger.info('sync request returned from peer in ' + (now - previousTimestamp) + ' seconds');
    await this.persistence.put('synclock', data.low);

    const high = max(3, parseInt(data.low.getHeight(), 10));
    const low = max(2, high - 500);
    const getBlockListMessage = {
      connection,
      data: {
        low: low,
        high: high
      }
    };
    if (cancelSync === false) {
      this._emitter.emit('getblocklist', getBlockListMessage);
    }
  }

  /**
   * New block range received from peer handler
   * @param conn Connection the block was received from
   * @param newBlock Block itself
   */
  async blockRangeFromPeer(conn, blocks) {
    const peerBlocksSorted = blocks.sort((a, b) => {
      if (parseInt(a.getHeight(), 10) > parseInt(b.getHeight(), 10)) {
        return -1;
      }
      if (parseInt(a.getHeight(), 10) < parseInt(b.getHeight(), 10)) {
        return 1;
      }
      return 0;
    });

    this._logger.info(`peer blocks low: ${peerBlocksSorted[0]} high: ${peerBlocksSorted[peerBlocksSorted.length - 1]}`);
    const newBlocksRange = await this.persistence.getBlocksByRangeCached(parseInt(peerBlocksSorted[0].getHeight(), 10), parseInt(peerBlocksSorted[peerBlocksSorted.length - 1]));

    this._logger.info(`${blocks.length} blocks sent from peer`);
    this._logger.info(`${newBlocksRange.length} blocks from local`);
    return true;
  }

  async reorgTxPendingPool() {
    let date = Date.now();
    debugReorg('calling reorg txpendingpool');
    let txs = this._txPendingPool.getRawMempool(); //get all txs from mempool
    debugReorg({ txs });
    this._txPendingPool.markTxsAsMined(txs); //clear mempool
    let txs2 = this._txPendingPool.getRawMempool();
    debugReorg({ txs2 });
    for (let tx of txs) {
      let status = await this.processTx(tx, null, true); //attempt to readd them
      debugReorg({ status });
    }
    let txs3 = this._txPendingPool.getRawMempool();
    debugReorg({ txs3 });
    debugReorg(`took ${Date.now() - date}ms`);
    return;
  }

  /**
   * Process Remaing Blocks in Queue
   */
  processBlockQueue() {
    return new Promise((resolve, reject) => {
      if (this._blockQueue && this._blockQueue.length() > 0) {
        let timeout = false;
        let t = setTimeout(() => {
          timeout = true;
        }, 4500);
        this._blockQueue.drain(() => {
          if (timeout) {
            return;
          }
          clearTimeout(t);
          return resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Process Feed TX
   * @param tx Transaction the protobuf transaction to process
   */
  async processFeedTx(tx) {
    await this._feedHandler.processTx(tx);
  }

  /**
   * Process TX
   * @param newTx Transaction the protobuf transaction to process
   * @param conn Connection the tx was received from
   */
  async processTx(newTx, conn, reorg, fromAddress) {

    if (!newTx || !newTx.getHash) {
      debug(`malformed tx submitted`);
      return { status: RpcTransactionResponseStatus.FAILURE, error: 'malformed tx submitted' };
    }

    const txHash = newTx.getHash();

    //if tx is update feed with 0 inputs then processFeedTx instead
    const isFeedTx = await this._feedHandler.isFeedTx(newTx);

    if (isFeedTx) {
      await this._feedHandler.processTx(fromAddress, newTx);
      //this._asyncEmitter.emit('announceTx', {data: newTx,connection: conn})
      //return {status: RpcTransactionResponseStatus.SUCCESS, txHash: txHash}
    }

    const isEvmTx = await this._evmHandler.isEvmTx(newTx);

    if (!reorg) {
      if (this._seenTxsCache.has(txHash)) {
        return { status: RpcTransactionResponseStatus.FAILURE, error: 'Tx Is Already Added' };
      }
    }

    this._seenTxsCache.set(txHash, true);

    try {

      const block = await this.persistence.get(`${BC_SUPER_COLLIDER}.block.last.utxoSaved`);
      if (!block) {
        this._logger.info(`utxo mount not found for tx ${txHash}`);
        return;
      }
      let latestBlockTime = block ? parseInt(block.getTimestamp()) * 1000 : 0;
      let latestTime = Date.now();
      let latestTimeDiff = latestTime - latestBlockTime;
      if (latestTimeDiff > 1000 * 60 * 10) {
        this._logger.info(`latest time permits tx send ${txHash}`);
        this._asyncEmitter.emit('announceTx', { data: newTx, connection: conn });
        return { status: RpcTransactionResponseStatus.SUCCESS, txHash: txHash };
      } else {
        const { err, success } = await this._txHandler.isValidTxError(newTx, { block, latestBlockHeight: block.getHeight() });
        if (success) {
          const wasAdded = await this._txPendingPool.tryAddingNewTx(newTx, block.getHeight() > 4130000);
          if (wasAdded === true) {
            this._asyncEmitter.emit('announceTx', { data: newTx, connection: conn });
            return { status: RpcTransactionResponseStatus.SUCCESS, txHash: txHash };
          } else {
            return { status: RpcTransactionResponseStatus.FAILURE, error: wasAdded };
          }
        } else {
          return { status: RpcTransactionResponseStatus.FAILURE, error: err };
        }
      }
    } catch (err) {
      this._logger.info(`Tx is invalid for reason ${err}`);
      return { status: RpcTransactionResponseStatus.FAILURE, error: err };
    }
  }

  /**
   * Start Server
   *
   * @param opts Options to start server with
   */
  async startServer(opts) {
    await this.server.run(opts);
  }

  async forceExit() {
    this._logger.error(`local multiverse removed, chain to be rebuilt, exiting...`);
    setTimeout(() => {
      console.trace(`critical error exiting after force exit`);
      process.exit();
    }, 5000);
    await this.requestExit();
    process.exit();
  }

  requestExit() {
    ts.stop();
    if (this._chainState) {
      return Promise.all([rebaseWorkers(), rebasePool(), this._rovers.killRovers(), this.node._discovery.leave(this.node._discovery.hash)]);
    } else {
      return Promise.all([rebaseWorkers(), rebasePool(), this._rovers.killRovers()]);
    }
  }

  _writeRoverData(newBlock) {
    const dataPath = ensureDebugPath(`bc/rover-block-data.csv`);
    const rawData = JSON.stringify(newBlock);
    writeFileSync(dataPath, `${rawData}\r\n`, {
      encoding: 'utf8',
      flag: 'a'
    });
  }

  /**
   * Broadcast new block
   *
   * - peers
   * - pubsub
   * - ws
   *
   * This function is called by this._processMinedBlock()
   * @param newBlock
   * @param solution
   * @returns {Promise<boolean>}
   * @private
   */
  async _broadcastMinedBlock(newBlock, solution) {
    if (!newBlock) {
      return Promise.reject(new Error('cannot broadcast empty block'));
    }

    try {
      const frontendWsData = _extends({}, newBlock.toObject(), {
        iterations: solution.iterations,
        timeDiff: solution.timeDiff
      });

      this._knownBlocksCache.set(newBlock.getHash(), true);
      this._knownFullBlocksCache.set(newBlock.getHash(), newBlock);

      this.node.broadcastNewBlock(newBlock);

      this.pubsub.publish('block.mined', {
        type: 'block.mined',
        data: frontendWsData
      });
      debug('broadcasting block challenge ' + newBlock.getHeight() + ' -> considered next block in current multiverse');
      this._logger.debug(`xxxxxx _broadcastMinedBlock before broadcast: getTxCount: ${newBlock.getTxCount()},  ${newBlock.getTxsList().length}`);
      return Promise.resolve(true);
      // NOTE: Do we really need nested try-catch ?
    } catch (err) {
      return Promise.reject(err);
    }

    return Promise.resolve(true);
  }

  /**
   * Processess unfinished mined block after the solution is found
   *
   * @param newBlock
   * @param solution
   * @returns {Promise<boolean>} Promise indicating if the block was successfully processed
   * @private
   */
  async _processMinedBlock(newBlock, solution, innerCalls = 0) {
    // Trying to process null/undefined block

    // store the last time an ol block was itereated
    this._lastOlBlockTime = Math.floor(Date.now() / 1000);

    return new Promise(async (resolve, reject) => {
      try {
        let currentSyncedStatus = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
        if (newBlock === null || newBlock === undefined) {
          this._logger.warn('Failed to process work provided by miner');
          return Promise.resolve(false);
        }

        if (this._lastOlBlock && newBlock && newBlock.getHeight) {
          if (this._lastOlBlock.getHeight() >= newBlock.getHeight() && currentSyncedStatus && currentSyncedStatus === 'complete') {
            this._logger.info(`block submitted slowly: ${newBlock.getHeight()} `);
            this.miningOfficer._cleanUnfinishedBlock();
            return Promise.resolve(false);
          }
        }

        // stop running the minimum header test
        delete this._node._blockHeaderTest;
        let probNext = false;
        const alreadyExists = await this.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
        if (parseInt(newBlock.getHeight(), 10) <= parseInt(alreadyExists.getHeight(), 10) && newBlock.getHash() !== alreadyExists.getHash() && parseInt(newBlock.getTimestamp(), 10) - 30 < parseInt(alreadyExists.getTimestamp(), 10)) {
          this._logger.info(`work is stale ${newBlock.getHeight()} timestamp: ${newBlock.getTimestamp()}, latest timestamp: ${alreadyExists.getTimestamp()}`);
          return Promise.resolve(false);
        }

        // confirm block serialized and deserializes
        const s = newBlock.serializeBinary();
        const e = encodeTypeAndData(MESSAGES.BLOCK, newBlock);
        const d = BcBlock.deserializeBinary(s);

        if (!s || !e || !d || !d.getHash) {
          this._logger.warn(`mined block malformed data structure`);
          return Promise.resolve(false);
        }

        this._knownBlocksCache.set(newBlock.getHash(), true);
        debug(`submitting mined block to current multiverse, txs length: ${newBlock.getTxsList().length}`);

        this._node._SEEN_BLOCKS_MEMORY[parseInt(newBlock.getHeight(), 10)] = 1;
        this._node._SEEN_BLOCKS_MEMORY[newBlock.getHash()] = 1;

        this._logger.info(`passing block ${newBlock.getHeight()}.${newBlock.getHash()} to extend multiverse`);
        const update = `${BC_SUPER_COLLIDER}.work -> ${newBlock.getHash()}`;
        debugExtend(`passing #3 block to multiverse.extendMultiverse ${newBlock.getHeight()} : ${newBlock.getHash()}`);

        const { stored, needsResync, rangeRequest, schedules, assertSyncComplete, blockSendingAlternative } = await this.multiverse.extendMultiverse(newBlock, 'local', true, false);
        this._logger.info(`block from extend multiverse - ${newBlock.getHeight()}.${newBlock.getHash()}, resync: ${needsResync}`);

        if (BC_MINER_BOOT) {
          this._logger.info(`miner boot is active ... exiting <- ${newBlock.getHeight()}.${newBlock.getHash()}`);
          await this._broadcastMinedBlock(newBlock, solution);
          return resolve(true);
        }

        const p = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);

        if (needsResync && rangeRequest && rangeRequest.highestHeight && !blockSendingAlternative && !p && newBlock.getMiner() !== this._minerKey) {
          this._logger.info(`local request highest height: ${rangeRequest.highestHeight} lowest height: ${rangeRequest.lowestHeight}`);
          this._node._knownBlockSegments.clear();
          //this._emitter.emit('requestBlockRange', [rangeRequest.highestHeight - 5, rangeRequest.lowestHeight - 10], 3)
          if (!stored) {
            rebaseWorkers();
          }
        }

        if (stored && !needsResync && !assertSyncComplete) {
          await Promise.all([this._chainState._persistence.put(`${BC_SUPER_COLLIDER}.work`, newBlock.getHash()), this.persistence.putLatestBlock(newBlock, BC_SUPER_COLLIDER), this._broadcastMinedBlock(newBlock, solution)]);
          this._logger.info(`new mined block stored (qualified): ${stored}`);

          //if (Object.keys(this._lastCollectedBlock).length > 0 && this._lastOlBlockTime) {
          //  const cachedBlocks = Object.keys(this._lastCollectedBlock)
          //  const r = cachedBlocks[Math.floor(Math.random()*cachedBlocks.length)]
          //  this._roverEmitter.emit('collectBlock', { block: this._lastCollectedBlock[r] })
          //}
        } else if (stored && !needsResync) {
          this._logger.info(`local miner has built new segment -> ${newBlock.getHeight()}`);
          await Promise.all([this._chainState._persistence.put(`${BC_SUPER_COLLIDER}.work`, newBlock.getHash()), this.persistence.putLatestBlock(newBlock, BC_SUPER_COLLIDER), this._broadcastMinedBlock(newBlock, solution)]);
          this._logger.info(`new mined block stored: ${stored}`);

          if (Object.keys(this._lastCollectedBlock).length > 0 && this._lastOlBlockTime) {
            const cachedBlocks = Object.keys(this._lastCollectedBlock);
            const r = cachedBlocks[Math.floor(Math.random() * cachedBlocks.length)];
            this._roverEmitter.emit('collectBlock', { block: this._lastCollectedBlock[r] });
          }
        } else {
          if (newBlock.getMiner() === this._minerKey) {
            //await this._broadcastMinedBlock(newBlock, solution)
            this._logger.info(`unable to mine on edge mined locally, yielding block -> ${newBlock.getHeight()}`);
            let evalBlock = await this.persistence.getBlockByHash(newBlock.getPreviousHash());
            if (evalBlock && evalBlock.getMiner() === this._minerKey) {
              // attempt to find a non-local mined block if the network connection is unstable
              evalBlock = await this.persistence.getBlockByHeight(newBlock.getHeight() - 1);
            }
            if (evalBlock && evalBlock.getMiner() !== this._minerKey) {
              await this.persistence.reorgBlockchain({
                chainState: this._chainState,
                reorgTo: true,
                toBlock: evalBlock
              });
              await this.reorgTxPendingPool();
            } else {
              await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'pending');
              await this.persistence.delUtxoUnmount();
              const lastUpdate = this._lastOlBlockTime ? Math.floor(Date.now / 1000) - this._lastOlBlockTime : 'NA';
              this._logger.info(`unable mount edge ${newBlock.getHeight()} <- possible network issues: last update ${lastUpdate}, any unmount removed...`);
            }
          } else {
            this._logger.info('unable to mine on latest edge');
            //await this.reorgTxPendingPool()
          }
        }

        if (rangeRequest && rangeRequest.highestHeight && needsResync) {

          if (currentSyncedStatus === 'complete') {
            this._logger.info(`mined block ${newBlock.getHeight()} did not extend multiverse requesting range...`);
            //this._emitter.emit('requestBlockRange', [rangeRequest.highestHeight + 5, rangeRequest.lowestHeight - 5], 2)
          } else {
            debug(`mined block ${newBlock.getHeight()} did not extend multiverse requesting range...pending sync`);
          }
          return resolve(false);
        } else if (!stored && !needsResync) {
          this._logger.warn(`locally mined block ${newBlock.getHeight()} extends multiverse with invalid sequence...`);

          //const stepBackBlock = await this.persistence.getBlockByHeight(newBlock.getHeight() - 2)
          //if (stepBackBlock) {
          //  this._logger.info(`attempting step back ${stepBackBlock.getHeight()}:${stepBackBlock.getHash()}`)
          //  await this.persistence.delBlock(newBlock.getPreviousBLock(), 0, BC_SUPER_COLLIDER)
          //  await this.persistence.putLatestBlock(newBlock, BC_SUPER_COLLIDER, { iterateUp: false, force: true })
          //  await this.reorgTxPendingPool()
          //}
          return resolve(false);
        } else if (stored && !needsResync) {
          // immediately check if there is work available
          return resolve(true);
        }
      } catch (err) {
        console.trace(err);
        this._logger.error(err.message);
        reject(err);
      }
    });
  }
}

exports.Engine = Engine;
exports.default = Engine;