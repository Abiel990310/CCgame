import { describe, expect, it } from 'vitest';
import { CloudApi, type Session, type SessionStore } from '../account/api';
import { Cloud } from '../account/cloud';

/**
 * The account schema, exercised against a real backend. It needs one running,
 * so it is skipped unless `CCGAME_CLOUD_URL` and `CCGAME_CLOUD_KEY` say where:
 * `docs/cloud/README.md` has how to stand one up locally. CI has none, and the
 * rest of the suite never touches the network.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const url = env.CCGAME_CLOUD_URL ?? '';
const key = env.CCGAME_CLOUD_KEY ?? '';

function memoryStore(): SessionStore {
  let session: Session | null = null;
  return { load: () => session, save: (s) => void (session = s) };
}

const run = Date.now().toString(36).slice(-6);

async function player(tag: string): Promise<Cloud> {
  const api = new CloudApi({ url, key }, memoryStore());
  const result = await api.signUp(`${tag}-${run}@example.test`, 'correct-horse', `${tag}_${run}`);
  expect(result.kind).toBe('signed-in');
  return new Cloud(api);
}

const bundle = (text: string): string => JSON.stringify({ v: 1, e: { '': text } });
const summary = { night: 1, level: 2, playSeconds: 30 };

describe.skipIf(!url || !key)('cloud schema, live', () => {
  it('gives each account a profile under its chosen name', async () => {
    const api = new CloudApi({ url, key }, memoryStore());
    const cloud = new Cloud(api);
    expect(await cloud.nameAvailable(`Ann_${run}`)).toBe(true);
    await api.signUp(`ann-${run}@example.test`, 'correct-horse', `Ann_${run}`);
    expect((await cloud.myProfile())?.name).toBe(`Ann_${run}`);
    expect(await cloud.nameAvailable(`ann_${run}`)).toBe(false);
    expect(await cloud.nameAvailable('no spaces')).toBe(false);

    // Signing up under a taken name still makes the account, with digits added.
    const twin = new CloudApi({ url, key }, memoryStore());
    await twin.signUp(`twin-${run}@example.test`, 'correct-horse', `Ann_${run}`);
    const twinName = (await new Cloud(twin).myProfile())?.name ?? '';
    expect(twinName).not.toBe(`Ann_${run}`);
    expect(twinName.startsWith(`Ann_`)).toBe(true);

    await api.signOut();
    await expect(cloud.listWorlds()).rejects.toThrow();
  });

  it('refuses a wrong password in words a player can read', async () => {
    const api = new CloudApi({ url, key }, memoryStore());
    await api.signUp(`pw-${run}@example.test`, 'correct-horse', `Pw_${run}`);
    await api.signOut();
    await expect(api.signIn(`pw-${run}@example.test`, 'wrong-horse')).rejects.toThrow('do not match');
    await api.signIn(`pw-${run}@example.test`, 'correct-horse');
    expect(api.current).not.toBeNull();
  });

  it('makes friends only when both agree', async () => {
    const a = await player('Fa');
    const b = await player('Fb');
    expect(await a.addFriend(`nobody_${run}`)).toBe('not_found');
    expect(await a.addFriend(`Fa_${run}`)).toBe('self');
    expect(await a.addFriend(`fb_${run}`)).toBe('sent');
    expect((await a.friends()).outgoing.map((p) => p.name)).toEqual([`Fb_${run}`]);
    const incoming = (await b.friends()).incoming;
    expect(incoming.map((p) => p.name)).toEqual([`Fa_${run}`]);
    expect((await b.friends()).friends).toEqual([]);

    await b.answerRequest(incoming[0].id, true);
    expect((await a.friends()).friends.map((p) => p.name)).toEqual([`Fb_${run}`]);
    expect((await b.friends()).incoming).toEqual([]);
    expect(await a.addFriend(`Fb_${run}`)).toBe('already');

    // Asking someone who already asked you makes you friends at once.
    const c = await player('Fc');
    expect(await c.addFriend(`Fa_${run}`)).toBe('sent');
    expect(await a.addFriend(`Fc_${run}`)).toBe('friends');

    await a.removeFriend((await a.friends()).friends.find((f) => f.name === `Fb_${run}`)!.id);
    expect((await b.friends()).friends).toEqual([]);
  });

  it('keeps a world private until its owner opens it to friends', async () => {
    const owner = await player('Wo');
    const friend = await player('Wf');
    const stranger = await player('Ws');
    await owner.addFriend(`Wf_${run}`);
    await friend.answerRequest(owner.userId!, true);

    const { id, rev } = await owner.createWorld('Saltpine', 'private', summary, bundle('island'));
    expect(rev).toBe(1);
    expect((await owner.listWorlds()).map((w) => w.id)).toEqual([id]);
    expect(await friend.listWorlds()).toEqual([]);
    expect(await friend.loadWorld(id)).toBeNull();

    await owner.updateWorld(id, { access: 'friends' });
    const seen = await friend.listWorlds();
    expect(seen.map((w) => [w.name, w.mine, w.live])).toEqual([['Saltpine', false, false]]);
    expect(await stranger.listWorlds()).toEqual([]);
    // Friends may join, not read the save or play it without the owner.
    expect(await friend.loadWorld(id)).toBeNull();
    expect(await friend.claimWorld(id, crypto.randomUUID())).toEqual({ ok: false, reason: 'missing' });

    const lease = crypto.randomUUID();
    expect((await owner.claimWorld(id, lease)).ok).toBe(true);
    expect(await owner.beatWorld(id, lease, 'ABCDE')).toBe(true);
    const live = (await friend.listWorlds())[0];
    expect([live.live, live.room]).toEqual([true, 'ABCDE']);

    await owner.releaseWorld(id, lease);
    expect((await friend.listWorlds())[0].room).toBeNull();
    await owner.deleteWorld(id);
    expect(await friend.listWorlds()).toEqual([]);
  });

  it('lets only the device holding the lease save', async () => {
    const owner = await player('Ld');
    const { id } = await owner.createWorld('Gullrock', 'private', summary, bundle('v1'));
    const phone = crypto.randomUUID();
    const laptop = crypto.randomUUID();

    expect(await owner.claimWorld(id, phone)).toEqual({ ok: true, rev: 1, access: 'private' });
    expect(await owner.saveWorld(id, phone, summary, bundle('v2'))).toBe(2);

    const busy = await owner.claimWorld(id, laptop);
    expect(busy.ok).toBe(false);
    expect(busy.ok === false && busy.reason).toBe('busy');
    expect(await owner.saveWorld(id, laptop, summary, bundle('laptop'))).toBeNull();

    expect(await owner.claimWorld(id, laptop, true)).toEqual({ ok: true, rev: 2, access: 'private' });
    expect(await owner.beatWorld(id, phone, null)).toBe(false);
    expect(await owner.saveWorld(id, phone, summary, bundle('phone'))).toBeNull();
    expect(await owner.saveWorld(id, laptop, { ...summary, night: 4 }, bundle('v3'))).toBe(3);

    const loaded = await owner.loadWorld(id);
    expect(loaded?.data).toBe(bundle('v3'));
    expect(loaded?.rev).toBe(3);
    expect((await owner.listWorlds())[0].summary.night).toBe(4);
  });

  it('refuses a save too big for the free database', async () => {
    const owner = await player('Big');
    await expect(owner.createWorld('Huge', 'private', summary, 'x'.repeat(4_000_001))).rejects.toThrow('too big');
  });
});
