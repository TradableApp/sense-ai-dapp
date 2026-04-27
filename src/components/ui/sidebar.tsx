import * as React from 'react';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { PanelLeft } from 'lucide-react';

import { cn } from '@/lib/utils';

const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

type SidebarContextValue = {
	state: 'expanded' | 'collapsed';
	open: boolean;
	setOpen: (_open: boolean) => void;
	openMobile: boolean;
	setOpenMobile: (_open: boolean) => void;
	isMobile: boolean;
	toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextValue | undefined>(undefined);

function useSidebar() {
	const context = React.useContext(SidebarContext);
	if (!context) {
		throw new Error('useSidebar must be used within a SidebarProvider.');
	}

	return context;
}

interface SidebarProviderProps extends React.HTMLAttributes<HTMLDivElement> {
	defaultOpen?: boolean;
	open?: boolean;
	onOpenChange?: (_open: boolean) => void;
}

const SidebarProvider = React.forwardRef<HTMLDivElement, SidebarProviderProps>(
	(
		{
			defaultOpen = true,
			open: openProp,
			onOpenChange: setOpenProp,
			className,
			style,
			children,
			...props
		},
		ref,
	) => {
		const isMobile = false;
		const [openMobile, setOpenMobile] = React.useState(false);

		// Determine the sidebar state
		const [_open, _setOpen] = React.useState(defaultOpen);
		const open = openProp ?? _open;
		const setOpen = React.useCallback(
			(value: boolean | ((_v: boolean) => boolean)) => {
				const openValue = typeof value === 'function' ? value(open) : value;
				if (setOpenProp) {
					setOpenProp(openValue);
				} else {
					_setOpen(openValue);
				}
			},
			[open, setOpenProp],
		);

		const state: 'expanded' | 'collapsed' = open ? 'expanded' : 'collapsed';

		const toggleSidebar = React.useCallback(
			() => (isMobile ? setOpenMobile(!openMobile) : setOpen(_prev => !_prev)),
			[isMobile, openMobile, setOpen, setOpenMobile],
		);

		// Keyboard shortcut
		React.useEffect(() => {
			const handleKeyDown = (event: KeyboardEvent) => {
				if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
					event.preventDefault();
					toggleSidebar();
				}
			};

			window.addEventListener('keydown', handleKeyDown);
			return () => window.removeEventListener('keydown', handleKeyDown);
		}, [toggleSidebar]);

		const contextValue = React.useMemo(
			() => ({ state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }),
			[state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar],
		);

		return (
			<SidebarContext.Provider value={contextValue}>
				<div
					ref={ref}
					className={cn('flex h-full w-full has-data-[variant=inset]:bg-muted', className)}
					style={
						{
							'--sidebar-width': '16rem',
							...style,
						} as React.CSSProperties
					}
					{...props}
				>
					{children}
				</div>
			</SidebarContext.Provider>
		);
	},
);
SidebarProvider.displayName = 'SidebarProvider';

const Sidebar = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement> & {
		side?: 'left' | 'right';
		variant?: 'sidebar' | 'floating' | 'inset';
		collapsible?: 'offcanvas' | 'icon' | 'none';
	}
>(({ side = 'left', variant = 'sidebar', collapsible = 'offcanvas', className, ...props }, ref) => {
	const { state } = useSidebar();

	return (
		<div
			ref={ref}
			className={cn(
				'peer absolute inset-y-0 z-10 hidden h-svh w-[--sidebar-width] transition-all ease-in-out data-[state=collapsed]:w-[calc(var(--sidebar-width)-var(--collapsed-var))] md:peer-[[data-variant=floating]]:left-0 md:peer-[[data-variant=floating]]:z-40 md:peer-[[data-variant=floating]]:ml-0 md:peer-[[data-variant=floating]]:rounded-r-lg md:peer-[[data-variant=floating]]:border md:peer-[[data-variant=floating]]:shadow-lg',
				side === 'right' && 'right-0',
				variant === 'floating' &&
					'absolute left-0 top-0 hidden border border-sidebar-border bg-sidebar p-4 shadow-md md:block',
				variant === 'inset' &&
					'absolute left-0 top-0 z-0 hidden border-r border-sidebar-border bg-sidebar md:block',
				collapsible === 'icon' &&
					'absolute left-0 top-0 hidden w-[calc(var(--sidebar-width)/2)] border-r border-sidebar-border md:flex md:flex-col',
				className,
			)}
			data-state={state}
			data-collapsible={state === 'collapsed' ? collapsible : ''}
			data-variant={variant}
			data-side={side}
			{...props}
		/>
	);
});
Sidebar.displayName = 'Sidebar';

const SidebarTrigger = React.forwardRef<
	HTMLButtonElement,
	React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, onClick, ...props }, ref) => {
	const { toggleSidebar } = useSidebar();

	return (
		<button
			type="button"
			ref={ref}
			className={cn(
				'inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
				className,
			)}
			onClick={event => {
				onClick?.(event);
				toggleSidebar();
			}}
			{...props}
		>
			<PanelLeft className="h-4 w-4" />
		</button>
	);
});
SidebarTrigger.displayName = 'SidebarTrigger';

const SidebarRail = React.forwardRef<
	HTMLButtonElement,
	React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => {
	const { toggleSidebar } = useSidebar();

	return (
		<button
			type="button"
			ref={ref}
			onClick={toggleSidebar}
			title="Toggle Sidebar"
			className={cn(
				'absolute inset-y-0 z-20 hidden w-1 bg-sidebar-border/0 p-0 opacity-0 transition-all ease-linear hover:bg-sidebar-border/100 hover:opacity-100 focus-visible:opacity-100 md:inline-flex md:flex-col',
				className,
			)}
			{...props}
		/>
	);
});
SidebarRail.displayName = 'SidebarRail';

const SidebarInset = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<main
			ref={ref}
			className={cn('flex h-full flex-1 flex-col overflow-hidden', className)}
			{...props}
		/>
	),
);
SidebarInset.displayName = 'SidebarInset';

const SidebarHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div ref={ref} className={cn('flex flex-col gap-2 p-4', className)} {...props} />
	),
);
SidebarHeader.displayName = 'SidebarHeader';

const SidebarContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div ref={ref} className={cn('flex-1 overflow-auto', className)} {...props} />
	),
);
SidebarContent.displayName = 'SidebarContent';

const SidebarFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div
			ref={ref}
			className={cn('flex flex-col gap-2 border-t border-sidebar-border p-4', className)}
			{...props}
		/>
	),
);
SidebarFooter.displayName = 'SidebarFooter';

const sidebarMenuButtonVariants = cva(
	'peer/menu-button inline-flex items-center justify-start gap-2 px-2 py-1.5 text-sm outline-none ring-offset-sidebar-border transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active]:bg-sidebar-accent data-[active]:font-semibold data-[active]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
	{
		variants: {
			variant: {
				default: 'hover:bg-transparent focus-visible:bg-transparent',
				outline:
					'border border-sidebar-border bg-transparent hover:border-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:border-sidebar-ring focus-visible:ring-2 focus-visible:ring-sidebar-ring',
			},
			size: {
				default: 'h-8 rounded-md px-2',
				sm: 'h-7 rounded-md px-2 text-xs',
				lg: 'h-12 rounded-md px-2 text-sm',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
);

interface SidebarMenuButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof sidebarMenuButtonVariants> {
	asChild?: boolean;
	isActive?: boolean;
}

const SidebarMenuButton = React.forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
	({ asChild = false, isActive, variant, size, className, ...props }, ref) => {
		const Comp = asChild ? Slot : 'button';

		return (
			<Comp
				ref={ref}
				data-active={isActive}
				className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
				{...props}
			/>
		);
	},
);
SidebarMenuButton.displayName = 'SidebarMenuButton';

const SidebarMenu = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
	({ className, ...props }, ref) => (
		<ul ref={ref} className={cn('flex w-full min-w-0 flex-col gap-1', className)} {...props} />
	),
);
SidebarMenu.displayName = 'SidebarMenu';

const SidebarMenuItem = React.forwardRef<HTMLLIElement, React.HTMLAttributes<HTMLLIElement>>(
	({ className, ...props }, ref) => (
		<li ref={ref} className={cn('group/menu-item relative', className)} {...props} />
	),
);
SidebarMenuItem.displayName = 'SidebarMenuItem';

const SidebarMenuSub = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
	({ className, ...props }, ref) => (
		<ul
			ref={ref}
			className={cn(
				'border-l border-sidebar-border px-2 py-0.5 group-data-[collapsible=icon]:hidden',
				className,
			)}
			{...props}
		/>
	),
);
SidebarMenuSub.displayName = 'SidebarMenuSub';

const SidebarMenuSubItem = React.forwardRef<HTMLLIElement, React.HTMLAttributes<HTMLLIElement>>(
	({ ...props }, ref) => <li ref={ref} {...props} />,
);
SidebarMenuSubItem.displayName = 'SidebarMenuSubItem';

const SidebarMenuSubButton = React.forwardRef<
	HTMLAnchorElement,
	React.AnchorHTMLAttributes<HTMLAnchorElement> & {
		asChild?: boolean;
		size?: 'sm' | 'md';
		isActive?: boolean;
	}
>(({ asChild = false, size = 'md', isActive, className, ...props }, ref) => {
	const Comp = asChild ? Slot : 'a';

	return (
		<Comp
			ref={ref}
			data-size={size}
			data-active={isActive}
			className={cn(
				'block rounded-md px-2 py-1.5 text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active]:bg-sidebar-accent data-[active]:font-medium data-[active]:text-sidebar-accent-foreground data-[size=sm]:py-1 data-[size=sm]:text-xs [&>span:last-child]:truncate',
				className,
			)}
			{...props}
		/>
	);
});
SidebarMenuSubButton.displayName = 'SidebarMenuSubButton';

const SidebarMenuAction = React.forwardRef<
	HTMLButtonElement,
	React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
>(({ className, asChild = false, ...props }, ref) => {
	const Comp = asChild ? Slot : 'button';

	return (
		<Comp
			ref={ref}
			className={cn(
				'absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-md p-1 text-sidebar-foreground/50 outline-none ring-offset-sidebar-border transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring peer-hover/menu-button:block peer-data-[size=lg]/menu-button:top-1/3 [&>svg]:size-4 [&>svg]:shrink-0',
				className,
			)}
			{...props}
		/>
	);
});
SidebarMenuAction.displayName = 'SidebarMenuAction';

const SidebarMenuBadge = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div
			ref={ref}
			className={cn(
				'pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md border border-sidebar-border bg-sidebar px-1 text-xs font-medium text-sidebar-foreground peer-hover/menu-button:block peer-data-[size=lg]/menu-button:right-2 [&>svg]:size-3 [&>svg]:shrink-0',
				className,
			)}
			{...props}
		/>
	),
);
SidebarMenuBadge.displayName = 'SidebarMenuBadge';

const SidebarGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div ref={ref} className={cn('overflow-hidden px-2 py-1.5', className)} {...props} />
	),
);
SidebarGroup.displayName = 'SidebarGroup';

const SidebarGroupLabel = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
	({ className, ...props }, ref) => (
		<span
			ref={ref}
			className={cn(
				'display: block px-2 py-1.5 text-xs font-medium text-sidebar-foreground/70',
				className,
			)}
			{...props}
		/>
	),
);
SidebarGroupLabel.displayName = 'SidebarGroupLabel';

export {
	Sidebar,
	SidebarProvider,
	useSidebar,
	SidebarTrigger,
	SidebarRail,
	SidebarInset,
	SidebarHeader,
	SidebarContent,
	SidebarFooter,
	SidebarMenu,
	SidebarMenuItem,
	SidebarMenuButton,
	SidebarMenuSub,
	SidebarMenuSubItem,
	SidebarMenuSubButton,
	SidebarMenuAction,
	SidebarMenuBadge,
	SidebarGroup,
	SidebarGroupLabel,
	sidebarMenuButtonVariants,
};
