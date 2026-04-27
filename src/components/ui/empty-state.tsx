import React from 'react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		className={cn(
			'flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center',
			className,
		)}
		{...props}
	/>
));
EmptyState.displayName = 'EmptyState';

export { EmptyState };
