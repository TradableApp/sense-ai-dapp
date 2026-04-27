/**
 * Loads a state object from localStorage.
 * @param {string} key The key to load from localStorage.
 * @returns {any | null} The parsed state, or null if it doesn't exist or fails to parse.
 */
export const loadState = (key: string): unknown => {
	try {
		const serializedState = localStorage.getItem(key);
		if (serializedState === null) {
			return null;
		}
		return JSON.parse(serializedState);
	} catch (err) {
		console.error('Error loading state from localStorage:', err);
		return null;
	}
};

/**
 * Saves a state object to localStorage.
 * @param {any} state The state to save.
 * @param {string} key The key to save the state under.
 */
export const saveState = (state: unknown, key: string): void => {
	try {
		const serializedState = JSON.stringify(state);
		localStorage.setItem(key, serializedState);
	} catch (err) {
		console.error('Error saving state to localStorage:', err);
	}
};
