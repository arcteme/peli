import { Game } from './game/Game';
import { MainMenu } from './ui/MainMenu';

// Create canvas
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!canvas) throw new Error('Canvas element not found');

// Create game instance
const game = new Game(canvas);

// Create main menu
const menu = new MainMenu();

menu.onStartGame((aircraftId, playerName) => {
  menu.hide();
  game.start(aircraftId, playerName);
});
