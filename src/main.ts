import './style.css';
import { Game } from './game';
import { MainMenu } from './ui/menu';
import { icon, mountIcons } from './ui/icons';
import { JoinScreen } from './ui/coop';
import { cleanCode } from './net/protocol';

const canvas = document.getElementById('stage');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Canvas #stage missing from the document');
}

mountIcons();

// The game boots into the menu; a slot is what turns it into a session.
const menu: MainMenu = new MainMenu({
  onPlay: (slot, peaceful) => void game.enter(slot, peaceful),
});
const game = new Game(canvas, {
  onQuit: (notice) => {
    menu.open(notice);
    game.showcase();
  },
});
menu.open();
game.showcase();

// Co-op's front door sits beside the island buttons: joining is another way in.
const join = new JoinScreen(async (code, name) => {
  await game.joinGame(code, name);
  menu.close();
});
const joinButton = document.createElement('button');
joinButton.className = 'ghost-btn coop-join-btn';
joinButton.innerHTML = `${icon('users')}Join a friend`;
joinButton.addEventListener('click', () => join.open());
document.querySelector('.menu-actions')?.appendChild(joinButton);
const invited = cleanCode(new URLSearchParams(location.search).get('join') ?? '');
if (invited) join.open(invited);
