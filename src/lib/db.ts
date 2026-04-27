import Dexie from 'dexie';

import type { SenseAIDb } from './types';

const db = new Dexie('SenseAI') as Dexie & SenseAIDb;

db.version(1).stores({
	conversations: '[ownerAddress+id]',
	messageCache: '[ownerAddress+conversationId], [ownerAddress+lastAccessedAt]',
	searchIndex: '[ownerAddress+id]',
	userMetadata: 'ownerAddress',
});

export default db;
