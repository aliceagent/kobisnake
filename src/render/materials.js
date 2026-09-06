// @ts-check
import * as THREE from 'three';
import { SETTINGS } from '../core/settings.js';

/**
 * The only place in the codebase that is allowed to name a colour (`CLAUDE.md` "The never list"). Every value
 * here is quoted from `docs/design/DESIGN-DECISIONS.md` — §2.7 for the player colour catalogue and §3
 * ("Materials bible") for the arena — and nothing is invented.
 *
 * The player colours are **not** duplicated here: `SETTINGS.colors` is the catalogue (it is a design tunable,
 * which is why §4 puts it there), and this file turns a catalogue entry into a three.js material. That is the
 * split `src/core/settings.js` asks for in its own `ColorCatalogue` note, and closing it was a Sprint 03
 * finding.
 */

/**
 * Arena and prop colours, quoted from `DESIGN-DECISIONS §3`. Player colours live in `SETTINGS.colors`; use
 * {@link snakeColorHex}.
 */
export const COLORS = {
  /**
   * Player 1 plastic red. Kept as a named constant because the Sprint 01 scaffold scene uses it; new code
   * should ask {@link snakeColorHex} for a player's colour rather than reaching for a specific one.
   */
  red: 0xe3261b,
  /** Arena floor tiles: the 70 % green and the 30 % green (DESIGN-DECISIONS §3 "Materials bible"). */
  floorGreen: 0x3db54a,
  floorGreenAlt: 0x33a241,
  /** Wall bricks: grey is the grey-box wall; yellow and blue arrive with the arena art in Sprint 09. */
  wallGrey: 0x7c8088,
  /** Hemisphere fill: sky above, ground below (DESIGN-DECISIONS §3 "Materials bible"). */
  skyFill: 0xcfe9ff,
  groundFill: 0x5a6a40,
  /** Key light colour (DESIGN-DECISIONS §3 "Materials bible"). */
  keyLight: 0xfff3e0,
  /**
   * The snake's eyes: "large white eyes with black pupils" (`07-snake-character-sheet.png`, and the head in
   * every gameplay image). Neither is a design tunable — they are what an eye is made of.
   */
  eyeWhite: 0xffffff,
  eyePupil: 0x111111,
  /**
   * White, for a material whose real colour comes from an `InstancedMesh`'s per-instance colour: three
   * multiplies the two, so the material has to be white for the instance colour to come out unchanged.
   */
  instanceBase: 0xffffff,
  /**
   * The laser beams (`DESIGN-DECISIONS §3` "Materials bible": "Lasers: red `#FF2A2A` emissive intensity 4").
   * KS-04-02 is grey-box geometry only — the additive floor glow the same line describes is Sprint 10 — but
   * the colour itself is already locked, so the beams, their emitters' lenses and the closing-phase direction
   * arrows all draw from this one name rather than inventing a shade.
   */
  laserRed: 0xff2a2a,
};

/** Plastic look shared by every brick in the game: matte, not metal (DESIGN-DECISIONS §3). */
const PLASTIC_ROUGHNESS = 0.35;
const PLASTIC_METALNESS = 0.0;

/**
 * Build the standard toy-plastic material for a colour from {@link COLORS} or {@link snakeColorHex}.
 *
 * @param {number | string} color hex colour taken from the catalogue, never a literal at the call site
 * @returns {THREE.MeshStandardMaterial}
 */
export function createPlasticMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: PLASTIC_ROUGHNESS,
    metalness: PLASTIC_METALNESS,
  });
}

/**
 * The plastic colour of a player's snake, by catalogue name (`DESIGN-DECISIONS §2.7`).
 *
 * @param {string} name - a key of `SETTINGS.colors`, e.g. `'red'`, `'blue'`
 * @param {import('../core/settings.js').Settings} [settings]
 * @returns {string} the hex string from the catalogue
 */
export function snakeColorHex(name, settings = SETTINGS) {
  const catalogue = /** @type {Record<string, string>} */ (settings.colors);
  const hex = catalogue[name];
  if (hex === undefined) {
    throw new RangeError(`materials: "${name}" is not a colour in SETTINGS.colors`);
  }
  return hex;
}

/**
 * Material for a snake in the given catalogue colour.
 *
 * @param {string} name
 * @param {import('../core/settings.js').Settings} [settings]
 * @returns {THREE.MeshStandardMaterial}
 */
export function createSnakeMaterial(name, settings = SETTINGS) {
  return createPlasticMaterial(snakeColorHex(name, settings));
}

/**
 * Material for a mesh whose colour is supplied per instance (the floor tiles). White, because three
 * multiplies the material colour by the instance colour.
 *
 * @returns {THREE.MeshStandardMaterial}
 */
export function createInstanceColoredMaterial() {
  return createPlasticMaterial(COLORS.instanceBase);
}

/**
 * The eye whites and the pupils of a snake head.
 *
 * @returns {{ white: THREE.MeshStandardMaterial, pupil: THREE.MeshStandardMaterial }}
 */
export function createEyeMaterials() {
  return {
    white: createPlasticMaterial(COLORS.eyeWhite),
    pupil: createPlasticMaterial(COLORS.eyePupil),
  };
}

/**
 * Emissive intensity of the laser material (`DESIGN-DECISIONS §3` "Materials bible"). Not a colour, so it
 * lives beside {@link createLaserMaterial} rather than in {@link COLORS}, but it is quoted from the same line
 * as `laserRed` for the same reason: KS-04-02 draws grey-box beams in the locked colour, not an invented one.
 */
const LASER_EMISSIVE_INTENSITY = 4;

/**
 * The laser beams, their emitter lenses and the closing-phase direction arrows (KS-04-02): the plastic look
 * with an emissive push, so the beam still reads as lit red without depending on the scene's key light.
 *
 * @returns {THREE.MeshStandardMaterial}
 */
export function createLaserMaterial() {
  const material = createPlasticMaterial(COLORS.laserRed);
  material.emissive = new THREE.Color(COLORS.laserRed);
  material.emissiveIntensity = LASER_EMISSIVE_INTENSITY;
  return material;
}

/**
 * The apple: a red body and a green leaf. Both colours come from the catalogue rather than being invented —
 * `DESIGN-DECISIONS §1 row 1` fixes the apple as "red body, green leaf" and gives no separate hex, and the
 * catalogue is where the game's reds and greens are defined.
 *
 * @param {import('../core/settings.js').Settings} [settings]
 * @returns {{ body: THREE.MeshStandardMaterial, leaf: THREE.MeshStandardMaterial }}
 */
export function createAppleMaterials(settings = SETTINGS) {
  return {
    body: createPlasticMaterial(snakeColorHex('red', settings)),
    leaf: createPlasticMaterial(snakeColorHex('green', settings)),
  };
}
