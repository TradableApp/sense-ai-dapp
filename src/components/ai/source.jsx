'use client';

import { BookIcon, ChevronDownIcon } from 'lucide-react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export function Sources({ className, ...props }) {
	return (
		<Collapsible
			className={cn('not-prose text-primary text-xs pt-4 border-t', className)}
			{...props}
		/>
	);
}

export function SourcesTrigger({ className, count, children, ...props }) {
	return (
		<CollapsibleTrigger
			className={cn('flex items-center gap-2 font-medium text-muted-foreground', className)}
			{...props}
		>
			{children ?? (
				<>
					<p>Used {count} sources</p>
					<ChevronDownIcon className="h-4 w-4 transition-transform data-[state=open]:rotate-180" />
				</>
			)}
		</CollapsibleTrigger>
	);
}

export function SourcesContent({ className, ...props }) {
	return (
		<CollapsibleContent
			className={cn(
				// --- FIX: Only apply margin-top when the component is open ---
				'flex flex-col gap-2 data-[state=open]:mt-3',
				'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
				className,
			)}
			{...props}
		/>
	);
}

export function Source({ href, title, children, ...props }) {
	return (
		<a
			className="flex items-center gap-2 text-primary"
			href={href}
			rel="noreferrer"
			target="_blank"
			{...props}
		>
			{children ?? (
				<>
					<BookIcon className="h-4 w-4" />
					<span className="block font-medium">{title}</span>
				</>
			)}
		</a>
	);
}
