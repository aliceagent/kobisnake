// @ts-check
import * as THREE from 'three';

/**
 * The only place in the codebase that is allowed to name a colour. Every value here is quoted from
 * `docs/design/DESIGN-DECISIONS.md` (§2.7 colour catalogue and §3 "Materials bible"); nothing is invented.
 * Later sprints add the rest of the catalogue and the real arena materials to this file.
 */
export const COLORS = {
  /** Player 1 plastic red (DESIGN-DECISIONS §2.7). */
  red: 0xe3261b,
  /** Arena floor tile green, the 70 % tile (DESIGN-DECISIONS §3 "Materials bible"). */
  floorGreen: 0x3db54a,
  /** Hemisphere fill: sky above, ground below (DESIGN-DECISIONS §3 "Materials bible"). */
  skyFill: 0xcfe9ff,
  groundFill: 0x5a6a40,
  /** Key light colour (DESIGN-DECISIONS §3 "Materials bible"). */
  keyLight: 0xfff3e0,
};

/** Plastic look shared by every brick in the game: matte, not metal (DESIGN-DECISIONS §3). */
const PLASTIC_ROUGHNESS = 0.35;
const PLASTIC_METALNESS = 0.0;

/**
 * Build the standard toy-plastic material for a colour from {@link COLORS}.
 *
 * @param {number} color hex colour taken from {@link COLORS}, never a literal at the call site
 * @returns {THREE.MeshStandardMaterial}
 */
export function createPlasticMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: PLASTIC_ROUGHNESS,
    metalness: PLASTIC_METALNESS,
  });
}
