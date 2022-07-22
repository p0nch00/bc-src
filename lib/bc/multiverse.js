'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});


const BN = require('bn.js'); /* eslint no-use-before-define: 0 */
// TODO: Remove ESLINT disable

/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const { all, max, flatten, values, zip, identity, last } = require('ramda');
const uuid = require('uuid');
const LRUCache = require('lru-cache');
const debug = require('debug')('bcnode:multiverse');
const debugExtend = require('debug')('bcnode:multiverse:extend');
const debugLowest = require('debug')('bcnode:multiverselowest');

const { getGenesisBlock } = require('./genesis');
const { ChainState } = require('./chainstate');
const { BlockchainManager } = require('./blockchainmanager');
const {
  isValidBlock,
  validateRequireMountBlock,
  validateBlockSequence,
  validateCoinbase,
  childrenHeightSum,
  childrenHighestBlock,
  childrenLowestBlock
} = require('./validation');
const { getLogger } = require('../logger');
const { sortBlocks } = require('../utils/protoBuffers');
const { ellipsisMiddle } = require('../utils/strings');

const BC_SUPER_COLLIDER = process.env.BC_SUPER_COLLIDER ? process.env.BC_SUPER_COLLIDER.toLowerCase() : 'bc';
const BC_MINER_MUTEX = process.env.BC_MINER_MUTEX === 'true';
const BC_NAIVE = process.env.BC_NAIVE === 'true';
const BC_CHAIN_ID = process.env.BC_CHAIN_ID || 'bc';
const BC_EMBLEM_CHAIN_ID = process.env.BC_EMBLEM_CHAIN_ID || 'eth';
const BC_BUILD_GENESIS = process.env.BC_BUILD_GENESIS === 'true';
const BC_REQUEST_LOG = process.env.BC_REQUEST_LOG === 'true';
const BC_STRICT_SEQ = exports.BC_STRICT_SEQ = process.env.BC_STRICT_SEQ === 'true';

let requestLog = false;

if (BC_REQUEST_LOG) {
  requestLog = require('fs').createWriteStream('requestlog.csv');
}

const chainToGet = chain => `get${chain[0].toUpperCase() + chain.slice(1)}List`;

const getRandomSwitch = () => {
  return Math.floor(Math.random() * (1 - 0)) === 1;
};

class Multiverse {

  constructor(persistence, txPendingPool, rovers, chainState, engine) {
    this._persistence = persistence;
    this._txPendingPool = txPendingPool;
    this._id = uuid.v4();
    this._chain = [];
    this._currentCount = 0;
    this._logger = getLogger(`${BC_SUPER_COLLIDER}.multiverse.${this._id.slice(0, 6)}`, false);
    this._height = 0;
    this._knownRovers = rovers;
    this._created = Math.floor(Date.now() * 0.001);
    this._chainState = false;
    this._engine = engine;
    this._knownBlocksCache = new LRUCache({
      max: 2000
    });
    this._blockchainManager = false;
    if (chainState) {
      this._chainState = chainState;
      this._blockchainManager = new BlockchainManager(BC_CHAIN_ID, BC_EMBLEM_CHAIN_ID, chainState, {
        rovers,
        persistence
      });
    }
  }

  get chainState() {
    if (this._chainState) {
      return this._chainState;
    }
  }

  get blockchainManager() {
    if (this._blockchainManager) {
      return this._blockchainManager;
    }
  }

  get persistence() {
    return this._persistence;
  }

  get txHandler() {
    return this._engine._txHandler;
  }

  get blocks() {
    return this._chain;
  }

  set blocks(blocks) {
    this._chain = blocks;
  }

  get blocksCount() {
    const blocks = this._chain;
    return blocks.length;
  }

  get length() {
    return this._chain.length;
  }

  purge() {
    this._chain.length = 0;
    this._logger.info('metaverse has been purged');
  }

  /**
   * Valid Block Range
   * @returns {*}
   */
  async validateBlockSequenceInline(blocks, mountBlock) {
    if (blocks === undefined || blocks.length < 2) {
      this._logger.warn(`block sequence is less than required minimum length of 2`);
      return { valid: false, schedules: [] };
    }

    const sorted = sortBlocks(blocks, 'desc');
    // check if the actually sequence itself is valid
    const upperBound = sorted[0];
    const lowerBound = sorted[sorted.length - 1];

    if (upperBound.getHeight() === lowerBound.getHeight()) {
      return { valid: true, schedules: [] };
    }

    debug(`validating sequence with upper ${upperBound.getHeight()} to lower ${lowerBound.getHeight()} `);
    const blockchain = upperBound.getBlockchain ? upperBound.getBlockchain() : 'bc';

    // statement block 5A
    if (blockchain === BC_SUPER_COLLIDER && new BN(lowerBound.getTimestamp()).eq(new BN(1590283479)) && new BN(upperBound.getHeight()).eq(new BN(641453)) && lowerBound.getHash() === 'ab4708200a3978f7a5bdda5c2effed2ae9008643f071437d34aaabdf90cb5cd0') {
      return { valid: true, schedules: [] };
    }

    // statement block 5B
    if (blockchain === BC_SUPER_COLLIDER && new BN(lowerBound.getTimestamp()).eq(new BN(1590337524)) && new BN(upperBound.getHeight()).eq(new BN(641453)) && lowerBound.getHash() === 'ab4708200a3978f7a5bdda5c2effed2ae9008643f071437d34aaabdf90cb5cd0') {
      return { valid: true, schedules: [] };
    }

    // statement block 5C (OL message test)
    if (blockchain === BC_SUPER_COLLIDER && new BN(upperBound.getHeight()).eq(new BN(2451598)) && lowerBound.getHash() === '5bb19a82b0a26587ada961ed727481aed0c99358767b0ff69779d56630500437') {
      return { valid: true, schedules: [] };
    }

    // statement block 5C (OL message test 2)
    if (blockchain === BC_SUPER_COLLIDER && new BN(upperBound.getHeight()).lt(new BN(2610000)) && new BN(upperBound.getHeight()).gt(new BN(2440713))) {
      debug(`valid sequence with upper ${upperBound.getHeight()} to lower ${lowerBound.getHeight()} `);
      return { valid: true, schedules: [] };
    }

    // statement block 5C (OL message test 3)
    if (blockchain === BC_SUPER_COLLIDER && new BN(upperBound.getHeight()).lt(new BN(3999000)) && new BN(upperBound.getHeight()).gt(new BN(2711000))) {
      debug(`valid sequence with upper ${upperBound.getHeight()} to lower ${lowerBound.getHeight()} `);
      return { valid: true, schedules: [] };
    }

    if (blockchain === BC_SUPER_COLLIDER && lowerBound.getHeight() === 1) {
      // if at final depth this will equal 1 or the genesis block
      const lowerBoundParent = await this.persistence.get('bc.block.1'); // will always return genesis block
      this._logger.info(`${lowerBoundParent.getHeight()} <- lower bound height [current]`);
      this._logger.info(`${lowerBoundParent.getHash()} <- lower bound hash [current]`);
      this._logger.info(`${lowerBound.getHash()} <- lower bound hash [purposed]`);
      if (lowerBound.getHash() !== lowerBoundParent.getHash()) return Promise.reject(new Error('sync did not resolve to genesis block'));
    } else if (lowerBound.getHeight() === 1) {
      this._logger.warn(`${blockchain} received from rover cannot be of height 1`);
      return { valid: false, schedules: [] };
    }

    // interchange statement block 5C
    if (blockchain === BC_SUPER_COLLIDER && new BN(lowerBound.getHeight()).lt(new BN(2000000))) {
      const validSeqLog = validateBlockSequence(sorted, mountBlock);
      if (!validSeqLog) {
        this._logger.info(`unsequenced block ${lowerBound.getHeight()} : ${lowerBound.getHash()}`);
      }
      return { valid: true, schedules: [] };
    }

    // TODO: Adam lets review if this is still necessary
    return validateBlockSequence(sorted, mountBlock);
  }

  /**
   * Get highest block in Multiverse
   * @returns {*}
   */
  getHighestBlock() {
    return this._chain[0];
  }

  /**
   * Get lowest block by block key
   * @returns {*}
   */
  getLowestBlock() {
    return this._chain[this._chain.length - 1];
  }

  /**
   * check if a block exists
   * @param newBlock
   * @returns {boolean}
   */
  hasBlock(newBlock) {
    if (this._chain.length < 1) {
      return false;
    }

    return this._chain.reduce((state, b) => {
      if (state === true) {
        return state;
      } else if (b.getHash() === newBlock.getHash()) {
        return true;
      }
      return false;
    }, false);
  }

  /**
   * Determines through chainstate if block extends chain
   * @param block New block
   * @returns {boolean}
   */
  async blockExtendsChain(block, latestBlock) {
    debug(`checking if block extends chain ${block.getHeight()}`);
    if (this._blockchainManager) {
      return this._blockchainManager.blockExtendsChain(block, latestBlock);
    }
    return true;
  }

  // async extendMultiverse(newBlock: BcBlock | Block, context: string = 'peer', updateStorage: boolean = true, handleAsNewPeer: boolean = false, address: string = false, replaceLatestBlock: boolean = false){
  //   let date = Date.now()
  //   let rand = Math.random()
  //   let obj = [newBlock, context, updateStorage, handleAsNewPeer, address, replaceLatestBlock];
  //
  //   if(this.persistence._engine.multiverseEvalBlocks.length === 0){
  //     this.persistence._engine.multiverseEvalBlocks.push({obj, date, rand})
  //     this.persistence._engine.multiverseIndexBlocks.push(`${newBlock.getHash()}${date}${rand}`)
  //
  //     let res = await this.extendMultiverseValuation(obj[0],obj[1],obj[2],obj[3],obj[4],obj[5]);
  //     let index = this.persistence._engine.multiverseIndexBlocks.indexOf(`${newBlock.getHash()}${date}${rand}`);
  //     this.persistence._engine.multiverseEvalBlocks.splice(index, 1)
  //     this.persistence._engine.multiverseIndexBlocks.splice(index, 1)
  //     let data = this.persistence._engine.multiverseEvalBlocks[0]
  //     if(data){
  //       let {obj, rand, date} = data
  //       this.persistence._engine._utxoEventEmitter.emit(`extendUpdate.${obj[0].getHash()}.${date}.${rand}`)
  //     }
  //     // logger.info(`${block.getHeight()} validated ${res} within ${Date.now() - date}`)
  //     return res;
  //   }
  //   else {
  //     this.persistence._engine.multiverseEvalBlocks.push({obj, date, rand})
  //     this.persistence._engine.multiverseIndexBlocks.push(`${newBlock.getHash()}${date}${rand}`)
  //
  //     return new Promise((resolve, reject) => {
  //       this.persistence._engine._utxoEventEmitter.once(`extendUpdate.${newBlock.getHash()}.${date}.${rand}`, async () => {
  //         let res = await this.extendMultiverseValuation(obj[0],obj[1],obj[2],obj[3],obj[4],obj[5])
  //         let index = this.persistence._engine.multiverseIndexBlocks.indexOf(`${newBlock.getHash()}${date}${rand}`);
  //         this.persistence._engine.multiverseEvalBlocks.splice(index, 1)
  //         this.persistence._engine.multiverseIndexBlocks.splice(index, 1)
  //         let data = this.persistence._engine.multiverseEvalBlocks[0]
  //         if(data){
  //           let {obj, rand, date} = data
  //           this.persistence._engine._utxoEventEmitter.emit(`extendUpdate.${obj[0].getHash()}.${date}.${rand}`)
  //         }
  //         // logger.info(`${block.getHeight()} validated ${res} within ${Date.now() - date}`)
  //         resolve(res)
  //       })
  //     })
  //   }
  // }

  /**
   * Eval new block and optionally extend multiverse
   * @param block New block
   * @param content string
   * @param updateStorage boolean
   * @param handleAsNewPeer boolean
   * @returns {Object}
   */
  async extendMultiverse(newBlock, context = 'peer', updateStorage = true, handleAsNewPeer = false, address = false, replaceLatestBlock = false, connection = false) {

    /*
     * SUCCESSUL MULTICHAIN EXTEND REQUESTS
     *
     *   SETUP
     *   - evaluate timestamp feasability based on local time
     *   - assert only one block height is proposed at each height for each child chain
     *   - reorg mutex (writable) passed to multiverse
     *   - reorg mutex loaded in all rovers
     *
     *   FACTORS
     *   - block height
     *   - block total difficulty
     *   - rover searching for block range
     *
     *   CASES
     *   - bc block total difficulty is above current difficulty
     *   - bc block height is above
     *   - child block height above current local chain
     *   - child block difficulty -- do we evaluate this?
     *
     *   - notify rovers of missing range
     *   - update ranges missing and determine if they replace the currenct branch
     *
     */

    const minerKey = `${newBlock.getHeight()}${newBlock.getMiner()}`;
    let date = Date.now();
    debugExtend(`extending multiverse on ${newBlock.getHeight()}:${newBlock.getHash()} with currentCount ${this._currentCount}`);
    this._currentCount = this._currentCount + 1;

    if (!newBlock) {
      this._logger.warn(' extendMultiverse() no block was given to evaluate');
      return Promise.resolve({ valid: false, stored: false, needsResync: false, rangeRequest: false });
    }

    if (this._knownBlocksCache.has(newBlock.getHash())) {
      this._logger.info(`block processed: ${newBlock.getHash()}`);
      return Promise.resolve({
        valid: true,
        stored: true,
        needsResync: false,
        rangeRequest: false,
        assertSyncComplete: false
      });
    } else if (this._knownBlocksCache.has(minerKey)) {
      this._logger.info(`local block already processed: ${newBlock.getHeight()}`);
      return Promise.resolve({
        valid: true,
        stored: true,
        needsResync: false,
        rangeRequest: false,
        assertSyncComplete: false
      });
    } else {
      this._knownBlocksCache.set(newBlock.getHash(), true);
      this._knownBlocksCache.set(minerKey, true);
    }

    const remount = await this.persistence.get(`${BC_SUPER_COLLIDER}.remount`);
    if (remount) {
      this._logger.warn(`remount detected ${remount}`);
      //await this.persistence.del(`${BC_SUPER_COLLIDER}.remount`)
    }

    let externalOps = [];
    let syncComplete = false;
    let low = this._chainState ? await this._chainState.getRangeLowestHeight(BC_SUPER_COLLIDER) : 0;
    /////////////////////////
    let dateGetLowestHeight = Date.now();

    const blockchain = !newBlock.getBlockchain ? BC_SUPER_COLLIDER : newBlock.getBlockchain();
    const now = Date.now();
    const nowSecondsBound = Math.floor(now / 1000) + 155;
    let synced = await this.persistence.get(`${blockchain}.sync.initialsync`);
    let latestBlock = replaceLatestBlock ? replaceLatestBlock : await this.persistence.get(`${blockchain}.block.latest`);
    /////////////////////////
    let dateGetLatestBlock = Date.now();
    const latestBlockHeight = parseInt(latestBlock.getHeight(), 10);
    const latestBlockHash = latestBlock.getHash();
    const extendsChainBound = newBlock && newBlock.getTimestamp && newBlock.getTimestamp() < nowSecondsBound;
    const extendsChainState = extendsChainBound ? await this.blockExtendsChain(newBlock, latestBlock) : false;
    let dateBlockExtendsChain = Date.now();

    if (extendsChainState) {
      // immediately lock this in as the next block
      await this.persistence.put(`${blockchain}.block.latest.hash`, newBlock.getHash());
      await this.persistence.put(`${blockchain}.block.latest.height`, new BN(newBlock.getHeight()).toNumber());
    }

    //await this.persistence.putBlock(newBlock, 0, blockchain, {asHeader: false, saveHeaders: true, context: context})
    //await this.persistence.putBlock(newBlock, 0, blockchain, {asHeader: false, saveHeaders: false, context: context})

    this._knownBlocksCache.set(newBlock.getHash(), true);

    let datePutBlock = Date.now();

    if (new BN(newBlock.getHeight()).gt(new BN(latestBlock.getHeight())) && new BN(latestBlock.getTimestamp()).lt(new BN(newBlock.getTimestamp())) && // the timestamp is below the latest block but the height is higher
    synced === 'complete' && !extendsChainBound && newBlock.getHeight() > 7600092) {
      this._logger.warn(`unlinked timing <- ${blockchain} latest: ${latestBlockHeight} ${newBlock.getHeight()} extends chain: ${extendsChainState}`);
      return Promise.resolve({
        valid: false,
        stored: false,
        needsResync: false,
        rangeRequest: false,
        assertSyncComplete: syncComplete
      });
    }
    // if(latestBlock.getHeight() > newBlock.getHeight()){
    //   this._logger.warn(`latest block ${latestBlock.getHeight()} is greater than ${newBlock.getHeight()}`);
    //   return Promise.resolve({valid: false, stored: false, needsResync: false, rangeRequest: false, assertSyncComplete: syncComplete})
    // }

    this._logger.info(`[] <- latest: ${latestBlockHeight}:${latestBlockHash.slice(0, 8)} ${newBlock.getHeight()}:${newBlock.getHash().slice(0, 8)}:${newBlock.getPreviousHash().slice(0, 8)} extends chain: ${extendsChainState} took ${Date.now() - date}ms`);
    debug(`${newBlock.getHeight()} putBlock: ${datePutBlock - dateBlockExtendsChain}`);
    debug(`${newBlock.getHeight()} extendsChain: ${dateBlockExtendsChain - dateGetLatestBlock}`);
    debug(`${newBlock.getHeight()} getLatest: ${dateGetLatestBlock - dateGetLowestHeight}`);
    debug(`${newBlock.getHeight()} getLowest: ${dateGetLowestHeight - date}`);
    this._currentCount = this._currentCount - 1;
    // remove when REN is installed
    if (blockchain !== BC_SUPER_COLLIDER) {
      this._logger.warn(`blockchain for block outside of ${BC_SUPER_COLLIDER} multiverse`);
      return Promise.resolve({
        valid: false,
        stored: false,
        needsResync: false,
        rangeRequest: false,
        assertSyncComplete: syncComplete
      });
    }

    if (latestBlock && latestBlock.getHeight() > 1 && newBlock.getPreviousHash() === latestBlock.getHash()) {
      if (new BN(newBlock.getHeight()).gt(new BN(2493727))) {
        const latestBlockChildSum = childrenHeightSum(latestBlock);
        const newBlockChildSum = childrenHeightSum(newBlock);
        if (latestBlockChildSum >= newBlockChildSum) {
          this._logger.info(`new block ${newBlock.getHeight()} failed to increase weight`);
          return Promise.resolve({
            stored: false,
            needsResync: false,
            rangeRequest: false,
            schedules: [],
            remount: false,
            assertSyncComplete: syncComplete
          });
        }
      }
    }

    if (latestBlock.getHash() === newBlock.getHash() && context === 'peer') {
      this._logger.info(`latest block hash is equal to the block: ${newBlock.getHash()}`);
      return Promise.resolve({
        stored: true,
        needsResync: false,
        rangeRequest: false,
        schedules: [],
        assertSyncComplete: syncComplete,
        remount: false,
        blockSendingAlternative: true
      });
    }

    const isolatedValid = isValidBlock(newBlock);

    if (!isolatedValid) {
      /// UUU
      debugExtend(`block failed isolated valid test`);
      return Promise.resolve({
        stored: false,
        needsResync: false,
        rangeRequest: false,
        schedules: [],
        assertSyncComplete: syncComplete,
        remount: false,
        blockSendingAlternative: true
      });
    }

    const peerExpired = await this.persistence.processPeerExpiration({ chainState: this._chainState });
    // if peer has expired there will be no value for currentPeer
    let currentPeer = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
    let edge = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);
    let dlh = false;
    let highest = 0;
    let lowest = 0;
    let foundRootBlockToMountBranch = false;
    let rootBlock = false;
    let validCoinbase = true;
    const dls = await this.persistence.get(`${BC_SUPER_COLLIDER}.data.latest`);
    const reorgFromBlock = await this.persistence.get(`${blockchain}.block.reorgfrom`);
    if (reorgFromBlock && parseInt(newBlock.getHeight(), 10) > parseInt(reorgFromBlock.getHeight(), 10)) {
      // LDL
      debugExtend(`multichain is updating <- storing block for future evaluation`);
    }

    const purposedBlockChildHeightSum = childrenHeightSum(newBlock);
    const latestBlockChildHeightSum = childrenHeightSum(latestBlock);
    debugExtend('child height new block #' + newBlock.getHeight() + ' with connected chain total ' + purposedBlockChildHeightSum);
    debugExtend('latest height new block #' + latestBlock.getHeight() + ' with connected chain total ' + latestBlockChildHeightSum);

    // MMP
    if (!newBlock.getBlockchain && new BN(purposedBlockChildHeightSum).gt(new BN(latestBlockChildHeightSum)) && (latestBlock.getHeight() - 30 < newBlock.getHeight() || latestBlock.getTimestamp() + 30 < newBlock.getTimestamp())) {
      debugExtend(`preparing coinbase evaluation ${newBlock.getHeight()} extends chain: ${extendsChainState}`);
      if (!extendsChainState && newBlock.getHeight() === latestBlock.getHeight() && newBlock.getHash() !== latestBlock.getHash() && newBlock.getPreviousHash() === latestBlock.getPreviousHash()) {
        // yield evaluation of coinbase to look at other features of the purposed block
        //validCoinbase = true
        validCoinbase = await validateCoinbase(newBlock, this.persistence, this._engine, this.txHandler, this._engine._txPendingPool, this._engine._utxoManager, 'bc.multiverse');
      } else if (extendsChainState) {
        debug(`evaluating coinbase of ${newBlock.getHeight()}:${newBlock.getHash()}`);
        validCoinbase = await validateCoinbase(newBlock, this.persistence, this._engine, this.txHandler, this._engine._txPendingPool, this._engine._utxoManager, 'bc.multiverse');
      }
    }

    if (validCoinbase && currentPeer && extendsChainState) {
      debug(`open waypoint request detected: ${newBlock.getHeight()} ${newBlock.getHash()}`);
    }

    if (!validCoinbase) {
      this._logger.info(`validation failed on ${newBlock.getHeight()}:${newBlock.getHash()}`);

      if (newBlock.getHeight() === latestBlock.getHeight()) {
        this._logger.info(`height already evaluated ${newBlock.getHeight()}:${newBlock.getHash()}`);

        return Promise.resolve({
          valid: false,
          stored: false,
          needsResync: false,
          rangeRequest: false,
          schedules: [],
          assertSyncComplete: syncComplete,
          remount: true
        });
      }
    }

    if (dls) {
      dlh = parseInt(dls.split(':')[0], 10);
    }

    if (blockchain === BC_SUPER_COLLIDER) {

      const rm = await this.persistence.get(`${BC_SUPER_COLLIDER}.remount`);

      if (rm) {
        this._logger.warn(`remount lock ${rm}`);
        const mountHeight = rm.split(':')[0];
        const mountHash = rm.split(':')[1];
        await this.persistence.del(`${BC_SUPER_COLLIDER}.remount`);
        const rb = await this.persistence.getBlockByHash(mountHash, BC_SUPER_COLLIDER);
        await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'complete');

        if (rb) {
          const nb = await this.persistence.getBlockByHash(rb.getPreviousHash(), BC_SUPER_COLLIDER);
          if (nb) {
            //await this.persistence.delBlock(rb)
            await this.persistence.putLatestBlock(nb, blockchain, { context: context, iterateUp: true });
          } else {
            const bb = await this.persistence.getBlockByHeight(new BN(rb.getHeight()).sub(new BN(1)).toNumber(), BC_SUPER_COLLIDER);
            if (bb) {
              //await this.persistence.delBlock(rb)
              await this.persistence.putLatestBlock(bb, blockchain, { context: context, iterateUp: true });
            }
          }
        } else {
          this._logger.warn(`unable to establish remount point: ${rm}`);
          await this.persistence.reorgBlockchain();
          await this._engine.reorgTxPendingPool();
        }

        return Promise.resolve({
          valid: false,
          stored: false,
          needsResync: false,
          rangeRequest: false,
          schedules: [],
          assertSyncComplete: syncComplete,
          remount: true
        });
      }

      if (peerExpired) {
        debugExtend(`multiverse state is complete`);
      }

      if (edge) {
        syncComplete = true;
        debugExtend(`extendMultiverse(): ${blockchain} block ${newBlock.getHeight()} compared with local ${latestBlockHeight} and edge ${edge}`);
        if (synced && synced === 'pending' && new BN(edge).lt(new BN(newBlock.getHeight())) && new BN(latestBlock.getHeight()).lt(new BN(newBlock.getHeight()))) {
          if (!currentPeer) {
            synced = 'reorg';
          }
        }

        if (new BN(edge).lt(new BN(newBlock.getHeight()))) {
          await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(newBlock.getHeight(), 10));
        }
      } else {
        this._logger.info(`setting edge ${newBlock.getHeight()}`);
        await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(newBlock.getHeight(), 10));
        if (latestBlockHeight) {
          dlh = latestBlockHeight - 2;
        } else {
          dlh = parseInt(newBlock.getHeight(), 10) - 2;
        }
      }

      if (synced === 'pending' && BC_BUILD_GENESIS && parseInt(newBlock.getHeight(), 10) < 2) {
        await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'complete');
      }

      if (!validCoinbase && (synced === 'reorg' && dlh && dlh > 3 || synced === 'reorg' && !dlh)) {

        let lowest = latestBlockHeight;
        debugLowest(`1.lowest set to ${lowest}`);

        // if dlh exists assign it to lowest
        if (dlh && new BN(dlh).gt(new BN(3)) && new BN(dlh).gt(new BN(parseInt(newBlock.getHeight(), 10)))) {
          this._logger.info(`dlh assign lowest to ${dlh}`);
          lowest = dlh;
          debugLowest(`2.lowest set to ${lowest}`);
        }

        const opts = {};
        if (address) {
          opts.address = address;
        }

        this._logger.info(`preparing to open isolated multiverse change request from ${newBlock.getHeight()} requesting range ${dlh} -> ${newBlock.getHeight()}, lowest: ${lowest}, edge: ${latestBlockHeight}...`);
        const lowestBlock = await this.persistence.getBlockAtDepthFromBlock(latestBlock, lowest);
        let lowestLatestBlock = lowestBlock && lowestBlock.getHeight ? lowestBlock : latestBlock;
        if (lowestLatestBlock && lowestBlock && latestBlock) {
          if (lowestLatestBlock.getHash() === latestBlock.getHash()) {
            this._logger.info(`new multiverse detected ${latestBlock.getHeight()}:${latestBlock.getHash()}`);
            //lowestLatestBlock = await this.persistence.getBlockByHash(lowestLatestBlock.getPreviousHash())
          }
        }

        if (lowestLatestBlock && parseInt(lowestLatestBlock.getHeight(), 10) < lowest) {
          lowest = parseInt(lowestLatestBlock.getHeight(), 10);
          debugLowest(`3.lowest set to ${lowest}`);
        }
        if (!lowest) {
          this._logger.info(`...lowest not set, setting to ${parseInt(lowestLatestBlock.getHeight(), 10)}`);
          lowest = parseInt(lowestLatestBlock.getHeight(), 10);
          debugLowest(`4.lowest set to ${lowest}`);
        }

        const unmount = await this.persistence.getUtxoUnmount();
        if (unmount) {
          await this.persistence.delUtxoUnmount();
          this._logger.info(`mount discovered at: ${unmount}`);
        }

        opts.force = lowestLatestBlock && newBlock;
        const createdReorg = !unmount ? await this.persistence.putReorgBlocks(lowestLatestBlock, newBlock, opts) : true;
        if (createdReorg) {

          if (unmount && newBlock.getHeight() - unmount > 16) {
            lowest = unmount - 1;
            this._logger.info(`...opened change request successfully on unmount ${lowest} -> ${newBlock.getHeight()}`);
          } else {
            this._logger.info(`...opened change request successfully ${lowestLatestBlock.getHeight()} -> ${newBlock.getHeight()}`);
          }

          const rangeRequest = await this._chainState.openBlockRangeRequest(BC_SUPER_COLLIDER, parseInt(newBlock.getHeight(), 10), lowest);
          rangeRequest.highestHeight = parseInt(newBlock.getHeight(), 10);
          rangeRequest.lowestHeight = lowest;
          if (requestLog) {
            requestLog.write(Math.floor(Date.now() / 1000) + ',' + rangeRequest.highestHeight + ',' + rangeRequest.lowestHeight + ',D\n');
          }
          // LDL
          debugExtend(`reorg request opened`);
          return Promise.resolve({
            stored: true,
            needsResync: true,
            rangeRequest: rangeRequest,
            schedules: false,
            remount: false,
            assertSyncComplete: syncComplete
          });
        }
      } else if (synced === 'reorg' && !validCoinbase) {
        this._logger.info(`stale multiverse change detected <- ${newBlock.getHeight()}`);
        await this.persistence.del(`${BC_SUPER_COLLIDER}.data.latest`);
      }

      if (reorgFromBlock) {
        // the local node may be waiting to hear from a waypoint
        // the waypoint may be slow, it may have disconnected the local node may be slow it may hae disconnected
        // a range of blocks was being saught and they range has not been fulfilled
        // inside this conditional determines if the block should continue to become a change in the multiverse
        if (synced && currentPeer && synced === 'pending') {
          // LDL
          // UUU
          debug(`multiverse changing around ${edge}, yielding ${newBlock.getHeight()}`);
          return Promise.resolve({
            valid: false,
            stored: true,
            needsResync: false,
            rangeRequest: false,
            schedules: [],
            assertSyncComplete: syncComplete,
            blockSendingAlternative: true
          });
        } else if (synced && currentPeer && synced === 'complete' && parseInt(currentPeer.getExpires(), 10) < Date.now()) {
          const reorgToBlock = await this.persistence.get(`${blockchain}.block.reorgto`);
          if (!reorgToBlock || !reorgToBlock.getHeight) {
            // malformed multiverse change request request, remove the reorgfrom block
            // evalutate block
            this._logger.warn(`stale multiverse change request around block ${newBlock.getHeight()} detected, removing...`);
            await this.persistence.del(`${blockchain}.block.reorgfrom`);
            await this.persistence.del(`${blockchain}.sync.initialpeer`);
          } else {
            if (newBlock.getPreviousHash() === reorgToBlock.getHash()) {
              // its just next block
              // it will become latest block when set the putLatestBlock function iterates up to it
              await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(newBlock.getHeight(), 10));
              await this.persistence.put(`${BC_SUPER_COLLIDER}.block.reorgto`, newBlock);
              this._logger.info(`updating multiverse with purposed collision #${newBlock.getHeight()}`);
              latestBlock = reorgToBlock;

              // evaluate block
            } else if (parseInt(newBlock.getHeight(), 10) > parseInt(reorgToBlock.getHeight(), 10) + 1) {
              // likely the peer is late in updating the reorg request
              // evalute block
              this._logger.info(`newer edge of multiverse purposed collision #${newBlock.getHeight()}`);
              const rr = {
                highestHeight: parseInt(newBlock.getHeight(), 10),
                lowestHeight: parseInt(reorgFromBlock.getHeight(), 10)
              };
              if (requestLog) {
                requestLog.write(Math.floor(Date.now() / 1000) + ',' + rr.highestHeight + ',' + rr.lowestHeight + ',B\n');
              }
              // LDLdebug
              // UUU
              debug(`miner does not need to rebase on block ${newBlock.getHeight()}`);
              return Promise.resolve({
                stored: false, // it was stored above but we dont need miner to rebase on it
                needsResync: true,
                rangeRequest: rr,
                schedules: false,
                assertSyncComplete: syncComplete
              });
            } else {
              this._logger.info(`block already a part of multiverse ${edge}, yielding ${newBlock.getHeight()}`);
              return Promise.resolve({
                stored: true,
                needsResync: false,
                rangeRequest: false,
                schedules: [],
                assertSyncComplete: syncComplete,
                blockSendingAlternative: true
              });
            }
          }
        }
      } else if (currentPeer && synced && synced === 'pending') {
        // there may be a leftover waypoint who is not assigned and the local node has not started downloading the chain
        // pass
      } else if (currentPeer && synced && synced === 'complete') {
        // there may be a leftover waypoint who is not assigned and a range is not being saught
        // pass
      }
    }

    //
    // 0 - block is not next block in chain
    // 0 - block has greater total difficulty
    // 0 - block has greater or equal child chain height sum
    /// ////////////////////////////////////////////////////
    // 1. block further extends the main branch
    // assertions made from here on specific to Block Collider
    let validBlockSeq = {
      valid: false
    };
    const mountBlockReq = validateRequireMountBlock(newBlock, latestBlock);
    if (mountBlockReq && parseInt(newBlock.getHeight(), 10) > 2599000) {
      debug(`root block mount required for ${mountBlockReq[0].getBlockchain()} ${mountBlockReq[0].getHeight()}`);
      const mountBlocks = await this.persistence.getRootedBlockFromBlock(mountBlockReq[0], [], { returnParents: true });
      if (mountBlocks) {
        // assert this is part of the multichain
        for (let mb of mountBlocks) {
          if (foundRootBlockToMountBranch) {
            continue;
          }
          debug(`checking mount block ${mb}`);
          const bl = await this.persistence.getBlockByHash(mb, BC_SUPER_COLLIDER, { asHeader: false, cached: false });
          if (bl) {
            validBlockSeq = await this.validateBlockSequenceInline([newBlock, latestBlock], bl);
            if (validBlockSeq.valid) {
              rootBlock = bl;
              foundRootBlockToMountBranch = true;
              this._logger.info(`root mount block located ${bl.getHash().slice(0, 21)}...`);
            }
          }
        }

        if (!foundRootBlockToMountBranch) {

          this._logger.warn(`unable to find root mount block to validate sequence ${newBlock.getHeight()} : ${newBlock.getHash().slice(0, 21)}`);
          if (newBlock.getHeight() < 7600000) {
            foundRootBlockToMountBranch = true;
          }
          validBlockSeq.valid = true;
          if (validCoinbase && extendsChainState) {
            this._logger.info(`updating block headers for ${newBlock.getHeight()} : ${newBlock.getHash().slice(0, 21)}`);
            //await this.persistence.saveBlockHeaders(newBlock)
            //await this.persistence.putChildBlocksIndexFromBlock(newBlock)
          }
        } else {
          validBlockSeq.valid = true;
        }
      }
    } else {
      debug(`mount block not required for ${newBlock.getHeight()}`);
      // LDL
      validBlockSeq = await this.validateBlockSequenceInline([newBlock, latestBlock], false);
    }
    const newBlockLowestChildren = childrenLowestBlock(newBlock);
    const latestBlockHighestChildren = childrenHighestBlock(latestBlock);
    const failed = [];
    const childrenHeightsValid = newBlockLowestChildren.reduce((all, newBlockChild) => {
      if (all !== true) {
        return;
      }
      const newBlockChain = newBlockChild.blockchain;
      const latestChildBlock = latestBlockHighestChildren.find(b => {
        if (b.blockchain === newBlockChain) {
          return b;
        }
      });
      if (!latestChildBlock) {
        failed.push([newBlockChain, 0]);
        return false;
      }
      if (latestChildBlock.height > newBlockChild.height) {
        failed.push([newBlockChain, latestChildBlock.height]);
        return false;
      }
      return all;
    }, true);

    if (!validBlockSeq.valid && !childrenHeightsValid && parseInt(latestBlock.getHeight(), 10) > 1 && parseInt(latestBlock.getHeight(), 10) + 1 === parseInt(newBlock.getHeight(), 10)) {
      debug(`purposed ${blockchain} block ${newBlock.getHeight()} rejected child blocks are not in sequence with the current latest block ${latestBlock.getHeight()} adding schedules ${validBlockSeq.schedules ? validBlockSeq.schedules.length : []}`);
      if (failed.length > 0) {
        this._logger.warn(`the failed child sequence is ${JSON.stringify(failed, null, 2)}`);
      }
      if (new BN(newBlock.getTotalDistance()).lt(new BN(latestBlock.getTotalDistance())) && parseInt(latestBlock.getHeight(), 10) < parseInt(newBlock.getHeight(), 10)) {
        this._logger.info(`purposed ${blockchain} block ${newBlock.getHeight()}:${newBlock.getHash()} rejected as total distance is lower than current block <- new block:  ${newBlock.getTotalDistance()} latestBlock ${latestBlock.getHeight()}:${latestBlock.getHash()}: ${latestBlock.getTotalDistance()}`);
        return Promise.resolve({
          valid: validBlockSeq.valid,
          stored: false,
          needsResync: false,
          rangeRequest: false,
          schedules: validBlockSeq.schedules,
          remount: false,
          assertSyncComplete: syncComplete
        });
      } else if (context === 'local') {
        debug(`context is local where validblockSeq.valid is false and latestBlock is greater`);
        return Promise.resolve({
          valid: validBlockSeq.valid,
          stored: true,
          needsResync: false,
          rangeRequest: false,
          schedules: [],
          assertSyncComplete: syncComplete,
          remount: false,
          blockSendingAlternative: true
        });
      }
    }

    debug(`extends chain state ${extendsChainState} ${newBlock.getHeight()} : ${newBlock.getHash().slice(0, 6)}`);

    if (extendsChainState || BC_NAIVE || newBlock.getPreviousHash() === latestBlock.getHash()) {
      if (!validBlockSeq.valid && updateStorage) {
        if (context === 'local') {
          /// UUU
          debug(`${blockchain} block ${newBlock.getHeight()} rejected invalid mined block sequence`);
          return Promise.resolve({
            valid: validBlockSeq.valid,
            stored: false,
            needsResync: false,
            rangeRequest: false,
            schedules: [],
            assertSyncComplete: syncComplete,
            blockSendingAlternative: true
          });
        } //else {
        //this._logger.info(`${blockchain} block ${newBlock.getHeight()} rejected REASON: invalid block sequence`)
        //return Promise.resolve({
        //  valid: validBlockSeq.valid,
        //  stored: false,
        //  needsResync: false,
        //  rangeRequest: false,
        //  schedules: [],
        //  assertSyncComplete: syncComplete,
        //  blockSendingAlternative: true
        //})
        //}
        let high = new BN(newBlock.getHeight()).gt(latestBlock.getHeight()) ? newBlock.getHeight() : latestBlock.getHeight();
        low = new BN(newBlock.getHeight()).gt(latestBlock.getHeight()) ? latestBlock.getHeight() : newBlock.getHeight();
        low = max(2, low - 1);

        debug(`preparing to open range request from high: ${high} and low: ${low}`);

        const rangeRequest = await this._chainState.openBlockRangeRequest(blockchain, high, low);

        if (BC_NAIVE) {
          if (new BN(latestBlock.getTotalDistance()).lt(new BN(newBlock.getTotalDistance()))) {
            if (updateStorage) {
              await this.persistence.putLatestBlock(newBlock, blockchain, { chainState: this._chainState });
              if (context !== 'local') {
                // await this.persistence.putBlock(newBlock, 0, blockchain, { context: context})
              }
            }
            return Promise.resolve({
              valid: validBlockSeq.valid,
              stored: true,
              needsResync: rangeRequest.notifyRover,
              rangeRequest: rangeRequest,
              schedules: [],
              assertSyncComplete: syncComplete
            });
            // }
          } else {
            debug(`BC_NAIVE === true however block ${newBlock.getHeight()} was rejected`);
          }
        }

        if (dlh && new BN(dlh).lt(new BN(low)) && new BN(dlh).gt(new BN(2))) {
          low = dlh;
        }

        const opts = {};
        if (address) {
          opts.address = address;
        }
        const lowestBlock = await this.persistence.getBlockAtDepthFromBlock(latestBlock, low);
        const lowestLatestBlock = lowestBlock ? lowestBlock : latestBlock;
        const createdReorg = await this.persistence.putReorgBlocks(lowestLatestBlock, newBlock, opts);
        if (createdReorg) {
          this._logger.info(`multiverse change request from ${low} to ${high}`);

          rangeRequest.highestHeight = high;
          rangeRequest.lowestHeight = createdReorg.from ? createdReorg.from : low;
          if (requestLog) {
            requestLog.write(Math.floor(Date.now() / 1000) + ',' + rangeRequest.highestHeight + ',' + rangeRequest.lowestHeight + ',C\n');
          }
          return Promise.resolve({
            valid: validBlockSeq.valid,
            stored: false,
            needsResync: true,
            rangeRequest: rangeRequest,
            schedules: validBlockSeq.schedules,
            remount: false,
            assertSyncComplete: syncComplete
          });
        } else {
          // LDL
          debug(`unable to open change request from ${low} to ${high}`);
          return Promise.resolve({
            valid: false,
            stored: false,
            needsResync: false,
            rangeRequest: false,
            schedules: validBlockSeq.schedules,
            remount: false,
            assertSyncComplete: syncComplete
          });
        }
      }

      const validRoverHeaders = await this.validateRoveredBlocks(newBlock, { softFail: true });
      if (!validRoverHeaders) {
        /// UUU
        this._logger.info(`${blockchain} block ${newBlock.getHeight()} : undiscovered rovered block sequence`);
      }

      if (rootBlock && rootBlock.getHeight) {
        this._logger.info(`multiverse mounting root <- ${rootBlock.getHeight()} : ${rootBlock.getHash().slice(0, 12)}...`);
      }

      let isValidSeq = foundRootBlockToMountBranch ? { valid: true } : await this.validateBlockSequenceInline([newBlock, latestBlock], rootBlock);

      if (!isValidSeq.valid && !foundRootBlockToMountBranch) {
        debug(`purposed block added new mount from previous block`);
        //return Promise.resolve({
        //  stored: false,
        //  needsResync: false,
        //  rangeRequest: false,
        //  schedules: [],
        //  assertSyncComplete: syncComplete
        //})
      }

      if (edge && new BN(edge).lt(new BN(newBlock.getHeight()))) {
        await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(newBlock.getHeight(), 10));
        debug(`updated multiverse edge <- ${newBlock.getHeight()}`);
      }

      const r = this._knownRovers[Math.floor(Math.random() * this._knownRovers.length)];
      debug(`valid cb:${validCoinbase} <- ${newBlock.getHeight()} `);

      if (updateStorage && validCoinbase && extendsChainState) {
        debug(`updated latest block <- ${newBlock.getHeight()}`);

        if (parseInt(latestBlock.getHeight(), 10) <= parseInt(newBlock.getHeight(), 10)) {
          await this.persistence.putLatestBlock(newBlock, blockchain, {
            chainState: this._chainState,
            context: context,
            saveHeaders: true
          });
        }
        //if (context !== 'local') {
        for (const rover of this._knownRovers) {
          if (!newBlock.getBlockchainHeaders()[chainToGet(rover)]) {
            continue;
          }
          const roveredHeader = last(newBlock.getBlockchainHeaders()[chainToGet(rover)]());
          const roverBlock = await this.persistence.get(`${rover}.block.latest`);
          if (roveredHeader) {
            debug(`rover ${rover} block ${roveredHeader.getHeight()} : ${roveredHeader.getHash().slice(0, 21)}...`);
            if (!roverBlock) {
              debug(`multiverse latest ${rover} rover block is ${roveredHeader.getHeight()}, given rover block ${roveredHeader.getHeight()}`);
              await this.persistence.putLatestBlock(roveredHeader, blockchain, {
                chainState: this._chainState,
                saveHeaders: true
              });
            } else if (parseInt(roverBlock.getHeight(), 10) < parseInt(roveredHeader.getHeight(), 10)) {
              debug(`multiverse latest ${rover} rover block ${roverBlock.getHeight()} is less than ${roveredHeader.getHeight()}`);
              await this.persistence.putLatestBlock(roveredHeader, blockchain, {
                chainState: this._chainState,
                saveHeaders: true
              });
              //} else if (parseInt(roverBlock.getHeight(), 10) === parseInt(newBlock.getHeight(), 10) && roverBlock.getHash() !== roveredHeader.getHash()) {
            } else if (parseInt(roverBlock.getHeight(), 10) === parseInt(newBlock.getHeight(), 10)) {
              debug(`multiverse latest ${rover} rover block is ${roveredHeader.getHeight()}, given rover block ${roveredHeader.getHeight()}`);
              await this.persistence.putLatestBlock(roveredHeader, blockchain, {
                chainState: this._chainState,
                saveHeaders: true
              });
            } else {
              debug(`multiverse latest ${rover} rover block is ${roverBlock.getHeight()}, given rover block ${roveredHeader.getHeight()}`);
            }
          }
          if (roverBlock && r === rover) {
            await this._persistence.put(`${BC_SUPER_COLLIDER}.rover.latest`, roverBlock);
          }
        }
        //}

        // update the rovered blocks
      } else if (updateStorage && validCoinbase) {
        if (context !== 'local') {
          for (const rover of this._knownRovers) {
            if (!newBlock.getBlockchainHeaders()[chainToGet(rover)]) {
              continue;
            }
            const roveredHeader = last(newBlock.getBlockchainHeaders()[chainToGet(rover)]());
            const roverBlock = await this.persistence.get(`${rover}.block.latest`);
            if (roveredHeader) {
              if (!roverBlock) {
                debug(`multiverse latest ${rover} rover block is new to disk ${roveredHeader.getHeight()}`);
                await this.persistence.putLatestBlock(roveredHeader, blockchain, { chainState: this._chainState });
              } else if (parseInt(roverBlock.getHeight(), 10) < parseInt(roveredHeader.getHeight(), 10)) {
                debug(`multiverse latest ${rover} rover block ${roverBlock.getHeight()} is less than ${roveredHeader.getHeight()}`);
                await this.persistence.putLatestBlock(roveredHeader, blockchain, { chainState: this._chainState });
              } else if (parseInt(roverBlock.getHeight(), 10) === parseInt(newBlock.getHeight(), 10) && roverBlock.getHash() !== roveredHeader.getHash()) {
                debug(`multiverse latest ${rover} rover block is ${roveredHeader.getHeight()}`);
                await this.persistence.putLatestBlock(roveredHeader, blockchain, { chainState: this._chainState });
              } else {
                debug(`multiverse latest ${rover} rover block is ${roverBlock.getHeight()}`);
              }
            }
            if (roverBlock && r === rover) {
              await this._persistence.put(`${BC_SUPER_COLLIDER}.rover.latest`, roverBlock);
            }
          }
        }
      }

      if (BC_STRICT_SEQ && parseInt(newBlock.getHeight(), 10) % 1000 === 0) {
        const missingBlock = await this.persistence.getMissingBlockFromHeight(blockchain, newBlock, 1000);
        if (missingBlock) {
          debug(`missing block found after latest ${newBlock.getHeight()} : ${newBlock.getHash()}`);
          debug(JSON.stringify(missingBlock, null, 2));
        }
      }
    }

    if (validCoinbase && extendsChainState) {

      debug(`new block ${newBlock.getHeight()} : ${newBlock.getHash().slice(0, 8)}... extends multiverse`);
      await this.persistence.putLatestBlock(newBlock, BC_SUPER_COLLIDER, {
        chainState: this._chainState,
        context: context
      });
      return Promise.resolve({
        valid: true,
        stored: true,
        needsResync: false,
        rangeRequest: false,
        schedules: [],
        assertSyncComplete: syncComplete
      });
    }

    // x - block is not next block in chain
    // x - block has greater total difficulty
    // 0 - block has greater or equal child chain height sum
    /// ////////////////////////////////////////////////////
    const defaultHighest = parseInt(newBlock.getHeight(), 10);
    const defaultLowest = max(2, parseInt(latestBlock.getHeight(), 10) - 3);

    if (this._chainState) {
      const chainStateLowest = await this._chainState.getRangeLowestHeight(BC_SUPER_COLLIDER);
      const chainStateHighest = await this._chainState.getRangeHighestHeight(BC_SUPER_COLLIDER);
      // console.log({chainStateLowest,chainStateHighest});
      if (chainStateLowest & defaultLowest) {
        if (new BN(defaultLowest).lt(new BN(chainStateLowest))) {
          lowest = defaultLowest;
          debugLowest(`5.lowest set to ${lowest}`);
        } else {
          lowest = chainStateLowest;
          debugLowest(`6.lowest set to ${lowest}`);
        }
      }
      if (chainStateHighest) {
        if (new BN(defaultHighest).gt(new BN(chainStateHighest))) {
          highest = defaultHighest;
        } else {
          highest = chainStateHighest;
        }
      }
    } else {
      highest = defaultHighest;
      lowest = defaultLowest;
      debugLowest(`7.lowest set to ${lowest}`);
    }

    if (highest) {
      if (parseInt(newBlock.getHeight(), 10) > highest) {
        highest = parseInt(newBlock.getHeight(), 10);
      }
    }

    if (lowest) {
      if (parseInt(latestBlock.getHeight(), 10) < lowest) {
        lowest = parseInt(latestBlock.getHeight(), 10);
        debugLowest(`8.lowest set to ${lowest}`);
      }
    }

    highest = highest ? highest : parseInt(newBlock.getHeight(), 10);
    lowest = lowest ? lowest : parseInt(latestBlock.getHeight(), 10);
    debugLowest(`9.lowest set to ${lowest}`);

    highest = max(2, highest);
    lowest = max(2, lowest - 1);
    debugLowest(`10.lowest set to ${lowest}`);
    // console.log({highest,lowest});

    // if (new BN(newBlock.getTotalDistance()).lt(new BN(latestBlock.getTotalDistance()))) {
    if (new BN(newBlock.getTotalDistance()).lt(new BN(latestBlock.getTotalDistance())) && parseInt(latestBlock.getHeight(), 10) < parseInt(newBlock.getHeight(), 10)) {
      this._logger.info(`purposed ${blockchain} block ${newBlock.getHeight()}:${newBlock.getHash()} rejected as total distance is lower than current block <- new block:  ${newBlock.getTotalDistance()} latestBlock ${latestBlock.getHeight()}:${latestBlock.getHash()}: ${latestBlock.getTotalDistance()}`);
      return Promise.resolve({
        valid: false,
        stored: false,
        needsResync: false,
        rangeRequest: false,
        schedules: validBlockSeq.schedules,
        assertSyncComplete: syncComplete
      });
    }

    // combat bad miners
    if (new BN(newBlock.getHeight()).lte(new BN(latestBlock.getHeight())) && parseInt(newBlock.getHeight(), 10) <= parseInt(latestBlock.getHeight(), 10) && newBlock.getTimestamp() - 1000 < latestBlock.getTimestamp()) {
      debug(`purposed ${blockchain} block ${newBlock.getHeight()} rejected as total height is lower than current block <- new block:  ${newBlock.getHeight()} latestBlock ${latestBlock.getHeight()}:${latestBlock.getHash()}`);
      return Promise.resolve({
        valid: false,
        stored: false,
        needsResync: false,
        rangeRequest: false,
        schedules: validBlockSeq.schedules,
        assertSyncComplete: syncComplete,
        blockSendingAlternative: false
      });
    }

    if (latestBlock.getHeight() === newBlock.getHeight() && context === 'local') {
      debug(`multiple blocks submitted by miner for height ${newBlock.getHeight()}`);
      return Promise.resolve({
        valid: false,
        stored: false,
        needsResync: false,
        rangeRequest: false,
        schedules: validBlockSeq.schedules,
        assertSyncComplete: syncComplete
      });
    }

    //await this.persistence.putBlock(newBlock, 0, blockchain, {asHeader: false, saveHeaders: true, context: context})

    if (new BN(purposedBlockChildHeightSum).gt(new BN(latestBlockChildHeightSum)) && new BN(latestBlock.getHeight()).lt(new BN(newBlock.getHeight()))) {

      currentPeer = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);

      if (currentPeer && parseInt(currentPeer.getExpires(), 10) < Number(new Date())) {
        debug(`current peer still set returning block`);
        return Promise.resolve({
          valid: false,
          stored: false,
          needsResync: false,
          rangeRequest: false,
          schedules: validBlockSeq.schedules,
          assertSyncComplete: syncComplete
        });
      } else if (currentPeer && parseInt(currentPeer.getExpires(), 10) > Number(new Date())) {
        await this.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      }

      // check if we can mount the block immediately
      if (latestBlock.getPreviousHash() === newBlock.getPreviousHash()) {
        const latestBlockParent = await this.persistence.getBlockByHash(latestBlock.getPreviousHash(), BC_SUPER_COLLIDER);
        if (latestBlockParent) {
          if (validCoinbase) {
            this._logger.info(`mounting block at previous height ${latestBlockParent.getHeight()}`);
            // ensure the block is stored at that height as an option
            await this.persistence.putLatestBlock(newBlock, BC_SUPER_COLLIDER, {
              chainState: this._chainState,
              iterateUp: false,
              context: context
            });
            // await this.persistence.putBlockHashAtHeight(newBlock.getHash(), newBlock.getHeight(), blockchain, { context: context})
            return Promise.resolve({
              valid: false,
              stored: true,
              needsResync: false,
              rangeRequest: false,
              schedules: validBlockSeq.schedules,
              assertSyncComplete: syncComplete
            });
          } else {

            this._logger.info(`block discovered at edge ${newBlock.getHeight()}`);

            //return Promise.resolve({
            //  valid: false,
            //  stored: false,
            //  needsResync: false,
            //  rangeRequest: false,
            //  schedules: validBlockSeq.schedules,
            //  assertSyncComplete: syncComplete
            //})
          }
        }
      }

      // check if there is already a peer request open
      const newBlocks = newBlock.getBlockchainHeadersCount ? newBlock.getBlockchainHeadersCount() : 0;
      const diff = new BN(newBlock.getHeight()).sub(new BN(latestBlock.getHeight())).toNumber();
      const high = parseInt(latestBlock.getHeight(), 10) > parseInt(newBlock.getHeight(), 10) ? parseInt(latestBlock.getHeight(), 10) : parseInt(newBlock.getHeight(), 10);

      if (diff > 19) {
        // prepare to request
        this._logger.info(`difference is greater than multiverse threshold increasing lower bound from ${lowest} (${low}/${high}) to ${max(2, lowest)} : ${latestBlock.getHeight()} default lowest: ${defaultLowest}`);
        const reorgLowest = await this.persistence.get(`${BC_SUPER_COLLIDER}.block.reorgfrom`);

        if (reorgLowest && parseInt(reorgLowest.getHeight(), 10) > parseInt(latestBlock.getHeight(), 10)) {
          this._logger.info(`setting request floor ${reorgLowest.getHeight()}`);
          lowest = max(2, parseInt(reorgLowest.getHeight(), 10) - 3);
          low = lowest;
        } else {
          lowest = max(2, parseInt(latestBlock.getHeight(), 10) - 3);
          low = lowest;
        }

        debugLowest(`11.lowest set to ${lowest}`);
      }

      const possibleLowest = await this.persistence.get(`${BC_SUPER_COLLIDER}.data.latest`);
      const possibleMount = await this.persistence.get(`${BC_SUPER_COLLIDER}.unmount`);
      debug(`mount: ${possibleMount}`);

      if (possibleLowest) {
        low = possibleLowest.split(':')[0];
      }
      // if (low && !isNaN(low)) { if (new BN(low).lt(new BN(lowest))) { lowest = low } }

      const opts = {};
      if (address) {
        opts.address = address;
      }

      if (dlh && new BN(dlh).lt(new BN(lowest)) && new BN(dlh).gt(new BN(3))) {
        debugLowest(`boundary set for ${lowest} (${low}/${high}) to ${dlh} : ${latestBlock.getHeight()}`);
      }

      if (possibleMount) {
        const mt = possibleMount.split(':')[0];
        if (parseInt(lowest, 10) > parseInt(mt, 10)) {
          this._logger.info(`moving lowest bound ${lowest} -> ${mt}`);
          lowest = mt;
          debugLowest(`13.lowest set to ${lowest}`);
        }
      }

      // otherwise if the diff is small in the request window adjus to a multiverse update only
      if (diff < 16) {
        debugLowest(`difference is lower than multiverse threshold adjusting lower bound from ${lowest} (${low}/${high}) to ${max(2, lowest)} : ${latestBlock.getHeight()}`);
        lowest = max(2, parseInt(latestBlock.getHeight(), 10) - 8);
        debugLowest(`14.lowest set to ${lowest}`);
      }

      const lowestBlock = await this.persistence.getBlockAtDepthFromBlock(latestBlock, lowest);
      const lowestLatestBlock = lowestBlock ? lowestBlock : latestBlock;
      const createdReorg = await this.persistence.putReorgBlocks(lowestLatestBlock, newBlock, opts);

      lowest = max(8, lowest);
      debugLowest(`15.lowest set to ${lowest}`);

      debug(`multiverse update ${newBlock.getHeight()} : ${newBlocks} range ${lowest} -> ${highest} purposed hash ${newBlock.getPreviousHash().slice(0, 8)} : ${purposedBlockChildHeightSum} latest hash ${latestBlock.getHash().slice(0, 8)} : ${latestBlockChildHeightSum}`);
      const rangeRequest = await this._chainState.openBlockRangeRequest(blockchain, highest, lowest);
      const rr = {
        highestHeight: highest,
        lowestHeight: lowest
        // this stops miner
      };debug(`opening multiverse change request from ${lowest} to ${highest}`);
      if (requestLog) {
        requestLog.write(Math.floor(Date.now() / 1000) + ',' + highest + ',' + lowest + ',A\n');
      }
      await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(newBlock.getHeight(), 10));
      await this.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${lowest}:${now}`);
      await this.persistence.del(`${BC_SUPER_COLLIDER}.unmount`);

      return Promise.resolve({
        valid: false,
        stored: false,
        needsResync: true,
        rangeRequest: rr,
        schedules: validBlockSeq.schedules,
        assertSyncComplete: syncComplete
      });
    } else if (new BN(purposedBlockChildHeightSum).lt(new BN(latestBlockChildHeightSum))) {
      debug(`extendMultiverse(): purposed block to multiverse child sum ${purposedBlockChildHeightSum} is lower than latest block ${latestBlockChildHeightSum}`);
      await this.persistence.del(`${BC_SUPER_COLLIDER}.unmount`);
      return Promise.resolve({
        valid: false,
        stored: false,
        needsResync: false,
        rangeRequest: false,
        schedules: [],
        assertSyncComplete: syncComplete
      });
    }

    if (!validCoinbase) {
      // LDL
      /// UUU
      this._logger.info(`coinbase recalculation required for block ${newBlock.getHeight()}, status: ${synced}`);

      return Promise.resolve({
        valid: validBlockSeq.valid,
        stored: false,
        needsResync: false,
        rangeRequest: false,
        schedules: validBlockSeq.schedules,
        assertSyncComplete: syncComplete
      });
    }

    // x - block is not next block in chain
    // 0 - block has greater total difficulty, and total distance
    // 0 - block has equal child chain height sum
    /// ////////////////////////////////////////////////////
    // 2. REJECT: block is below total difficulty
    if (new BN(newBlock.getDifficulty()).gte(new BN(latestBlock.getDifficulty())) && new BN(newBlock.getTotalDistance()).gt(new BN(latestBlock.getTotalDistance()))) {
      debug(`purposed ${blockchain} block ${newBlock.getHeight()}:${newBlock.getHash()} accepted to multiverse`);
      // force setting edge as this may require syncing
      // moving lowest down by 90

      const opts = {};
      if (address) {
        opts.address = address;
      }

      // check if we can mount the block immediately
      if (latestBlock.getPreviousHash() === newBlock.getPreviousHash()) {
        const latestBlockParent = await this.persistence.getBlockByHash(latestBlock.getPreviousHash(), BC_SUPER_COLLIDER);
        if (latestBlockParent) {
          if (validCoinbase) {
            this._logger.info(`storing block in chain following parent -> new block ${newBlock.getHeight()}, ${newBlock.getHash().slice(0, 21)}`);
            // ensure height is set
            await this.persistence.putLatestBlock(newBlock, BC_SUPER_COLLIDER, {
              chainState: this._chainState,
              iterateUp: true,
              context: context
            });
            //await this.persistence.putBlockHashAtHeight(newBlock.getHash(), newBlock.getHeight(), blockchain, { context: context})
            return Promise.resolve({
              valid: false,
              stored: true,
              needsResync: false,
              rangeRequest: false,
              schedules: validBlockSeq.schedules,
              assertSyncComplete: syncComplete
            });
          } else {

            return Promise.resolve({
              valid: false,
              stored: false,
              needsResync: false,
              rangeRequest: false,
              schedules: validBlockSeq.schedules,
              assertSyncComplete: syncComplete
            });
          }
        }
      }

      const lowestBlock = await this.persistence.getBlockAtDepthFromBlock(latestBlock, lowest);
      const lowestLatestBlock = lowestBlock ? lowestBlock : latestBlock;
      const createdReorg = await this.persistence.putReorgBlocks(lowestLatestBlock, newBlock, opts);
      if (createdReorg || !currentPeer) {
        debug(`createdReorg: ${createdReorg}, currentPeer: ${currentPeer}`);
        this._logger.info(`opened multiverse change request from ${lowest} to ${highest}`);
        await this.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(newBlock.getHeight(), 10));
        const rangeRequest = await this._chainState.openBlockRangeRequest(blockchain, highest, lowest);
        rangeRequest.highestHeight = highest;
        rangeRequest.lowestHeight = lowest;
        if (requestLog) {
          requestLog.write(Math.floor(Date.now() / 1000) + ',' + highest + ',' + lowest + ',B\n');
        }

        await this.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${lowest}:${now}`);

        return Promise.resolve({
          valid: false,
          stored: true,
          needsResync: true,
          rangeRequest: rangeRequest,
          schedules: validBlockSeq.schedules,
          assertSyncComplete: syncComplete
        });
      } else {
        return Promise.resolve({
          valid: false,
          stored: true,
          needsResync: false,
          rangeRequest: false,
          schedules: validBlockSeq.schedules,
          assertSyncComplete: syncComplete,
          blockSendingAlternative: true
        });
      }
    } else {

      debug(`purposed ${blockchain} block ${newBlock.getHeight()}:${newBlock.getHash()} not approved as next in multiverse, difficulty is ${newBlock.getDifficulty()}, distance is ${newBlock.getTotalDistance()}`);
      this._logger.info(`latest block ${latestBlock.getHeight()}:${latestBlock.getHash().slice(0, 6)}... difficulty:  ${latestBlock.getDifficulty()}, distance: ${latestBlock.getTotalDistance()}`);
      return Promise.resolve({
        valid: false,
        stored: false,
        needsResync: false,
        rangeRequest: false,
        schedules: validBlockSeq.schedules,
        assertSyncComplete: syncComplete
      });
    }
  }

  async isSyncLockActive() {
    try {
      const synclock = await this.persistence.get('synclock');

      if (!synclock) {
        this._logger.info('sync lock not present');
        return Promise.resolve(false);
      }

      if (synclock.getHeight() !== 1 && synclock.getTimestamp() + 8 < Math.floor(Date.now() * 0.001)) {
        await this.persistence.put('synclock', getGenesisBlock());
        this._logger.warn('sync lock is stale resetting');
        return Promise.resolve(false);
      } else if (synclock.getHeight() !== '1' && synclock.getTimestamp() + 8 < Math.floor(Date.now() * 0.001)) {
        await this.persistence.put('synclock', getGenesisBlock());
        this._logger.warn('sync lock is stale resetting');
        return Promise.resolve(false);
      } else if (synclock.getHeight() === 1 || synclock.getHeight() === '1') {
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    } catch (err) {
      this._logger.error(err);
      return Promise.resolve(true);
    }
  }

  async validateRoveredBlocks(block, opts = { softFail: true, assertLocalBlocks: true }) {
    // construct key array like ['btc.block.528089', ..., 'wav.block.1057771', 'wav.blocks.1057771']
    if (parseInt(block.getHeight(), 10) < 3) {
      this._logger.info(`genesis block is parent`);
      return true;
    }

    try {

      const receivedHeaders = block.getBlockchainHeaders();
      const receivedHeadersObj = values(block.getBlockchainHeaders().toObject());
      const receivedBlocks = flatten(receivedHeadersObj);
      const keys = receivedBlocks.map(({ blockchain, height }) => `${blockchain}.block.${height}`);
      const blocks = await this.persistence.getBulk(keys);
      let foundAllBlocks = blocks && keys.length === blocks.length;

      if (!foundAllBlocks) {
        const previousKeys = receivedBlocks.map(b => `${b.blockchain}.block.${b.height - 1}`);
        debug('------- KEYS ---------');
        debug(keys);
        debug('------- PREV KEYS ---------');
        debug(previousKeys);
        debug(`parent key is ${BC_SUPER_COLLIDER}.block.${parseInt(block.getHeight(), 10) - 1}`);
        debug(`parent prev hash is ${BC_SUPER_COLLIDER}.block.${block.getPreviousHash()}`);
        const parentBlock = await this.persistence.getBlockByHash(block.getPreviousHash());
        if (!parentBlock) {
          debug(`parent block unavailable to determine rover sequence <- invalid`);
          if (opts.softFail) {
            return true;
          }
          return false;
        }

        const previousBlocks = await this.persistence.getBulk(previousKeys);
        if (!previousBlocks) {
          this._logger.warn('previous blocks not available for sequence confirmation');
          return true;
        }

        if (opts.assertLocalBlocks && previousBlocks.length !== keys.length) {
          this._logger.warn('previous blocks not available for sequence confirmation');
          if (opts.softFail) {
            return true;
          }
          return false;
        }

        const latestBlockchainNames = blocks.map(b => {
          return b.getBlockchain();
        });

        // TODO this is set(latestBlockchainNames).intersection(keys)
        const missingBlockchainNames = keys.reduce((missing, key) => {
          if (latestBlockchainNames.indexOf(key) < 0) {
            missing.push(key);
          }
          return missing;
        }, []);

        const missingBlocks = missingBlockchainNames.reduce((missing, blockchain) => {
          let sortedChildHeaders = [];
          if (blockchain === 'btc') {
            sortedChildHeaders = sortBlocks(receivedHeaders.getBtcList(), 'desc');
          } else if (blockchain === 'eth') {
            sortedChildHeaders = sortBlocks(receivedHeaders.getEthList(), 'desc');
          } else if (blockchain === 'wav') {
            sortedChildHeaders = sortBlocks(receivedHeaders.getWavList(), 'desc');
          } else if (blockchain === 'neo') {
            sortedChildHeaders = sortBlocks(receivedHeaders.getNeoList(), 'desc');
          } else if (blockchain === 'lsk') {
            sortedChildHeaders = sortBlocks(receivedHeaders.getLskList(), 'desc');
          }
          const lowest = sortedChildHeaders.pop();
          if (lowest) {
            missing.push(lowest);
          }
          return missing;
        }, []);

        debug('------- BLOCKS ON DISK ---------');
        debug(latestBlockchainNames);
        debug('------- UNROVERED BLOCKS ---------');
        debug(missingBlockchainNames);

        let falseBlock = false;
        const correctSequence = missingBlocks.reduce((valid, block) => {
          if (valid === false) {
            const count = previousBlocks.reduce((updateValid, pb) => {
              if (block.getBlockchain() === pb.getBlockchain()) {
                // console.log('eval blockchain ' + pb.getBlockchain() + ' previousHash: ' + pb.getPreviousHash() + ' hash: ' + block.getHash())
                if (validateBlockSequence([pb, block])) {
                  // console.log('for blockchain ' + pb.getBlockchain() + ' sequence is INVALID previousHash: ' + pb.getPreviousHash() + ' hash: ' + block.getHash())
                  updateValid++;
                } else if (pb.getHeight() + 1 === block.getHeight()) {
                  // permitted only in BT
                  updateValid++;
                } else {
                  updateValid--;
                }
              }
              return updateValid;
            }, 0);
            if (count >= 0) {
              valid = true;
            }
          }
          return valid;
        }, false);
        debug(`purposed child blocks not known by rover`);
        if (falseBlock === true) {
          if (opts.softFail) {
            return true;
          }
          return false;
        }
        if (opts.softFail) {
          return true;
        }
        return correctSequence;
      }

      if (blocks.length > 0 && receivedBlocks.length) {
        const pairs = zip(receivedBlocks, blocks);
        const isChained = all(identity, pairs.map(([received, expected]) => {
          // $FlowFixMe
          return received.hash === expected.getHash() &&
          // $FlowFixMe
          received.height === expected.getHeight() &&
          // $FlowFixMe
          received.merkleRoot === expected.getMerkleRoot() &&
          // $FlowFixMe
          received.timestamp === expected.getTimestamp();
        }));

        // disabled until AT
        if (isChained !== true) {
          debug('failed chained check');
          return true;
        }
        if (opts.softFail) {
          return true;
        }
      } else {
        return true;
      }
    } catch (err) {
      this._logger.error(err);
      if (opts.softFail) {
        return true;
      } else {
        return false;
      }
    }
  }

  /**
   * Get multiverse as nested `BcBlock` array
   * @returns {*}
   */
  toArray() {
    return this._chain;
  }

  /**
   * Get multiverse as flat `BcBlock` array
   */
  toFlatArray() {
    const blocks = this.toArray();
    return flatten(blocks);
  }

  // NOTE: Multiverse print disabled. Why?
  print() {
    // this._logger.info(this._blocks)
    this._logger.info('multiverse print disabled');
  }
}

exports.Multiverse = Multiverse;
exports.default = Multiverse;