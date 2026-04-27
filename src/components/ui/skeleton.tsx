import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {}

function Skeleton({ className, ...props }: SkeletonProps) {
	return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export { Skeleton };
