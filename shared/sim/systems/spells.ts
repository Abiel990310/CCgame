import { MOBS } from '../../data/mobs';
import { SPELL_IDS, SPELLS, spellCooldown, spellPerk, spellPower } from '../../data/spells';
import { COMBAT } from '../constants';
import { distance, normalize } from '../math';
import { perk } from '../perks';
import { researchBonuses } from '../research';
import type { Player, PlayerInput, SpellId, Vec2, World } from '../types';
import { damageMob, leadAim, nearestMob, situational } from './combat';

/** How long the player holds the casting pose. */
export const CAST_POSE = 0.3;

/** A bolt turns toward a creature this close rather than flying where the player faces. */
const BOLT_ASSIST = 320;

export function spellLevel(player: Player, id: SpellId): number {
  return perk(player, spellPerk(id));
}

/** The spells a player has learned, in table order, which is the order Q cycles through. */
export function knownSpells(player: Player): SpellId[] {
  return SPELL_IDS.filter((id) => spellLevel(player, id) > 0);
}

/** Readies a learned spell for Q. Returns false for one the player has not learned. */
export function readySpell(player: Player, id: SpellId): boolean {
  if (spellLevel(player, id) <= 0) return false;
  player.spell = id;
  return true;
}

/**
 * The pressed half of magic: Q casts the readied spell when it has come off
 * cooldown. Like the swing, only the press counts, so holding Q does not
 * machine-gun fireballs.
 */
export function stepSpells(world: World, player: Player, input: PlayerInput, dt: number): void {
  const cds = player.spellCd;
  if (cds) for (const id of Object.keys(cds) as SpellId[]) cds[id] = Math.max(0, (cds[id] ?? 0) - dt);

  if (player.casting) player.casting = Math.max(0, player.casting - dt);

  const holding = input.cast === true;
  const pressed = holding && !player.castHeld;
  player.castHeld = holding;
  if (!pressed || player.downed > 0) return;

  const id = player.spell;
  if (!id) return;
  const level = spellLevel(player, id);
  if (level <= 0 || (cds?.[id] ?? 0) > 0) return;
  (player.spellCd ??= {})[id] = spellCooldown(id, level);
  player.casting = CAST_POSE;
  castSpell(world, player, id, level);
}

function castSpell(world: World, player: Player, id: SpellId, level: number): void {
  const def = SPELLS[id];
  const power = spellPower(id, level);
  const damage = power * player.stats.damage * researchBonuses(world).damage * situational(world, player);
  let dir: Vec2 = normalize(player.facing);
  if (dir.x === 0 && dir.y === 0) dir = { x: 0, y: 1 };
  let hits = 0;

  switch (def.shape) {
    case 'bolt': {
      const speed = def.speed ?? 400;
      const target = nearestMob(world, player, BOLT_ASSIST);
      if (target) dir = leadAim(player.pos, target, speed);
      player.facing = { ...dir };
      world.projectiles.push({
        id: world.nextId++,
        pos: { x: player.pos.x + dir.x * 12, y: player.pos.y + dir.y * 12 },
        vel: { x: dir.x * speed, y: dir.y * speed },
        damage,
        life: COMBAT.projectileLife,
        ownerId: player.id,
        weapon: 'fireball',
        pierce: 0,
        targetId: target?.id,
      });
      break;
    }
    case 'nova': {
      // Copied, since a creature that splits as it dies adds to the list.
      for (const mob of [...world.mobs]) {
        if (mob.hp <= 0) continue;
        const mdef = MOBS[mob.type];
        const dist = distance(mob.pos, player.pos);
        if (dist > def.radius + mdef.radius) continue;
        if (def.chill) mob.chill = Math.max(mob.chill ?? 0, def.chill);
        if (def.knock && !mdef.bossEvery && dist > 0) {
          mob.vel.x += ((mob.pos.x - player.pos.x) / dist) * def.knock;
          mob.vel.y += ((mob.pos.y - player.pos.y) / dist) * def.knock;
        }
        damageMob(world, mob, damage, player.id);
        hits++;
      }
      break;
    }
    case 'mend':
      player.hp = Math.min(player.maxHp, player.hp + power);
      break;
  }

  world.events.push({ kind: 'cast', playerId: player.id, spell: id, pos: { ...player.pos }, dir, radius: def.radius, hits });
}
