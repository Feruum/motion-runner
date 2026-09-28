export const CHARACTERS = [
  { id: 'rogue', name: 'Rogue', model: 'Rogue_Hooded', color: '#78aa8c' },
  { id: 'knight', name: 'Knight', model: 'Knight', color: '#b2bcc8' },
  { id: 'mage', name: 'Mage', model: 'Mage', color: '#8b9edf' },
  { id: 'barbarian', name: 'Barbarian', model: 'Barbarian', color: '#d3a17d' },
] as const;

export type CharacterId = typeof CHARACTERS[number]['id'];
