'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
const { networks } = require('../../config/networks');
const BC_NETWORK = process.env.BC_NETWORK || 'main';
const EMB_CONTRACT_ADDRESS = networks[BC_NETWORK].rovers.eth.embContractId;

const ERC20_WATCHED_TOKENS = exports.ERC20_WATCHED_TOKENS = [{ assetName: 'emb', isEmb: true, contractAddress: EMB_CONTRACT_ADDRESS }, { assetName: 'dai', isEmb: false, contractAddress: '0x6b175474e89094c44da98b954eedeac495271d0f' }, { assetName: 'usdt', isEmb: false, contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7' }, { assetName: 'xaut', isEmb: false, contractAddress: '0x4922a015c4407f87432b179bb209e125432e4a2a' }, { assetName: 'mph', isEmb: false, contractAddress: '0x8888801af4d980682e47f1a9036e589479e835c5' }, { assetName: 'keep', isEmb: false, contractAddress: '0x85eee30c52b0b379b046fb0f85f4f3dc3009afec' }, { assetName: 'sand', isEmb: false, contractAddress: '0x3845badade8e6dff049820680d1f14bd3903a5d0' }, { assetName: 'ramp', isEmb: false, contractAddress: '0x33d0568941c0c64ff7e0fb4fba0b11bd37deed9f' }, { assetName: 'stake', isEmb: false, contractAddress: '0x0ae055097c6d159879521c384f1d2123d1f195e6' }, { assetName: 'yfdai', isEmb: false, contractAddress: '0xf4cd3d3fda8d7fd6c5a500203e38640a70bf9577' }, { assetName: 'cvp', isEmb: false, contractAddress: '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1' }, { assetName: 'omg', isEmb: false, contractAddress: '0xd26114cd6ee289accf82350c8d8487fedb8a0c07' }, { assetName: 'bao', isEmb: false, contractAddress: '0x374cb8c27130e2c9e04f44303f3c8351b9de61c1' }, { assetName: 'comp', isEmb: false, contractAddress: '0xc00e94cb662c3520282e6f5717214004a7f26888' }, { assetName: 'apy', isEmb: false, contractAddress: '0x95a4492f028aa1fd432ea71146b433e7b4446611' }, { assetName: 'onx', isEmb: false, contractAddress: '0xe0ad1806fd3e7edf6ff52fdb822432e847411033' }, { assetName: 'ren', isEmb: false, contractAddress: '0x408e41876cccdc0f92210600ef50372656052a38' }, { assetName: 'fink', isEmb: false, contractAddress: '0xb5fe099475d3030dde498c3bb6f3854f762a48ad' }, { assetName: 'ankreth', isEmb: false, contractAddress: '0xe95a203b1a91a908f9b9ce46459d101078c2c3cb' }, { assetName: 'perp', isEmb: false, contractAddress: '0xbc396689893d065f41bc2c6ecbee5e0085233447' }, { assetName: 'orn', isEmb: false, contractAddress: '0x0258f474786ddfd37abce6df6bbb1dd5dfc4434a' }, { assetName: 'grt', isEmb: false, contractAddress: '0xc944e90c64b2c07662a292be6244bdf05cda44a7' }, { assetName: 'combo', isEmb: false, contractAddress: '0xffffffff2ba8f66d4e51811c5190992176930278' }, { assetName: 'farm', isEmb: false, contractAddress: '0xa0246c9032bc3a600820415ae600c6388619a14d' }, { assetName: 'pickle', isEmb: false, contractAddress: '0x429881672b9ae42b8eba0e26cd9c73711b891ca5' }, { assetName: 'pbtc35a', isEmb: false, contractAddress: '0xa8b12cc90abf65191532a12bb5394a714a46d358' }, { assetName: 'rook', isEmb: false, contractAddress: '0xfa5047c9c78b8877af97bdcb85db743fd7313d4a' }, { assetName: 'yfi', isEmb: false, contractAddress: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e' }, { assetName: 'snx', isEmb: false, contractAddress: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f' }, { assetName: 'tru', isEmb: false, contractAddress: '0x4c19596f5aaff459fa38b0f7ed92f11ae6543784' }, { assetName: 'xor', isEmb: false, contractAddress: '0x40fd72257597aa14c7231a7b1aaa29fce868f677' }, { assetName: 'crv', isEmb: false, contractAddress: '0xd533a949740bb3306d119cc777fa900ba034cd52' }, { assetName: 'cc10', isEmb: false, contractAddress: '0x17ac188e09a7890a1844e5e65471fe8b0ccfadf3' }, { assetName: 'cel', isEmb: false, contractAddress: '0xaaaebe6fe48e54f431b0c390cfaf0b017d09d42d' }, { assetName: 'ddim', isEmb: false, contractAddress: '0xfbeea1c75e4c4465cb2fccc9c6d6afe984558e20' }, { assetName: 'lrc', isEmb: false, contractAddress: '0xbbbbca6a901c926f240b89eacb641d8aec7aeafd' }, { assetName: 'mir', isEmb: false, contractAddress: '0x09a3ecafa817268f77be1283176b946c4ff2e608' }, { assetName: 'tru', isEmb: false, contractAddress: '0x0000000000085d4780b73119b644ae5ecd22b376' }, { assetName: 'pols', isEmb: false, contractAddress: '0x83e6f1e41cdd28eaceb20cb649155049fac3d5aa' }, { assetName: 'exrd', isEmb: false, contractAddress: '0x6468e79a80c0eab0f9a2b574c8d5bc374af59414' }, { assetName: 'duck', isEmb: false, contractAddress: '0xc0ba369c8db6eb3924965e5c4fd0b4c1b91e305f' }, { assetName: 'fxs', isEmb: false, contractAddress: '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0' }, { assetName: 'sdt', isEmb: false, contractAddress: '0x73968b9a57c6e53d41345fd57a6e6ae27d6cdb2f' }, { assetName: 'alpha', isEmb: false, contractAddress: '0xa1faa113cbe53436df28ff0aee54275c13b40975' }, { assetName: 'renbtc', isEmb: false, contractAddress: '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d' }, { assetName: 'lon', isEmb: false, contractAddress: '0x0000000000095413afc295d19edeb1ad7b71c952' }, { assetName: 'ampl', isEmb: false, contractAddress: '0xd46ba6d942050d489dbd938a2c909a5d5039a161' }, { assetName: 'bac', isEmb: false, contractAddress: '0x3449fc1cd036255ba1eb19d65ff4ba2b8903a69a' }, { assetName: 'mkr', isEmb: false, contractAddress: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2' }, { assetName: 'aave', isEmb: false, contractAddress: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9' }, { assetName: 'bond', isEmb: false, contractAddress: '0x0391d2021f89dc339f60fff84546ea23e337750f' }, { assetName: 'hez', isEmb: false, contractAddress: '0xeef9f339514298c6a857efcfc1a762af84438dee' }, { assetName: 'dpi', isEmb: false, contractAddress: '0x1494ca1f11d487c2bbe4543e90080aeba4ba3c2b' }, { assetName: 'core', isEmb: false, contractAddress: '0x62359ed7505efc61ff1d56fef82158ccaffa23d7' }, { assetName: 'link', isEmb: false, contractAddress: '0x514910771af9ca656af840dff83e8264ecf986ca' }, { assetName: 'ust', isEmb: false, contractAddress: '0xa47c8bf37f92abed4a126bda807a7b7498661acd' }, { assetName: 'frax', isEmb: false, contractAddress: '0x853d955acef822db058eb8505911ed77f175b99e' }, { assetName: 'wise', isEmb: false, contractAddress: '0x66a0f676479cee1d7373f3dc2e2952778bff5bd6' }, { assetName: 'uni', isEmb: false, contractAddress: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984' }, { assetName: 'ens', isEmb: false, contractAddress: '0xc18360217d8f7ab5e7c516566761ea12ce7f9d72' }, { assetName: 'wbtc', isEmb: false, contractAddress: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' }, { assetName: 'bone', isEmb: false, contractAddress: '0x9813037ee2218799597d83d4a5b6f3b6778218d9' }, { assetName: 'leash', isEmb: false, contractAddress: '0x27C70Cd1946795B66be9d954418546998b546634' }, { assetName: 'shib', isEmb: false, contractAddress: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce' }, { assetName: 'wool', isEmb: false, contractAddress: '0x8355dbe8b0e275abad27eb843f3eaf3fc855e525' }];

const ERC721_WATCHED_TOKENS = exports.ERC721_WATCHED_TOKENS = [{ assetName: 'wnd', isEmb: false, contractAddress: "0x999e88075692bcee3dbc07e7e64cd32f39a1d3ab" }, { assetName: 'clonex', isEmb: false, contractAddress: "0x49cf6f5d44e70224e2e23fdcdd2c053f30ada28b" }, { assetName: 'goldh', isEmb: false, contractAddress: "0x66fca7555cd481545a5e66ba9a2bec1e256f98e7" }, { assetName: 'dusk', isEmb: false, contractAddress: "0x0beed7099af7514ccedf642cfea435731176fb02" }, { assetName: 'mph', isEmb: false, contractAddress: "0x09233d553058c2f42ba751c87816a8e9fae7ef10" }, { assetName: 'vandv', isEmb: false, contractAddress: "0x2ceac5e021efd3d6d770fe9c403996afc4db36a7" }, { assetName: 'croakz', isEmb: false, contractAddress: "0x7cae7b9b9a235d1d94102598e1f23310a0618914" }, { assetName: 'champs', isEmb: false, contractAddress: "0x97a923ed35351a1382e6bcbb5239fc8d93360085" }, { assetName: 'squish', isEmb: false, contractAddress: "0x792496a3f678187e59e1d1d5e075799cd1e124c2" }, { assetName: 'wg', isEmb: false, contractAddress: "0x1ebb218415b1f70aeff54041c743082f183318ce" }, { assetName: 'ais', isEmb: false, contractAddress: "0x7a3b97a7400e44dadd929431a3640e4fc47daebd" }, { assetName: 'hoverboard', isEmb: false, contractAddress: "0xeda3b617646b5fc8c9c696e0356390128ce900f8" }, { assetName: 'blocks', isEmb: false, contractAddress: "0xa7d8d9ef8d8ce8992df33d8b8cf4aebabd5bd270" }, { assetName: 'mnb', isEmb: false, contractAddress: "0xd9c036e9eef725e5aca4a22239a23feb47c3f05d" }, { assetName: 'ctzn', isEmb: false, contractAddress: "0x570fa0bc16487152cc2b5ced1533930bb4888b66" }, { assetName: 'awake', isEmb: false, contractAddress: "0x2050fc00e016c3ada03211edc35711e44b8d014e" }, { assetName: 'moodrls', isEmb: false, contractAddress: "0xe3234e57ac38890a9136247eadfe1860316ff6ab" }, { assetName: 'trippy', isEmb: false, contractAddress: "0x4ca4d3b5b01207ffce9bea2db9857d4804aa89f3" }, { assetName: 'rroo', isEmb: false, contractAddress: "0xca49b939ad0b0b148fa61641d799e7777ad2e5db" }, { assetName: 'neotoi', isEmb: false, contractAddress: "0x698fbaaca64944376e2cdc4cad86eaa91362cf54" }, { assetName: 'wtc', isEmb: false, contractAddress: "0xa7d0043760b936c2416e07203ace2546f1dbc9c0" }, { assetName: 'vailiens', isEmb: false, contractAddress: "0xab157a3375668043b6af995251cacc581fcbb363" }, { assetName: 'dpunk', isEmb: false, contractAddress: "0xf21d1b31b15282592ff0e48f7b474b57ae418361" }, { assetName: 'cnp', isEmb: false, contractAddress: "0x2fe776dd5fd2388f5ccaefad214989131b3a8d6b" }, { assetName: 'akc', isEmb: false, contractAddress: "0x9bf252f97891b907f002f2887eff9246e3054080" }, { assetName: 'uni-v3-pos', isEmb: false, contractAddress: "0xc36442b4a4522e871399cd717abdd847ab11fe88" }, { assetName: 'emates', isEmb: false, contractAddress: "0xd0242443f18586c389a1013539e93f3a7b27018c" }, { assetName: 'sor', isEmb: false, contractAddress: "0x629a673a8242c2ac4b7b8c5d8735fbeac21a6205" }, { assetName: 'animalz', isEmb: false, contractAddress: "0x5bc1d68f6a9aea23f2fb54baf7f67c0662194e9a" }, { assetName: 'mistletoadz', isEmb: false, contractAddress: "0x7fcbb823ff16110e5a14c3c897dc0af334423e4f" }, { assetName: 'lvp', isEmb: false, contractAddress: "0x4e34ec528a663194f4dfe40641e8a3a98abb6e84" }, { assetName: 'land', isEmb: false, contractAddress: "0x50f5474724e0ee42d9a4e711ccfb275809fd6d4a" }, { assetName: 'chain', isEmb: false, contractAddress: "0x506c29ae8417efc5f346f2b3c9e40317f54b57b4" }, { assetName: 'bed', isEmb: false, contractAddress: "0xba0a8ff51f281f7e49c6182390cfbe518f965433" }, { assetName: 'flgs', isEmb: false, contractAddress: "0x2efa07cac3395599db83035d196f2a0e7263f766" }, { assetName: 'ddg', isEmb: false, contractAddress: "0x412b98fecc9d1ff664df6083f228db839108e1cd" }, { assetName: 'aifabox', isEmb: false, contractAddress: "0x26437d312fb36bdd7ac9f322a6d4ccfe0c4fa313" }, { assetName: 'agc', isEmb: false, contractAddress: "0x8c5029957bf42c61d19a29075dc4e00b626e5022" }, { assetName: 'noundlestheory', isEmb: false, contractAddress: "0x41cb4a771fdd019adbf4685bd4885fbbeede1784" }, { assetName: 'a$$', isEmb: false, contractAddress: "0x62d8ae32b0e6964d2126716cf3da70c2bd062d94" }, { assetName: 'zunk', isEmb: false, contractAddress: "0x031920cc2d9f5c10b444fd44009cd64f829e7be2" }, { assetName: 'truth', isEmb: false, contractAddress: "0x26badf693f2b103b021c670c852262b379bbbe8a" }, { assetName: 'nerds', isEmb: false, contractAddress: "0x0f78c6eee3c89ff37fd9ef96bd685830993636f2" }, { assetName: 'crystals', isEmb: false, contractAddress: "0x368ad4a7a7f49b8fa8f34476be0fc4d04ce622f5" }, { assetName: 'webbland', isEmb: false, contractAddress: "0xa1d4657e0e6507d5a94d06da93e94dc7c8c44b51" }, { assetName: 'ck', isEmb: false, contractAddress: "0x06012c8cf97bead5deae237070f9587f8e7a266d" }, { assetName: 'vee', isEmb: false, contractAddress: "0x7cc78084e8d7b2be045fd23d0cdf749599db6eb4" }, { assetName: 'ffd', isEmb: false, contractAddress: "0x36a196993805e2e57411250864e2faafe33fb945" }, { assetName: 'huxley', isEmb: false, contractAddress: "0x9ca8887d13bc4591ae36972702fdf9de2c97957f" }, { assetName: 'hero', isEmb: false, contractAddress: "0x6dc6001535e15b9def7b0f6a20a2111dfa9454e2" }, { assetName: 'walkers', isEmb: false, contractAddress: "0x258aeac01672e6857972707fc129a6a39d09758b" }, { assetName: 'hotm', isEmb: false, contractAddress: "0x8a9ece9d8806eb0cde56ac89ccb23a36e2c718cf" }, { assetName: 'pof', isEmb: false, contractAddress: "0x2828fd113b2459d8872633da79c421c0275bff53" }, { assetName: 'feudalz', isEmb: false, contractAddress: "0x3ca5b00ade54365fbd590d4bc397e044a13068e5" }, { assetName: 'tzkg', isEmb: false, contractAddress: "0x320c1ca2bdda1375174a98bfd06ed7c2d60e9842" }, { assetName: 'ntctzn', isEmb: false, contractAddress: "0xb668beb1fa440f6cf2da0399f8c28cab993bdd65" }, { assetName: 'zen', isEmb: false, contractAddress: "0x838804a3dd7c717396a68f94e736eaf76b911632" }, { assetName: 'pistol', isEmb: false, contractAddress: "0xf1026716ef967bdac62321d98eb8dea9943d3ca2" }, { assetName: 'mice', isEmb: false, contractAddress: "0xbad6186e92002e312078b5a1dafd5ddf63d3f731" }, { assetName: 'toadz', isEmb: false, contractAddress: "0x1cb1a5e65610aeff2551a50f76a87a7d3fb649c6" }, { assetName: 'pepsimicdrop', isEmb: false, contractAddress: "0xa67d63e68715dcf9b65e45e5118b5fcd1e554b5f" }, { assetName: 'cbs', isEmb: false, contractAddress: "0x469823c7b84264d1bafbcd6010e9cdf1cac305a3" }, { assetName: 'mfer', isEmb: false, contractAddress: "0x79fcdef22feed20eddacbb2587640e45491b757f" }, { assetName: 'saps', isEmb: false, contractAddress: "0x364c828ee171616a39897688a831c2499ad972ec" }, { assetName: 'mayc', isEmb: false, contractAddress: "0x60e4d786628fea6478f785a6d7e704777c86a7c6" }, { assetName: 'fbl', isEmb: false, contractAddress: "0x2d004b72d8b7d36f9da2e4a14516618bf53bac57" }, { assetName: 'chain', isEmb: false, contractAddress: "0x3d23a6926d9acb60e080adf565b1f1a27d2058bc" }, { assetName: 'daw', isEmb: false, contractAddress: "0xf1268733c6fb05ef6be9cf23d24436dcd6e0b35e" }, { assetName: 'beargame', isEmb: false, contractAddress: "0xe27a60f3cf27f716ac998b61492a36090973aac7" }, { assetName: 'clabs', isEmb: false, contractAddress: "0x96316355c44be69414756d6706c61e61aecbd5f3" }, { assetName: 'cac', isEmb: false, contractAddress: "0x218fdc5b352f6560e3ee67da8112fe663f38aca1" }, { assetName: 'honeyhivedeluxe', isEmb: false, contractAddress: "0x5df89cc648a6bd179bb4db68c7cbf8533e8d796e" }, { assetName: 'pod', isEmb: false, contractAddress: "0xdd70af84ba86f29bf437756b655110d134b5651c" }, { assetName: 'mona', isEmb: false, contractAddress: "0x21bf3da0cf0f28da27169239102e26d3d46956e5" }, { assetName: 'transponder', isEmb: false, contractAddress: "0x9d00d9b009ab80a18013675011c93796d89de6b4" }, { assetName: 'landz', isEmb: false, contractAddress: "0x8a479d6b4435e0b82dc9587610c977c138b86ab4" }, { assetName: 'scap', isEmb: false, contractAddress: "0xeafa25e962ee875f75fdc97e152d39bb4c8978ae" }, { assetName: 'swamper', isEmb: false, contractAddress: "0x95784f7b5c8849b0104eaf5d13d6341d8cc40750" }, { assetName: 'moonboyz', isEmb: false, contractAddress: "0xd8682bfa6918b0174f287b888e765b9a1b4dc9c3" }, { assetName: 'bb', isEmb: false, contractAddress: "0x04c119560a383aeac8a60371d4fdad98640549e1" }, { assetName: 'gsoup', isEmb: false, contractAddress: "0x608c2feb6b80993b26ffb6fa84f454ad3ac38bf0" }, { assetName: 'land', isEmb: false, contractAddress: "0x2c88aa0956bc9813505d73575f653f69ada60923" }, { assetName: 'sbcc', isEmb: false, contractAddress: "0xfd1076d80fff9dc702ae9fdfea0073467b9b3fb7" }, { assetName: 'bbtoads', isEmb: false, contractAddress: "0x6eed5b7ec85a802428f7a951d6cc1523181c776a" }, { assetName: 'fox', isEmb: false, contractAddress: "0x322f5577807185adaf3fa6512a7ccbbc32670c55" }, { assetName: 'thelittlesnft', isEmb: false, contractAddress: "0xc6ec80029cd2aa4b0021ceb11248c07b25d2de34" }, { assetName: 'royalrabbits', isEmb: false, contractAddress: "0x1c5c36bd0199ae1eb0cb23892faefebfa876c067" }, { assetName: 'hungry', isEmb: false, contractAddress: "0x13d66dbace34218fddaf50f7057092a43507adef" }, { assetName: 'bearsdeluxe', isEmb: false, contractAddress: "0x4bb33f6e69fd62cf3abbcc6f1f43b94a5d572c2b" }, { assetName: 'shibaku', isEmb: false, contractAddress: "0xb70b759ad676b227a01f7d406e2dc9c67103aaeb" }, { assetName: 'doodle', isEmb: false, contractAddress: "0x8a90cab2b38dba80c64b7734e58ee1db38b8992e" }, { assetName: 'kvk', isEmb: false, contractAddress: "0x03f3426fe1c016a96de0da4e26aee7523dbe2c19" }, { assetName: 'n', isEmb: false, contractAddress: "0xee6747065eebe87fe7c1db0cd0820139cf2f74be" }, { assetName: 'soda', isEmb: false, contractAddress: "0xb184b9414e7d7c436b7097ed2c774bb56fae392f" }, { assetName: '3333', isEmb: false, contractAddress: "0xc5fd1f4dcc8678c5cf5820e096b6db0a10aeeed1" }, { assetName: 'wmbtm', isEmb: false, contractAddress: "0xb82a72453403f350e14b8bf7dcc6fbd045cc0d3c" }, { assetName: 'ark', isEmb: false, contractAddress: "0xae2715a11ce6ac33f14176cb8012eca50b98def1" }, { assetName: 'sd888', isEmb: false, contractAddress: "0xa6794dec66df7d8b69752956df1b28ca93f77cd7" }, { assetName: 'monkes', isEmb: false, contractAddress: "0x7bb6413c939d9ecc62bdd60d6e23816b1ae9099f" }, { assetName: 'mb', isEmb: false, contractAddress: "0xc6c817cd60e17fed0af2a759624e02dd6c812e64" }, { assetName: 'lion', isEmb: false, contractAddress: "0x8943c7bac1914c9a7aba750bf2b6b09fd21037e0" }, { assetName: 'mutcats', isEmb: false, contractAddress: "0xaadba140ae5e4c8a9ef0cc86ea3124b446e3e46a" }, { assetName: 'rlgazette', isEmb: false, contractAddress: "0x79be9877702537c9bff2ad1f51de94160bae04a6" }, { assetName: 'vox', isEmb: false, contractAddress: "0xad9fd7cb4fc7a0fbce08d64068f60cbde22ed34c" }, { assetName: 'supr', isEmb: false, contractAddress: "0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0" }, { assetName: 'mp', isEmb: false, contractAddress: "0xa9e12344f87a4a3d031d49d9842f1385aa2b81d9" }, { assetName: 'comic', isEmb: false, contractAddress: "0x5ab21ec0bfa0b29545230395e3adaca7d552c948" }, { assetName: 'abs', isEmb: false, contractAddress: "0x7ab2352b1d2e185560494d5e577f9d3c238b78c5" }, { assetName: 'vx', isEmb: false, contractAddress: "0x7ea3cca10668b8346aec0bf1844a49e995527c8b" }, { assetName: 'jnc', isEmb: false, contractAddress: "0x0b4b2ba334f476c8f41bfe52a428d6891755554d" }, { assetName: 'boonji', isEmb: false, contractAddress: "0x4cd0ea8b1bdb5ab9249d96ccf3d8a0d3ada2bc76" }, { assetName: 'dngiez', isEmb: false, contractAddress: "0x58f6e32baa17de3862b9c5859bc3bcf0c2ce1947" }, { assetName: 'bayc', isEmb: false, contractAddress: "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d" }, { assetName: 'cg', isEmb: false, contractAddress: "0x0322f6f11a94cfb1b5b6e95e059d8deb2bf17d6a" }, { assetName: 'icon', isEmb: false, contractAddress: "0xf9a423b86afbf8db41d7f24fa56848f56684e43f" }, { assetName: 'mfc', isEmb: false, contractAddress: "0x6250b989ecf7cb82c7892e1cea604ed813423635" }, { assetName: 'head', isEmb: false, contractAddress: "0xf62c6a8e7bcdc96cda11bd765b40afa9ffc19ab9" }, { assetName: 'shrk', isEmb: false, contractAddress: "0xe98e81e02a31dcb3a99bfc10f83d40b4faf42903" }, { assetName: 'treasure', isEmb: false, contractAddress: "0xf3dfbe887d81c442557f7a59e3a0aecf5e39f6aa" }, { assetName: 'noundles', isEmb: false, contractAddress: "0x4cff01dbed00a5e95d705f96acf369f210c203c8" }, { assetName: 'je', isEmb: false, contractAddress: "0xf169d117e1b03f42a87ce4e71732f6e0adf1befe" }, { assetName: 'ycsk', isEmb: false, contractAddress: "0x4efadff2c961102d9b3296b0e42ce3786b5d6d7d" }, { assetName: 'wow', isEmb: false, contractAddress: "0xe785e82358879f061bc3dcac6f0444462d4b5330" }, { assetName: 'svs', isEmb: false, contractAddress: "0x219b8ab790decc32444a6600971c7c3718252539" }, { assetName: 'n', isEmb: false, contractAddress: "0x05a46f1e545526fb803ff974c790acea34d1f2d6" }, { assetName: 'hsv2', isEmb: false, contractAddress: "0x0fe3e7498b46bdadbe195fa309ff44e63fe6dc8d" }, { assetName: 'fape', isEmb: false, contractAddress: "0xf3114dd5c5b50a573e66596563d15a630ed359b4" }, { assetName: 'flpy', isEmb: false, contractAddress: "0xe0c2e14844e836e41cff6931a0f78a48ce285b2f" }, { assetName: 'pabc', isEmb: false, contractAddress: "0x5df340b5d1618c543ac81837da1c2d2b17b3b5d8" }, { assetName: 'degen', isEmb: false, contractAddress: "0x986aea67c7d6a15036e18678065eb663fc5be883" }, { assetName: 'cup', isEmb: false, contractAddress: "0xd5dd0814f62a21ab649fb9cb86dfe0a085d0e28a" }, { assetName: 'mintps', isEmb: false, contractAddress: "0x7dc33b42a4970892163c0f30bda8f54dea9fd6ed" }, { assetName: 'emblem.pro', isEmb: false, contractAddress: "0x82c7a8f707110f5fbb16184a5933e9f78a34c6ab" }, { assetName: 'mutantmingo', isEmb: false, contractAddress: "0x48f7a31995fc71baec70c412ed5c1837c86abe84" }, { assetName: 'bara', isEmb: false, contractAddress: "0xc9e0649f907ab074fda75674b9d2e658c7449d5c" }, { assetName: 'dd', isEmb: false, contractAddress: "0xdb3b2e1f699caf230ee75bfbe7d97d70f81bc945" }, { assetName: 'ga', isEmb: false, contractAddress: "0x90ca8a3eb2574f937f514749ce619fdcca187d45" }, { assetName: 'ethol', isEmb: false, contractAddress: "0x1fff1e9e963f07ac4486503e5a35e71f4e9fb9fd" }, { assetName: 'btp', isEmb: false, contractAddress: "0x9eeeaf684e228c2d5c89435e010acc02c41dc86b" }, { assetName: 'ms', isEmb: false, contractAddress: "0x30a51024cef9e1c16e0d9f0dd4acc9064d01f8da" }, { assetName: 'tnl', isEmb: false, contractAddress: "0x7623c79b272b3b584c773d13327e6f6584332982" }, { assetName: 'ga', isEmb: false, contractAddress: "0x1ca39c7f0f65b4da24b094a9afac7acf626b7f38" }, { assetName: 'mm', isEmb: false, contractAddress: "0x436fbf52faf705b6f82404bd06fb637bc4cc44ae" }, { assetName: 'sbs', isEmb: false, contractAddress: "0xee0ba89699a3dd0f08cb516c069d81a762f65e56" }, { assetName: 'fluf', isEmb: false, contractAddress: "0xccc441ac31f02cd96c153db6fd5fe0a2f4e6a68d" }, { assetName: 'amc', isEmb: false, contractAddress: "0xea5f32ed4044c44c44ab833d8071e672aad142ff" }, { assetName: 'gbac', isEmb: false, contractAddress: "0x916758c4588d0614488f2c53ddc6c337a245d7d7" }, { assetName: 'tgame', isEmb: false, contractAddress: "0x4958ce8ddf7131286dcf5298a357d981e18a5c9e" }, { assetName: 'infinitegrid', isEmb: false, contractAddress: "0x78898ffa059d170f887555d8fd6443d2abe4e548" }, { assetName: 'bod', isEmb: false, contractAddress: "0xe48814b0569b744e6e75ef28403bdd7a6e7b5237" }, { assetName: 'twc', isEmb: false, contractAddress: "0x85f740958906b317de6ed79663012859067e745b" }, { assetName: 'mzgt', isEmb: false, contractAddress: "0x2d366be8fa4d15c289964dd4adf7be6cc5e896e8" }, { assetName: 'creature', isEmb: false, contractAddress: "0xc92ceddfb8dd984a89fb494c376f9a48b999aafc" }, { assetName: 'galape', isEmb: false, contractAddress: "0x12d2d1bed91c24f878f37e66bd829ce7197e4d14" }, { assetName: 'nff', isEmb: false, contractAddress: "0x90ee3cf59fcde2fe11838b9075ea4681462362f1" }, { assetName: 'deadfellaz', isEmb: false, contractAddress: "0x2acab3dea77832c09420663b0e1cb386031ba17b" }, { assetName: 'ghosts', isEmb: false, contractAddress: "0x78ccad4da0a92a94f95405cf151f73e6a3c4c279" }, { assetName: 'uncool', isEmb: false, contractAddress: "0x5f9e300108fb156cfbe21c48a870876e97745af9" }, { assetName: 'ppg', isEmb: false, contractAddress: "0xbd3531da5cf5857e7cfaa92426877b022e612cf8" }, { assetName: 'cool', isEmb: false, contractAddress: "0x1a92f7381b9f03921564a437210bb9396471050c" }, { assetName: 'hbs', isEmb: false, contractAddress: "0xfa8c109f5efa3b40c2dff5000f53bfc0f153dea2" }, { assetName: 'dogedash', isEmb: false, contractAddress: "0x44357cb1fc60fd5c6e3e673f6b71b38baf83d386" }, { assetName: '[nft]', isEmb: false, contractAddress: "0x6d4530149e5b4483d2f7e60449c02570531a0751" }, { assetName: 'run', isEmb: false, contractAddress: "0x97597002980134bea46250aa0510c9b90d87a587" }, { assetName: 'tpa', isEmb: false, contractAddress: "0x787cf4212e8840dac775b496ef7e2c06f717e779" }, { assetName: 'gbro', isEmb: false, contractAddress: "0x4f85620beb2c229e34d00b1b1c9f5e76bc212a76" }, { assetName: 'dino', isEmb: false, contractAddress: "0x2d0ee46b804f415be4dc8aa1040834f5125ebd2e" }, { assetName: 'm101shelter', isEmb: false, contractAddress: "0x10a0cf0fd3b9b2d575d78130b29d61252313423e" }, { assetName: 'ryu', isEmb: false, contractAddress: "0x3ecd3bd68d68b7cad7eaef9e1c4abc823962221c" }, { assetName: 'play', isEmb: false, contractAddress: "0x65c234d041f9ef96e2f126263727dfa582206d82" }, { assetName: 'mts', isEmb: false, contractAddress: "0xf7143ba42d40eaeb49b88dac0067e54af042e963" }, { assetName: 'jfrk', isEmb: false, contractAddress: "0x7e6bc952d4b4bd814853301bee48e99891424de0" }, { assetName: 'trd', isEmb: false, contractAddress: "0xb91d89997e5356a3bb0c33908efc80f12241bc85" }, { assetName: 'clc', isEmb: false, contractAddress: "0x18f87c05325ae47bfe75c039198b3dc1cb2ed23d" }, { assetName: 'axolittle', isEmb: false, contractAddress: "0xf36446105ff682999a442b003f2224bcb3d82067" }, { assetName: 'smls', isEmb: false, contractAddress: "0x177ef8787ceb5d4596b6f011df08c86eb84380dc" }, { assetName: 'avastar', isEmb: false, contractAddress: "0xf3e778f839934fc819cfa1040aabacecba01e049" }, { assetName: 'da', isEmb: false, contractAddress: "0xc631164b6cb1340b5123c9162f8558c866de1926" }, { assetName: 'ooc', isEmb: false, contractAddress: "0xde361820cdcbdf2d1ddbb0b636638b11dc3385ab" }, { assetName: 'rug', isEmb: false, contractAddress: "0xb23335829d464c2f6551c57768821c1f0b0bd8f6" }, { assetName: 'crucible-v1', isEmb: false, contractAddress: "0x54e0395cfb4f39bef66dbcd5bd93cca4e9273d56" }, { assetName: 'socks', isEmb: false, contractAddress: "0xf3511dced180f0e5a5155ccc5edabdfe1bc429c0" }, { assetName: 'btcnft', isEmb: false, contractAddress: "0xce63fad14f6f4cf0eae2ea36d2ac04cc606da04f" }, { assetName: 'vvc', isEmb: false, contractAddress: "0x6e2542aecc940ea56a9560a6b8ca34dbbef3b520" }, { assetName: 'hoe', isEmb: false, contractAddress: "0xf1ef40f5aea5d1501c1b8bcd216cf305764fca40" }, { assetName: 'aau', isEmb: false, contractAddress: "0x9546eeb89df8f010da4953c2ef456e282b3db25a" }, { assetName: 'party', isEmb: false, contractAddress: "0x4be3223f8708ca6b30d1e8b8926cf281ec83e770" }, { assetName: 'dphunks', isEmb: false, contractAddress: "0xf3b85ea0aa85eee04705c338eb4fb61beb756943" }, { assetName: 'sa88', isEmb: false, contractAddress: "0xe64213b7bfbcb14c2f9cdfdd55eabd5aef17f6aa" }, { assetName: 'bfm', isEmb: false, contractAddress: "0x138ff21a21dfc06fbfccf15f2d9fd290a660e152" }, { assetName: 'itfk', isEmb: false, contractAddress: "0xe6ef513f7429d92cb54ebd4c14026aeb90849a78" }, { assetName: 'rpf', isEmb: false, contractAddress: "0xc9e3ca32caaa6ee67476c5d35d4b8ec64f58d4ad" }, { assetName: 'fthrs', isEmb: false, contractAddress: "0x6bf7835eccb7ea74bbd816aad6ea6215a51e8d35" }, { assetName: 'legionnaires', isEmb: false, contractAddress: "0x5041a99684d38e280e4b0b356185bf18c991f88b" }, { assetName: 'doggy', isEmb: false, contractAddress: "0xf4ee95274741437636e748ddac70818b4ed7d043" }, { assetName: 'clnst', isEmb: false, contractAddress: "0x9f4df153d95a8460f6e82c21cab92719781fab84" }, { assetName: 'magnum', isEmb: false, contractAddress: "0x9523b6429924e4fac50568572cf1d24697190c1d" }, { assetName: 'kaiju', isEmb: false, contractAddress: "0x0c2e57efddba8c768147d1fdf9176a0a6ebd5d83" }];