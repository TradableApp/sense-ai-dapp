import Dexie from 'dexie';

import { resolveLocalStoreName } from './localStoreName';
import type { SenseAIDb } from './types';

// One database per agent contract (see localStoreName; vite.config.ts checks the
// same values before a testnet or mainnet build). A database written under the
// earlier fixed name is left as it is: it cannot say which agent its rows belong to, and
// everything in it is a copy of what the subgraph and storage serve, so it is fetched again.
const db = new Dexie(
	resolveLocalStoreName(
		import.meta.env.VITE_CHAIN_ID,
		import.meta.env.VITE_AGENT_CONTRACT_ADDRESS,
		import.meta.env.MODE,
	),
) as Dexie & SenseAIDb;

db.version(1).stores({
	conversations: '[ownerAddress+id]',
	messageCache: '[ownerAddress+conversationId], [ownerAddress+lastAccessedAt]',
	searchIndex: '[ownerAddress+id]',
	userMetadata: 'ownerAddress',
});

export default db;
