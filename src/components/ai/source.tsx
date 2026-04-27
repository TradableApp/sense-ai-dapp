'use client';

import { ReactNode } from 'react';

import { BookIcon, ChevronDownIcon } from 'lucide-react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface SourcesProps {
	className?: string;
	children?: ReactNode;
	[key: string]: any;
}

interface SourcesTriggerProps {
	className?: string;
	count?: number;
	children?: ReactNode;
	[key: string]: any;
}

interface SourcesContentProps {
	className?: string;
	children?: ReactNode;
	[key: string]: any;
}

interface SourceProps {
	href?: string;
	title?: string;
	children?: ReactNode;
	[key: string]: any;
}

export function Sources({ className, ...props }: SourcesProps) {
	return (
		<Collapsible
			className={cn('not-prose text-primary text-xs pt-4 border-t', className)}
			{...props}
		/>
	);
}

export function SourcesTrigger({ className, count, children, ...props }: SourcesTriggerProps) {
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

export function SourcesContent({ className, ...props }: SourcesContentProps) {
	return (
		<CollapsibleContent
			className={cn(
				'flex flex-col gap-2 data-[state=open]:mt-3',
				'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
				className,
			)}
			{...props}
		/>
	);
}

export function Source({ href, title, children, ...props }: SourceProps) {
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
