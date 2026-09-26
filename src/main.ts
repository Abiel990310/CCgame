import './style.css';
import { hasNetlog } from './net/netlog';
import { Game } from './game';
import { MainMenu } from './ui/menu';
import { icon, mountIcons } from './ui/icons';
import { JoinScreen } from './ui/coop';
import { cleanCode } from './net/protocol';
import { account } from './account';
import { AccountFlow } from './account/flow';

const canvas = document.getElementById('stage');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Canvas #stage missing from the document');
}

mountIcons();

// The game boots into the menu; a slot is what turns it into a session.
const menu: MainMenu = new MainMenu({
  onPlay: (slot, peaceful) => void (flow ? flow.play(slot, peaceful) : game.enter(slot, peaceful)),
  onAccount: () => flow?.openAccount(),
  onPlayCloud: (world) => void flow?.playCloud(world, false),
  onUpload: async (slot) => flow?.upload(slot),
  onDeleteCloud: async (world) => flow?.deleteCloud(world),
  onRenamed: (slot) => flow?.renamed(slot),
  onJoinFriend: (world) => void flow?.joinFriend(world),
});
const game: Game = new Game(canvas, {
  onQuit: (notice) => {
    menu.open(notice);
    // A co-op game that ended on its own is worth being able to look into.
    if (notice && hasNetlog()) menu.offerNetLog();
    game.showcase();
    void flow?.refresh();
  },
  onSetAccess: async (access): Promise<void> => flow?.setAccess(access),
});
// Accounts exist only when this build names a server for them; see `account/config.ts`.
const flow: AccountFlow | null = account ? new AccountFlow(account, menu, game) : null;
menu.open();
game.showcase();

// Co-op's front door sits beside the island buttons: joining is another way in.
const join = new JoinScreen(async (code, name) => {
  // Signed in, a friend's character follows the account rather than this browser.
  const token = account?.userId ? `u:${account.userId}` : undefined;
  await game.joinGame(code, name, token);
  menu.close();
});
const joinButton = document.createElement('button');
joinButton.className = 'ghost-btn coop-join-btn';
joinButton.innerHTML = `${icon('users')}Join a friend`;
joinButton.addEventListener('click', () => join.open());
document.querySelector('.menu-actions')?.appendChild(joinButton);
const invited = cleanCode(new URLSearchParams(location.search).get('join') ?? '');
// Back from reloading onto the host's version: go straight in, as they meant to.
if (invited) join.open(invited, new URLSearchParams(location.search).has('fresh'));
