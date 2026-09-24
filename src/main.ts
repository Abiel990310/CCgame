import './style.css';
import { Game } from './game';
import { MainMenu } from './ui/menu';

const canvas = document.getElementById('stage');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Canvas #stage missing from the document');
}

// The game boots into the menu; a slot is what turns it into a session.
const menu: MainMenu = new MainMenu({
  onPlay: (slot, peaceful) => void game.enter(slot, peaceful),
});
const game = new Game(canvas, { onQuit: (notice) => menu.open(notice) });
menu.open();
