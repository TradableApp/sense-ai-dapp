import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const ThemeProviderContext = createContext({
	theme: 'system',
	setTheme: () => null,
});

export function ThemeProvider({
	children,
	defaultTheme = 'system',
	storageKey = 'vite-ui-theme',
	...props
}) {
	const [theme, setTheme] = useState(() => localStorage.getItem(storageKey) || defaultTheme);

	useEffect(() => {
		const root = window.document.documentElement;

		root.classList.remove('light', 'dark');

		if (theme === 'system') {
			const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
				? 'dark'
				: 'light';
			root.classList.add(systemTheme);
		} else {
			root.classList.add(theme);
		}
	}, [theme]);

	// This effect sets up a listener to specifically handle live changes
	// to the operating system's theme when the user has selected "System".
	useEffect(() => {
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

		// The handler function that will be called when the system theme changes.
		const handleThemeChange = () => {
			// Only apply the change if the user's selected theme is 'system'.
			if (theme === 'system') {
				const root = window.document.documentElement;
				root.classList.remove('light', 'dark');
				const newSystemTheme = mediaQuery.matches ? 'dark' : 'light';
				root.classList.add(newSystemTheme);
			}
		};

		// Add the event listener.
		mediaQuery.addEventListener('change', handleThemeChange);

		// Return a cleanup function to remove the listener when the component unmounts
		// or when the `theme` dependency changes.
		return () => {
			mediaQuery.removeEventListener('change', handleThemeChange);
		};
	}, [theme]); // The dependency on `theme` ensures the listener logic is always correct.

	const value = useMemo(
		() => ({
			theme,
			setTheme: newTheme => {
				localStorage.setItem(storageKey, newTheme);
				setTheme(newTheme);
			},
		}),
		[theme, storageKey],
	);

	return (
		<ThemeProviderContext.Provider {...props} value={value}>
			{children}
		</ThemeProviderContext.Provider>
	);
}

export const useTheme = () => {
	const context = useContext(ThemeProviderContext);

	if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider');

	return context;
};
