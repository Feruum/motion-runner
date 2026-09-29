import { blobatarUri } from 'blobatar/uri';
import { CHARACTERS } from './characters';
import type { CharacterId } from './characters';
import './character-picker.css';

const PROFILE_NAME_KEY = 'motion-runner-profile-name';
const PERSONAL_BEST_KEY = 'motion-runner-best';
const DEFAULT_PROFILE_NAME = 'Runner';

function readLocalValue(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function saveLocalValue(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* The profile remains usable without storage. */ }
}

function readPersonalBest(): number {
  const best = Number(readLocalValue(PERSONAL_BEST_KEY));
  return Number.isFinite(best) && best > 0 ? best : 0;
}

export function getRunnerName(): string {
  return readLocalValue(PROFILE_NAME_KEY)?.trim().slice(0, 24) || DEFAULT_PROFILE_NAME;
}

export class CharacterPicker {
  readonly element = document.createElement('fieldset');
  private selected: CharacterId = 'rogue';
  private busy = false;
  private readonly status = document.createElement('span');
  private readonly profileName = document.createElement('input');
  private readonly profileAvatar = document.createElement('img');
  private readonly buttons = new Map<CharacterId, HTMLButtonElement>();

  constructor(private readonly onSelect: (id: CharacterId) => Promise<void>) {
    this.element.className = 'runner-picker';
    const legend = document.createElement('legend');
    legend.textContent = 'Choose your runner';

    const profile = document.createElement('div');
    profile.className = 'runner-profile';
    profile.setAttribute('role', 'group');
    profile.setAttribute('aria-label', 'Runner profile');
    this.profileAvatar.className = 'runner-profile-avatar';
    this.profileAvatar.width = 52;
    this.profileAvatar.height = 52;
    const profileCopy = document.createElement('div');
    profileCopy.className = 'runner-profile-copy';
    const profileKicker = document.createElement('span');
    profileKicker.className = 'runner-profile-kicker';
    profileKicker.textContent = 'LOCAL PROFILE';
    const nameLabel = document.createElement('label');
    nameLabel.className = 'runner-profile-name-label';
    nameLabel.textContent = 'Runner name';
    this.profileName.className = 'runner-profile-name';
    this.profileName.type = 'text';
    this.profileName.setAttribute('aria-label', 'Runner name');
    this.profileName.maxLength = 24;
    this.profileName.setAttribute('autocomplete', 'nickname');
    this.profileName.value = getRunnerName();
    nameLabel.append(this.profileName);
    profileCopy.append(profileKicker, nameLabel);
    const best = document.createElement('div');
    best.className = 'runner-profile-best';
    const bestLabel = document.createElement('span');
    bestLabel.textContent = 'PERSONAL BEST';
    const bestScore = document.createElement('strong');
    bestScore.textContent = String(readPersonalBest());
    best.append(bestLabel, bestScore);
    profile.append(this.profileAvatar, profileCopy, best);
    this.updateAvatar(this.profileName.value);
    this.profileName.addEventListener('input', () => {
      const name = this.profileName.value.trim() || DEFAULT_PROFILE_NAME;
      this.updateAvatar(name);
      saveLocalValue(PROFILE_NAME_KEY, name.slice(0, 24));
    });

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
    this.element.append(legend, profile, choices, this.status);
  }

  private updateAvatar(name: string) {
    this.profileAvatar.src = blobatarUri(name);
    this.profileAvatar.alt = `${name} avatar`;
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
