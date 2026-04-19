/**
 * Manually maintained API-id to catalog-id overrides.
 *
 * The Tacticus API uses internal unit ids that do not always match the
 * short camelCase ids we scrape from halmmar. Keys are the *normalized*
 * API id (lowercase, alphanumeric only); values are the catalog character id.
 *
 * Add entries as you discover unmatched ids in the Sync Report panel.
 */
export const API_ID_ALIASES: Record<string, string> = {
  // Long forms → short catalog ids
  calgarlordofmacragge: 'calgar',
  marneuscalgar: 'calgar',
  abaddonthedespoiler: 'abaddon',
  abaddonwarmasterofchaos: 'abaddon',
  helbrechthighmarshall: 'helbrecht',
  ragnarblackmane: 'ragnar',
  kharntheBetrayer: 'kharn',
  kharnthebetrayer: 'kharn',
  mephistonlordofdeath: 'mephiston',
  typhusheraldofnurgle: 'typhus',
  ahrimanexilesorcerer: 'ahriman',
  azraelsupremegrandmaster: 'azrael',
  asmodaimasterofrepentance: 'asmodai',
  jainzar: 'jainZar',
  jainzarstormofsilence: 'jainZar',
  eldryonfarseer: 'eldryon',
  maugenra: 'mauganRa',
  maugenrathemournful: 'mauganRa',
  shadowsuncommander: 'shadowsun',
  commandershadowsun: 'shadowsun',
  darkstriderpathfinder: 'darkstrider',
  aunshiethereal: 'aunShi',
  aunshi: 'aunShi',
  shosyl: 'shoSyl',
  shosylshasla: 'shoSyl',
  tangida: 'tanGiDa',
  celestinethelivingsaint: 'celestine',
  morvennvahlabbess: 'morvennVahl',
  morvennvahl: 'morvennVahl',
  yarrickoldbonebreaker: 'yarrick',
  creedlordmarshal: 'creed',
  parasiteofmortrex: 'parasiteOfMortrex',
  deathleaperlictor: 'deathleaper',
  exitorrho: 'exitorRho',
  alephnull: 'alephNull',
  revas: 'reVas',
  wingedprime: 'wingedPrime',
  thepatermine: 'thePatermine',
  tyrantguard: 'tyrantGuard',
  neurothropeshadowseer: 'neurothrope',

  // Orks
  gulgortzwarboss: 'gulgortz',
  snappawrecka: 'snappawrecka',
  tanksmashanob: 'tanksmasha',
  snotfloggaruntherd: 'snotflogga',
  gibbascrapzbiguntoss: 'gibbascrapz',

  // Space Wolves
  njalstormcaller: 'njal',
  njal: 'njal',
  ulfragnarsonwolfguard: 'ulf',
  arjacrockfist: 'arjac',

  // Blood Angels
  mataneosanguinaryguard: 'mataneo',
  lucienbloodclaw: 'lucien',

  // Thousand Sons
  thaumachussorcerer: 'thaumachus',
  tjarkscarabsorcerer: 'tjark',

  // Mech
  thoreadskitarii: 'thoread',
  actustechpriest: 'actus',
  vitruviussecutarii: 'vitruvius',
  corrodiusrustlord: 'corrodius',

  // Necrons
  anuphetlord: 'anuphet',
  makhotepimmortal: 'makhotep',
  thutmosedeathmark: 'thutmose',
  imospekhflayed: 'imospekh',

  // Tyranids
  sarquaelhivetyrant: 'sarquael',
  xybialictor: 'xybia',

  // Genestealer Cults
  acolytehybrid: 'acolyteHybrid',
  burchardhybrid: 'burchard',
  isaakhybrid: 'isaak',
  macerhybrid: 'macer',
  hollanhybrid: 'hollan',

  // World Eaters
  angraxberzerker: 'angrax',
  godswylberzerker: 'godswyl',

  // API short ids (faction-prefixed role names seen in player data)
  ultrainceptorsgt: 'bellator',
  ultraeliminatorsgt: 'certus',
  ultraapothecary: 'incisus',
  ultralibrarian: 'tigurius',
  ultracaptain: 'titus',
  adeptretributor: 'vindicta',
  adeptsistersuperior: 'roswitha',
  adeptcanoness: 'morvennVahl',
  adeptcelestian: 'celestine',
  adeptsaint: 'celestine',
  necrowarden: 'makhotep',
  necroimmortal: 'makhotep',
  necrooverlord: 'anuphet',
  necrodestroyer: 'imospekh',
  necrodeathmark: 'thutmose',
  deathblightlord: 'maladus',
  deathplaguemarine: 'rotbone',
  deathlord: 'typhus',
  orksbigmek: 'gibbascrapz',
  orksnob: 'tanksmasha',
  orkswarboss: 'gulgortz',
  orksgrot: 'snotflogga',
  orksmek: 'snappawrecka',
  blackterminator: 'angrax',
  blacksorcerer: 'abaddon',
  tyranicwarrior: 'sarquael',
  tyranichivetyrant: 'sarquael',
  tyraniclictor: 'xybia',
  tyraniccarnifex: 'tyrantGuard',
  aeldarifarseer: 'eldryon',
  aeldariautarch: 'jainZar',
  aeldariranger: 'mauganRa',
  aeldariwarlock: 'eldryon',
  taufireblade: 'shoSyl',
  tauethereal: 'aunShi',
  taupathfinder: 'darkstrider',
  taucrisis: 'shadowsun',
  wolvesbloodclaw: 'lucien',
  wolveswolfguard: 'ulf',
  wolvesrunepriest: 'njal',
  bloodassaultintercessor: 'mataneo',
  bloodsanguinaryguard: 'mataneo',
  darkangelsterminator: 'azrael',
  darkangelschaplain: 'asmodai',
  mechskitarii: 'thoread',
  mechtechpriest: 'actus',
  mechsecutarii: 'vitruvius',
  thousandsonssorcerer: 'ahriman',
  thousandsonsrubric: 'thaumachus',
  thousandsonsscarab: 'tjark',
  worldeatersberzerker: 'kharn',
  worldeaterseightbound: 'godswyl',
  guardcommissar: 'yarrick',
  guardlordmarshal: 'creed',
  sistershospitaller: 'isabella',
  imperialknightgallant: 'thaddeus',
};

export function normalizeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function aliasLookup(apiId: string): string | undefined {
  return API_ID_ALIASES[normalizeId(apiId)];
}
