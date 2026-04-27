import React from 'react';

import { Link } from 'react-router-dom';

import ThemeToggle from '@/components/ThemeToggle';
import { Separator } from '@/components/ui/separator';
import {
	SidebarGroup,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useAppDispatch } from '@/store/hooks';
import { openModal } from '@/store/uiSlice';

interface NavItem {
	title: string;
	url: string;
	icon: React.ComponentType<{ className?: string }>;
}

interface NavSecondaryProps extends React.HTMLAttributes<HTMLDivElement> {
	items: NavItem[];
}

export default function NavSecondary({ items, ...props }: NavSecondaryProps) {
	const dispatch = useAppDispatch();

	const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, item: NavItem): void => {
		if (item.title === 'Feedback') {
			e.preventDefault();
			dispatch(openModal({ type: 'Feedback' }));
		} else if (item.title === 'Support') {
			e.preventDefault();
			dispatch(openModal({ type: 'Support' }));
		}
	};

	return (
		<SidebarGroup {...props}>
			<SidebarMenu>
				<SidebarMenuItem className="flex items-center justify-between">
					<span className="text-xs text-muted-foreground">Theme</span>
					<ThemeToggle />
				</SidebarMenuItem>
				<Separator className="my-1" />
				{items.map(item => (
					<SidebarMenuItem key={item.title}>
						<SidebarMenuButton asChild size="sm">
							<Link to={item.url} onClick={e => handleClick(e, item)}>
								<item.icon />
								<span>{item.title}</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
