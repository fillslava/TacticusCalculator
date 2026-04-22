/**
 * Lightweight i18n. All translatable strings live in the `dict` below, keyed
 * by a stable `<scope>.<name>` identifier. Components read them via `useT()`.
 *
 * Game-data strings (faction names, trait names, boss names, buff preset
 * names, equipment mod labels) stay in English — they come from the scraped
 * catalog and matching them to in-game locale would require separate scrapes
 * per language. The English UI chrome is what gets translated here.
 */
import { useApp } from '../state/store';

export type Lang = 'en' | 'ru' | 'de' | 'fr' | 'nl';

export const LANGUAGES: { code: Lang; name: string; flag: string }[] = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
];

type Dict = Record<string, string>;

const en: Dict = {
  'app.title': 'Tacticus Damage Calculator',
  'app.titleSuffix': 'Damage Calculator',
  'app.subtitle': 'formula: HDTW · engine v0.1',
  'lang.label': 'Language',

  'section.import': 'Import',
  'section.character': 'Character',
  'section.target': 'Target',
  'section.rotation': 'Rotation',
  'section.damage': 'Damage',
  'section.comparison': 'Character comparison',
  'section.sync': 'Sync Report',

  'rotation.description':
    "Each turn fires one attack. Add up to {n} buffs per turn. Buffs take the buffer's level & rarity (for reference), a damage/crit bonus, and optional bonus hits (first turn / normal / ability).",

  'label.apiKey': 'API Key',
  'label.character': 'Character',
  'label.boss': 'Boss',
  'label.stage': 'Stage',
  'label.armor': 'Armor',
  'label.hp': 'HP',
  'label.shield': 'Shield',
  'label.damage': 'Damage',
  'label.rarityStars': 'Rarity / Stars',
  'label.rank': 'Rank',
  'label.xpLevel': 'XP / Ability Level',
  'label.search': 'Search',
  'label.faction': 'Faction',
  'label.ownedOnly': 'Owned only',
  'label.equipment': 'Equipment',
  'label.derived': 'Derived',
  'label.traits': 'traits',
  'label.abilityLevels': 'Ability Levels',
  'label.attack': 'Attack',
  'label.showTop': 'Show top',
  'label.melee': 'Melee',
  'label.ranged': 'Ranged',
  'label.perHit': 'Per hit',
  'label.critPct': 'Crit %',
  'label.critDmg': 'Crit Dmg',
  'label.blockPct': 'Block %',
  'label.blockDmg': 'Block Dmg',
  'label.meleeHits': 'Melee Hits',

  'button.loadApi': 'Load from API',
  'button.loading': 'Loading…',
  'button.uploadJson': 'or upload player.json',
  'button.addTurn': '+ add turn',
  'button.addBuff': '+ add buff…',
  'button.remove': 'remove',
  'button.showTrace': 'show trace',
  'button.hideTrace': 'hide trace',
  'button.details': 'details',
  'button.hideDetails': 'hide details',

  'result.firstTurn': 'First turn',
  'result.rotationTotal': 'Rotation total',
  'result.turnsToKill': 'turns to kill',
  'result.perTurn': 'Per turn',
  'result.pickToSee': 'Pick a character and target to see damage.',
  'result.range': 'range',
  'result.crit': 'crit',

  'placeholder.pick': '— pick —',
  'placeholder.customStats': '— custom stats —',
  'placeholder.apiKey': 'your X-API-KEY uuid',
  'placeholder.search': 'Name, id, or faction…',

  'comparison.turn1': 'Turn 1',
  'comparison.t1Buffs': 'T1 buffs',

  'sync.title': 'Sync Report',
  'sync.unitsMatched': 'units matched',
  'sync.unknownItems': 'unknown items (likely relics)',

  'rarity.common': 'Common',
  'rarity.uncommon': 'Uncommon',
  'rarity.rare': 'Rare',
  'rarity.epic': 'Epic',
  'rarity.legendary': 'Legendary',
  'rarity.mythic': 'Mythic',

  'note.assumptions.title': 'Modeling assumptions',
  'note.assumptions.intro':
    'This character uses recently-modeled mechanics. Verify against in-game damage preview:',
  'note.assumptions.verify':
    'If numbers disagree, report the discrepancy so we can fix the calculator.',
  'note.assumptions.multiComponent': 'multi-component',
  'note.assumptions.triggered': 'triggered',
  'note.assumptions.teamBuff': 'team buff',
  'note.assumptions.scaling': 'scales',
  'note.assumptions.cooldown': 'cd',
  'note.assumptions.oncePerBattle': 'once/battle',
  'note.assumptions.trigger.afterNormal': 'after own normal attack',
  'note.assumptions.trigger.firstAttackOfTurn': 'after own first attack of turn',
  'note.assumptions.trigger.targetTrait': 'target trait',
  'note.assumptions.scaling.per': 'per',
  'note.assumptions.guildRaidOnly': 'Guild Raid only',

  'page.single': 'Single attacker',
  'page.team': 'Team (Guild Raid)',

  'team.composer.title': 'Team composition',
  'team.composer.description':
    'Five hero slots + one Machine-of-War slot (left to right). Adjacency uses |Δposition|=1. Empty slots are skipped when the rotation runs.',
  'team.composer.slot': 'Slot',
  'team.composer.mow': 'MoW',
  'team.composer.mowSectionTitle': 'Machine of War',
  'team.composer.pickHero': '— empty —',
  'team.composer.pickMow': '— no MoW —',
  'team.composer.unowned': '(using default build)',
  'team.composer.owned': '(owned)',
  'team.composer.alliance': 'alliance',
  'team.composer.faction': 'faction',
  'team.composer.rarity': 'rarity',
  'team.composer.position': 'position',

  'team.rotation.title': 'Team rotation',
  'team.rotation.description':
    'Order matters — Laviscus Outrage and Trajann/Biovore triggers depend on who acts first within each turn.',
  'team.rotation.turn': 'Turn',
  'team.rotation.addAction': '+ add action',
  'team.rotation.addTurn': '+ add turn',
  'team.rotation.noActions': 'No actions scheduled for this turn.',
  'team.rotation.pickMember': '— pick member —',

  'team.result.title': 'Team damage',
  'team.result.teamTotal': 'Team total',
  'team.result.turnsToKill': 'Turns to kill',
  'team.result.perMember': 'Per member',
  'team.result.perTurnTeam': 'Per turn (team)',
  'team.result.cooldownSkips': 'Cooldown skips',
  'team.result.buffApplications': 'Team-buff applications',
  'team.result.noRotation':
    'Compose a team and schedule at least one action to see damage.',
  'team.result.noTarget': 'Pick a target boss or enter custom stats.',
  'team.result.unreachable': '∞',
  'team.result.triggeredFires': 'triggered passives',
  'team.result.turn': 'Turn',

  'team.training.toggle': 'Train this member',
  'team.training.active': 'Training active',
  'team.training.reset': 'Reset to baseline',
  'team.training.progression': 'Rarity / Stars',
  'team.training.rank': 'Rank',
  'team.training.xpLevel': 'XP Level',
  'team.training.abilityLevels': 'Ability levels',
  'team.training.baselineTag': 'baseline',
  'team.training.trainedTag': 'trained',
  'team.training.deltaColumn': '+damage (training)',
  'team.training.teamDelta': 'Team uplift from training',
  'team.training.teamDeltaNone':
    'Enable training on at least one slot to see uplift here.',
  'team.training.description':
    'Simulate training — stars, rank, XP, ability levels. Baseline stays sourced from your API data.',
};

const ru: Dict = {
  'app.title': 'Калькулятор урона Tacticus',
  'app.titleSuffix': '— Калькулятор урона',
  'app.subtitle': 'формула: HDTW · движок v0.1',
  'lang.label': 'Язык',

  'section.import': 'Импорт',
  'section.character': 'Персонаж',
  'section.target': 'Цель',
  'section.rotation': 'Ротация',
  'section.damage': 'Урон',
  'section.comparison': 'Сравнение персонажей',
  'section.sync': 'Отчёт синхронизации',

  'rotation.description':
    'Каждый ход — одна атака. До {n} бафов на ход. Баф берёт уровень и редкость источника (для справки), даёт бонус к урону/криту и, по желанию, дополнительные удары (первый ход / обычные / способности).',

  'label.apiKey': 'API-ключ',
  'label.character': 'Персонаж',
  'label.boss': 'Босс',
  'label.stage': 'Этап',
  'label.armor': 'Броня',
  'label.hp': 'ХП',
  'label.shield': 'Щит',
  'label.damage': 'Урон',
  'label.rarityStars': 'Редкость / Звёзды',
  'label.rank': 'Ранг',
  'label.xpLevel': 'Уровень / Способность',
  'label.search': 'Поиск',
  'label.faction': 'Фракция',
  'label.ownedOnly': 'Только мои',
  'label.equipment': 'Снаряжение',
  'label.derived': 'Расчёт',
  'label.traits': 'трейты',
  'label.abilityLevels': 'Уровни способностей',
  'label.attack': 'Атака',
  'label.showTop': 'Показать топ',
  'label.melee': 'Ближний бой',
  'label.ranged': 'Дальний бой',
  'label.perHit': 'За удар',
  'label.critPct': 'Крит %',
  'label.critDmg': 'Крит. урон',
  'label.blockPct': 'Блок %',
  'label.blockDmg': 'Урон блока',
  'label.meleeHits': 'Удары б. боя',

  'button.loadApi': 'Загрузить из API',
  'button.loading': 'Загрузка…',
  'button.uploadJson': 'или загрузить player.json',
  'button.addTurn': '+ добавить ход',
  'button.addBuff': '+ добавить баф…',
  'button.remove': 'удалить',
  'button.showTrace': 'показать расчёт',
  'button.hideTrace': 'скрыть расчёт',
  'button.details': 'подробнее',
  'button.hideDetails': 'свернуть',

  'result.firstTurn': 'Первый ход',
  'result.rotationTotal': 'Всего за ротацию',
  'result.turnsToKill': 'ходов до убийства',
  'result.perTurn': 'По ходам',
  'result.pickToSee': 'Выберите персонажа и цель, чтобы увидеть урон.',
  'result.range': 'диапазон',
  'result.crit': 'крит',

  'placeholder.pick': '— выбрать —',
  'placeholder.customStats': '— свои значения —',
  'placeholder.apiKey': 'ваш X-API-KEY uuid',
  'placeholder.search': 'Имя, id или фракция…',

  'comparison.turn1': 'Ход 1',
  'comparison.t1Buffs': 'Бафы Х1',

  'sync.title': 'Отчёт синхронизации',
  'sync.unitsMatched': 'юнитов найдено',
  'sync.unknownItems': 'неизвестных предметов (видимо, реликвии)',

  'rarity.common': 'Обычный',
  'rarity.uncommon': 'Необычный',
  'rarity.rare': 'Редкий',
  'rarity.epic': 'Эпический',
  'rarity.legendary': 'Легендарный',
  'rarity.mythic': 'Мифический',

  'note.assumptions.title': 'Предположения модели',
  'note.assumptions.intro':
    'У этого персонажа недавно добавлены механики. Сверьте с игровым превью урона:',
  'note.assumptions.verify':
    'Если числа не сходятся — сообщите о расхождении, поправим калькулятор.',
  'note.assumptions.multiComponent': 'мульти-удар',
  'note.assumptions.triggered': 'триггер',
  'note.assumptions.teamBuff': 'команд. баф',
  'note.assumptions.scaling': 'масштаб',
  'note.assumptions.cooldown': 'кд',
  'note.assumptions.oncePerBattle': 'раз/бой',
  'note.assumptions.trigger.afterNormal': 'после своей обычной атаки',
  'note.assumptions.trigger.firstAttackOfTurn': 'после первой своей атаки хода',
  'note.assumptions.trigger.targetTrait': 'трейт цели',
  'note.assumptions.scaling.per': 'за',
  'note.assumptions.guildRaidOnly': 'только в рейде гильдии',
};

const de: Dict = {
  'app.title': 'Tacticus Schadensrechner',
  'app.titleSuffix': 'Schadensrechner',
  'app.subtitle': 'Formel: HDTW · Engine v0.1',
  'lang.label': 'Sprache',

  'section.import': 'Import',
  'section.character': 'Charakter',
  'section.target': 'Ziel',
  'section.rotation': 'Rotation',
  'section.damage': 'Schaden',
  'section.comparison': 'Charaktervergleich',
  'section.sync': 'Sync-Bericht',

  'rotation.description':
    'Jeder Zug feuert einen Angriff ab. Bis zu {n} Buffs pro Zug. Buffs übernehmen Stufe & Seltenheit des Buffers (als Referenz), geben einen Schaden-/Krit-Bonus und optional Bonus-Treffer (erster Zug / normal / Fähigkeit).',

  'label.apiKey': 'API-Schlüssel',
  'label.character': 'Charakter',
  'label.boss': 'Boss',
  'label.stage': 'Phase',
  'label.armor': 'Rüstung',
  'label.hp': 'LP',
  'label.shield': 'Schild',
  'label.damage': 'Schaden',
  'label.rarityStars': 'Seltenheit / Sterne',
  'label.rank': 'Rang',
  'label.xpLevel': 'XP / Fähigkeitsstufe',
  'label.search': 'Suche',
  'label.faction': 'Fraktion',
  'label.ownedOnly': 'Nur besessene',
  'label.equipment': 'Ausrüstung',
  'label.derived': 'Abgeleitet',
  'label.traits': 'Merkmale',
  'label.abilityLevels': 'Fähigkeitsstufen',
  'label.attack': 'Angriff',
  'label.showTop': 'Top anzeigen',
  'label.melee': 'Nahkampf',
  'label.ranged': 'Fernkampf',
  'label.perHit': 'Pro Treffer',
  'label.critPct': 'Krit %',
  'label.critDmg': 'Krit-Schaden',
  'label.blockPct': 'Block %',
  'label.blockDmg': 'Blockschaden',
  'label.meleeHits': 'Nahkampftreffer',

  'button.loadApi': 'Aus API laden',
  'button.loading': 'Lädt…',
  'button.uploadJson': 'oder player.json hochladen',
  'button.addTurn': '+ Zug hinzufügen',
  'button.addBuff': '+ Buff hinzufügen…',
  'button.remove': 'entfernen',
  'button.showTrace': 'Berechnung anzeigen',
  'button.hideTrace': 'Berechnung verbergen',
  'button.details': 'Details',
  'button.hideDetails': 'Details ausblenden',

  'result.firstTurn': 'Erster Zug',
  'result.rotationTotal': 'Gesamt-Rotation',
  'result.turnsToKill': 'Züge zum Töten',
  'result.perTurn': 'Pro Zug',
  'result.pickToSee': 'Wähle Charakter und Ziel, um den Schaden zu sehen.',
  'result.range': 'Bereich',
  'result.crit': 'Krit',

  'placeholder.pick': '— wählen —',
  'placeholder.customStats': '— eigene Werte —',
  'placeholder.apiKey': 'dein X-API-KEY uuid',
  'placeholder.search': 'Name, ID oder Fraktion…',

  'comparison.turn1': 'Zug 1',
  'comparison.t1Buffs': 'Z1-Buffs',

  'sync.title': 'Sync-Bericht',
  'sync.unitsMatched': 'Einheiten zugeordnet',
  'sync.unknownItems': 'unbekannte Gegenstände (wahrscheinlich Reliquien)',

  'rarity.common': 'Gewöhnlich',
  'rarity.uncommon': 'Ungewöhnlich',
  'rarity.rare': 'Selten',
  'rarity.epic': 'Episch',
  'rarity.legendary': 'Legendär',
  'rarity.mythic': 'Mythisch',

  'note.assumptions.title': 'Modellannahmen',
  'note.assumptions.intro':
    'Dieser Charakter nutzt neu modellierte Mechaniken. Mit der Ingame-Schadensvorschau vergleichen:',
  'note.assumptions.verify':
    'Bei Abweichungen bitte melden — wir korrigieren den Rechner.',
  'note.assumptions.multiComponent': 'Multi-Komponente',
  'note.assumptions.triggered': 'ausgelöst',
  'note.assumptions.teamBuff': 'Team-Buff',
  'note.assumptions.scaling': 'skaliert',
  'note.assumptions.cooldown': 'CD',
  'note.assumptions.oncePerBattle': '1×/Kampf',
  'note.assumptions.trigger.afterNormal': 'nach eigenem Normalangriff',
  'note.assumptions.trigger.firstAttackOfTurn': 'nach erstem Angriff des Zuges',
  'note.assumptions.trigger.targetTrait': 'Ziel-Merkmal',
  'note.assumptions.scaling.per': 'pro',
  'note.assumptions.guildRaidOnly': 'nur im Gilden-Raid',
};

const fr: Dict = {
  'app.title': 'Calculateur de dégâts Tacticus',
  'app.titleSuffix': '— Calculateur de dégâts',
  'app.subtitle': 'formule: HDTW · moteur v0.1',
  'lang.label': 'Langue',

  'section.import': 'Importer',
  'section.character': 'Personnage',
  'section.target': 'Cible',
  'section.rotation': 'Rotation',
  'section.damage': 'Dégâts',
  'section.comparison': 'Comparaison de personnages',
  'section.sync': 'Rapport de sync',

  'rotation.description':
    "Chaque tour déclenche une attaque. Jusqu'à {n} bonus par tour. Un bonus reprend le niveau et la rareté du buffeur (pour référence), donne un bonus de dégâts/crit et éventuellement des coups bonus (premier tour / normal / compétence).",

  'label.apiKey': 'Clé API',
  'label.character': 'Personnage',
  'label.boss': 'Boss',
  'label.stage': 'Étape',
  'label.armor': 'Armure',
  'label.hp': 'PV',
  'label.shield': 'Bouclier',
  'label.damage': 'Dégâts',
  'label.rarityStars': 'Rareté / Étoiles',
  'label.rank': 'Rang',
  'label.xpLevel': 'XP / Niveau de compétence',
  'label.search': 'Recherche',
  'label.faction': 'Faction',
  'label.ownedOnly': 'Possédés seulement',
  'label.equipment': 'Équipement',
  'label.derived': 'Calculé',
  'label.traits': 'traits',
  'label.abilityLevels': 'Niveaux de compétence',
  'label.attack': 'Attaque',
  'label.showTop': 'Afficher le top',
  'label.melee': 'Mêlée',
  'label.ranged': 'Distance',
  'label.perHit': 'Par coup',
  'label.critPct': 'Crit %',
  'label.critDmg': 'Dégâts crit',
  'label.blockPct': 'Blocage %',
  'label.blockDmg': 'Dégâts bloc',
  'label.meleeHits': 'Coups mêlée',

  'button.loadApi': "Charger depuis l'API",
  'button.loading': 'Chargement…',
  'button.uploadJson': 'ou téléverser player.json',
  'button.addTurn': '+ ajouter un tour',
  'button.addBuff': '+ ajouter un bonus…',
  'button.remove': 'retirer',
  'button.showTrace': 'afficher le détail',
  'button.hideTrace': 'masquer le détail',
  'button.details': 'détails',
  'button.hideDetails': 'masquer détails',

  'result.firstTurn': 'Premier tour',
  'result.rotationTotal': 'Total rotation',
  'result.turnsToKill': 'tours pour tuer',
  'result.perTurn': 'Par tour',
  'result.pickToSee': 'Choisissez un personnage et une cible pour voir les dégâts.',
  'result.range': 'plage',
  'result.crit': 'crit',

  'placeholder.pick': '— choisir —',
  'placeholder.customStats': '— valeurs libres —',
  'placeholder.apiKey': 'votre X-API-KEY uuid',
  'placeholder.search': 'Nom, id ou faction…',

  'comparison.turn1': 'Tour 1',
  'comparison.t1Buffs': 'Bonus T1',

  'sync.title': 'Rapport de sync',
  'sync.unitsMatched': 'unités identifiées',
  'sync.unknownItems': 'objets inconnus (probablement reliques)',

  'rarity.common': 'Commun',
  'rarity.uncommon': 'Peu commun',
  'rarity.rare': 'Rare',
  'rarity.epic': 'Épique',
  'rarity.legendary': 'Légendaire',
  'rarity.mythic': 'Mythique',

  'note.assumptions.title': 'Hypothèses de modélisation',
  'note.assumptions.intro':
    "Ce personnage utilise des mécaniques récemment modélisées. Vérifier avec l'aperçu de dégâts en jeu:",
  'note.assumptions.verify':
    'En cas de divergence, signalez-la pour que nous corrigions le calculateur.',
  'note.assumptions.multiComponent': 'multi-composant',
  'note.assumptions.triggered': 'déclenché',
  'note.assumptions.teamBuff': "bonus d'équipe",
  'note.assumptions.scaling': 'échelle',
  'note.assumptions.cooldown': 'cd',
  'note.assumptions.oncePerBattle': '1×/combat',
  'note.assumptions.trigger.afterNormal': 'après votre attaque normale',
  'note.assumptions.trigger.firstAttackOfTurn': 'après votre 1re attaque du tour',
  'note.assumptions.trigger.targetTrait': 'trait de la cible',
  'note.assumptions.scaling.per': 'par',
  'note.assumptions.guildRaidOnly': 'raid de guilde uniquement',
};

const nl: Dict = {
  'app.title': 'Tacticus Schadeberekening',
  'app.titleSuffix': 'Schadeberekening',
  'app.subtitle': 'formule: HDTW · engine v0.1',
  'lang.label': 'Taal',

  'section.import': 'Importeren',
  'section.character': 'Personage',
  'section.target': 'Doel',
  'section.rotation': 'Rotatie',
  'section.damage': 'Schade',
  'section.comparison': 'Personagevergelijking',
  'section.sync': 'Sync-rapport',

  'rotation.description':
    'Elke beurt vuurt één aanval af. Tot {n} buffs per beurt. Buffs nemen het level en de zeldzaamheid van de buffer over (ter referentie), geven een schade-/critbonus en optioneel extra treffers (eerste beurt / normaal / vaardigheid).',

  'label.apiKey': 'API-sleutel',
  'label.character': 'Personage',
  'label.boss': 'Boss',
  'label.stage': 'Fase',
  'label.armor': 'Pantser',
  'label.hp': 'HP',
  'label.shield': 'Schild',
  'label.damage': 'Schade',
  'label.rarityStars': 'Zeldzaamheid / Sterren',
  'label.rank': 'Rang',
  'label.xpLevel': 'XP / Vaardigheidsniveau',
  'label.search': 'Zoeken',
  'label.faction': 'Factie',
  'label.ownedOnly': 'Alleen bezit',
  'label.equipment': 'Uitrusting',
  'label.derived': 'Afgeleid',
  'label.traits': 'eigenschappen',
  'label.abilityLevels': 'Vaardigheidsniveaus',
  'label.attack': 'Aanval',
  'label.showTop': 'Toon top',
  'label.melee': 'Melee',
  'label.ranged': 'Afstand',
  'label.perHit': 'Per klap',
  'label.critPct': 'Crit %',
  'label.critDmg': 'Crit-schade',
  'label.blockPct': 'Blok %',
  'label.blockDmg': 'Blokschade',
  'label.meleeHits': 'Meleeklappen',

  'button.loadApi': 'Laden van API',
  'button.loading': 'Laden…',
  'button.uploadJson': 'of upload player.json',
  'button.addTurn': '+ beurt toevoegen',
  'button.addBuff': '+ buff toevoegen…',
  'button.remove': 'verwijderen',
  'button.showTrace': 'toon berekening',
  'button.hideTrace': 'verberg berekening',
  'button.details': 'details',
  'button.hideDetails': 'verberg details',

  'result.firstTurn': 'Eerste beurt',
  'result.rotationTotal': 'Rotatietotaal',
  'result.turnsToKill': 'beurten tot dood',
  'result.perTurn': 'Per beurt',
  'result.pickToSee': 'Kies een personage en doel om de schade te zien.',
  'result.range': 'bereik',
  'result.crit': 'crit',

  'placeholder.pick': '— kies —',
  'placeholder.customStats': '— eigen waarden —',
  'placeholder.apiKey': 'jouw X-API-KEY uuid',
  'placeholder.search': 'Naam, id of factie…',

  'comparison.turn1': 'Beurt 1',
  'comparison.t1Buffs': 'B1-buffs',

  'sync.title': 'Sync-rapport',
  'sync.unitsMatched': 'eenheden gekoppeld',
  'sync.unknownItems': 'onbekende items (waarschijnlijk relieken)',

  'rarity.common': 'Gewoon',
  'rarity.uncommon': 'Ongewoon',
  'rarity.rare': 'Zeldzaam',
  'rarity.epic': 'Episch',
  'rarity.legendary': 'Legendarisch',
  'rarity.mythic': 'Mythisch',

  'note.assumptions.title': 'Modelaannames',
  'note.assumptions.intro':
    'Dit personage gebruikt recent gemodelleerde mechanieken. Vergelijk met de in-game schadevoorbeeld:',
  'note.assumptions.verify':
    'Bij afwijking graag melden zodat we de calculator kunnen corrigeren.',
  'note.assumptions.multiComponent': 'multi-component',
  'note.assumptions.triggered': 'geactiveerd',
  'note.assumptions.teamBuff': 'team-buff',
  'note.assumptions.scaling': 'schaalt',
  'note.assumptions.cooldown': 'cd',
  'note.assumptions.oncePerBattle': '1×/gevecht',
  'note.assumptions.trigger.afterNormal': 'na eigen normale aanval',
  'note.assumptions.trigger.firstAttackOfTurn': 'na eigen 1e aanval van beurt',
  'note.assumptions.trigger.targetTrait': 'eigenschap doel',
  'note.assumptions.scaling.per': 'per',
  'note.assumptions.guildRaidOnly': 'alleen in Guild Raid',
};

const dicts: Record<Lang, Dict> = { en, ru, de, fr, nl };

export function translate(
  lang: Lang,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const raw = dicts[lang]?.[key] ?? en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
}

/**
 * React hook — subscribes to the language in the Zustand store and returns a
 * translator bound to it. Usage: `const t = useT(); <span>{t('label.hp')}</span>`.
 * Pass a vars object to interpolate `{name}` placeholders: `t('x.y', { n: 4 })`.
 */
export function useT() {
  const lang = useApp((s) => s.language);
  return (key: string, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
}
