export type Lang = 'fi' | 'en';

let currentLang: Lang = 'fi';

export function setLang(lang: Lang) {
  currentLang = lang;
}

export function getLang(): Lang {
  return currentLang;
}

const translations: Record<Lang, Record<string, string>> = {
  fi: {
    // MainMenu
    'menu.subtitle':          'WW2-pienoislentokoneita taistelee Keravan yllä',
    'menu.placeholder':       'Kirjoita lentäjänimi',
    'menu.chooseAircraft':    'Valitse kone',
    'menu.takeOff':           'LÄHTÖ',
    'menu.stat.speed':        'Nopeus',
    'menu.stat.agility':      'Ketteryys',
    'menu.stat.power':        'Teho',
    'menu.stat.armor':        'Panssari',
    'menu.ctrl.pitch':        'Kaarros',
    'menu.ctrl.roll':         'Kallistus',
    'menu.ctrl.yaw':          'Käännös',
    'menu.ctrl.throttleUp':   'Kaasu +',
    'menu.ctrl.throttleDown': 'Kaasu −',
    'menu.ctrl.fire':         'Tulita',
    'menu.ctrl.camera':       'Kamera vaihto',
    'menu.ctrl.mouse':        'Hiiri · ohjaus',

    // HUD
    'hud.alt':        'm KORK',
    'hud.shotDown':   'AMMUTTU ALAS',
    'hud.respawning': 'Uudelleensyntyminen...',

    // In-game messages
    'game.flying':        'Lennät $name — Napsauta hiiren ohjaukselle',
    'game.cockpitView':   'Ohjaamon näkymä',
    'game.chaseView':     'Takaa-ajonäkymä',
    'game.respawned':     'Uudelleensyntyit!',
    'game.inspectorOn':   'Tarkastelutila PÄÄLLÄ — WASD lentää, Shift=nopea, F3 pois',
    'game.inspectorOff':  'Tarkastelutila POIS',
    'game.calibratorOff': 'Tekstuurikalibraattori POIS',
    'game.calibratorOn':  'Tekstuurikalibraattori PÄÄLLÄ — Nuolinäppäimet siirtyy, F4 pois',

    // Kill feed
    'kill.shotDown':     'ammuttu alas',
    'kill.dogfight':     'ammuttu alas taistelussa',
    'kill.youShotDown':  'Ammuit alas $name',
    'kill.youWereShot':  'Sinut ammuttiin alas!',
  },

  en: {
    // MainMenu
    'menu.subtitle':          'WW2 Model Aircraft Combat over Kerava, Finland',
    'menu.placeholder':       'Enter your pilot name',
    'menu.chooseAircraft':    'Choose your aircraft',
    'menu.takeOff':           'TAKE OFF',
    'menu.stat.speed':        'Speed',
    'menu.stat.agility':      'Agility',
    'menu.stat.power':        'Power',
    'menu.stat.armor':        'Armor',
    'menu.ctrl.pitch':        'Pitch',
    'menu.ctrl.roll':         'Roll',
    'menu.ctrl.yaw':          'Yaw',
    'menu.ctrl.throttleUp':   'Throttle Up',
    'menu.ctrl.throttleDown': 'Throttle Down',
    'menu.ctrl.fire':         'Fire',
    'menu.ctrl.camera':       'Toggle Camera',
    'menu.ctrl.mouse':        'Mouse · flight control',

    // HUD
    'hud.alt':        'm ALT',
    'hud.shotDown':   'SHOT DOWN',
    'hud.respawning': 'Respawning...',

    // In-game messages
    'game.flying':        'Flying $name — Click to enable mouse control',
    'game.cockpitView':   'Cockpit View',
    'game.chaseView':     'Chase View',
    'game.respawned':     'Respawned!',
    'game.inspectorOn':   'Inspector mode ON — WASD fly, Shift=fast, F3 exit',
    'game.inspectorOff':  'Inspector mode OFF',
    'game.calibratorOff': 'Texture calibrator OFF',
    'game.calibratorOn':  'Texture calibrator ON — Arrow keys to move, F4 to exit',

    // Kill feed
    'kill.shotDown':    'shot down',
    'kill.dogfight':    'shot down in a dogfight',
    'kill.youShotDown': 'You shot down $name',
    'kill.youWereShot': 'You were shot down!',
  },
};

/**
 * Translate a key. Optionally interpolate $name with a value.
 */
export function t(key: string, name?: string): string {
  const str = translations[currentLang][key] ?? translations['en'][key] ?? key;
  return name !== undefined ? str.replace('$name', name) : str;
}
