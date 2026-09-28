import { CHARACTERS } from './characters';
import type { CharacterId } from './characters';
import './character-picker.css';

export class CharacterPicker {
  readonly element = document.createElement('fieldset');
  private selected: CharacterId = 'rogue';
  private busy = false;
  private readonly status = document.createElement('span');
  private readonly buttons = new Map<CharacterId, HTMLButtonElement>();

  constructor(private readonly onSelect: (id: CharacterId) => Promise<void>) {
    this.element.className = 'runner-picker';
    const legend = document.createElement('legend');
    legend.textContent = 'Choose your runner';
    const choices = document.createElement('div');
    choices.className = 'runner-choices';
    for (const character of CHARACTERS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'runner-choice';
      button.textContent = character.name;
      button.style.setProperty('--runner-color', character.color);
      button.setAttribute('aria-pressed', String(character.id === this.selected));
      button.addEventListener('click', () => void this.choose(character.id));
      this.buttons.set(character.id, button);
      choices.append(button);
    }
    this.status.className = 'runner-choice-status';
    this.status.setAttribute('role', 'status');
    this.status.textContent = 'Same moves. Pick your style.';
    this.element.append(legend, choices, this.status);
  }

  private async choose(id: CharacterId) {
    if (this.busy || id === this.selected) return;
    const character = CHARACTERS.find(item => item.id === id)!;
    this.busy = true;
    this.element.disabled = true;
    this.element.setAttribute('aria-busy', 'true');
    this.status.textContent = `Loading ${character.name}…`;
    try {
      await this.onSelect(id);
      this.selected = id;
      for (const [key, button] of this.buttons) button.setAttribute('aria-pressed', String(key === id));
      this.status.textContent = `${character.name} is ready. Same moves, your style.`;
    } catch {
      this.status.textContent = `${character.name} could not load. Choose another runner.`;
    } finally {
      this.busy = false;
      this.element.disabled = false;
      this.element.removeAttribute('aria-busy');
    }
  }
}
