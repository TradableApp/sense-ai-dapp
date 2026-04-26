import * as React from 'react';
import { ChevronRight, MoreHorizontal } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface BreadcrumbProps extends React.ComponentPropsWithoutRef<'nav'> {
	separator?: React.ReactNode;
}

const Breadcrumb = React.forwardRef<HTMLElement, BreadcrumbProps>(({ ...props }, ref) => (
	<nav ref={ref} aria-label="breadcrumb" {...props} />
));
Breadcrumb.displayName = 'Breadcrumb';

export interface BreadcrumbListProps extends React.ComponentPropsWithoutRef<'ol'> {}

const BreadcrumbList = React.forwardRef<HTMLOListElement, BreadcrumbListProps>(({ className, ...props }, ref) => (
	<ol
		ref={ref}
		className={cn('flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5', className)}
		{...props}
	/>
));
BreadcrumbList.displayName = 'BreadcrumbList';

export interface BreadcrumbItemProps extends React.ComponentPropsWithoutRef<'li'> {}

const BreadcrumbItem = React.forwardRef<HTMLLIElement, BreadcrumbItemProps>(({ className, ...props }, ref) => (
	<li ref={ref} className={cn('inline-flex items-center gap-1.5', className)} {...props} />
));
BreadcrumbItem.displayName = 'BreadcrumbItem';

export interface BreadcrumbLinkProps extends React.ComponentPropsWithoutRef<'a'> {
	asChild?: boolean;
}

const BreadcrumbLink = React.forwardRef<HTMLAnchorElement, BreadcrumbLinkProps>(({ className, ...props }, ref) => (
	<a ref={ref} className={cn('transition-colors hover:text-foreground', className)} {...props} />
));
BreadcrumbLink.displayName = 'BreadcrumbLink';

export interface BreadcrumbPageProps extends React.ComponentPropsWithoutRef<'span'> {}

const BreadcrumbPage = React.forwardRef<HTMLSpanElement, BreadcrumbPageProps>(({ className, ...props }, ref) => (
	<span ref={ref} className={cn('inline-flex items-center gap-1.5 text-foreground', className)} {...props} />
));
BreadcrumbPage.displayName = 'BreadcrumbPage';

export interface BreadcrumbSeparatorProps extends React.ComponentPropsWithoutRef<'li'> {
	children?: React.ReactNode;
}

const BreadcrumbSeparator = ({ children, className, ...props }: BreadcrumbSeparatorProps) => (
	<li
		role="presentation"
		aria-hidden="true"
		className={cn('[&>svg]:h-3.5 [&>svg]:w-3.5', className)}
		{...props}
	>
		{children ?? <ChevronRight />}
	</li>
);
BreadcrumbSeparator.displayName = 'BreadcrumbSeparator';

export interface BreadcrumbEllipsisProps extends React.ComponentPropsWithoutRef<'span'> {}

const BreadcrumbEllipsis = ({ className, ...props }: BreadcrumbEllipsisProps) => (
	<span
		role="presentation"
		aria-hidden="true"
		className={cn('flex h-9 w-9 items-center justify-center', className)}
		{...props}
	>
		<MoreHorizontal className="h-4 w-4" />
		<span className="sr-only">More</span>
	</span>
);
BreadcrumbEllipsis.displayName = 'BreadcrumbEllipsis';

export {
	Breadcrumb,
	BreadcrumbList,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbPage,
	BreadcrumbSeparator,
	BreadcrumbEllipsis,
};
