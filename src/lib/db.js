import Dexie from 'dexie';

const db = new Dexie('SenseAI');

db.version(1).stores({
	conversations: '[ownerAddress+id]',
	messageCache: '[ownerAddress+conversationId], [ownerAddress+lastAccessedAt]',
	searchIndex: '[ownerAddress+id]',
	userMetadata: 'ownerAddress',
});

export default db;
