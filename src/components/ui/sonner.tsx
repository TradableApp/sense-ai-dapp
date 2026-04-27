import type { ComponentProps } from 'react';

import { Toaster as SonnerToaster, toast } from 'sonner';

import { useTheme } from '@/components/ThemeProvider';

export { toast };

export function Toaster(props: ComponentProps<typeof SonnerToaster>) {
	const { theme } = useTheme();
	return <SonnerToaster theme={theme as 'light' | 'dark' | 'system'} {...props} />;
}
