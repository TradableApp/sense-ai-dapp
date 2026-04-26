import React from 'react';

import { useDispatch } from 'react-redux';
import { Link } from 'react-router-dom';

import ThemeToggle from '@/components/ThemeToggle';
import Separator from '@/components/ui/separator';
import {
	SidebarGroup,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from '@/components/ui/sidebar';
import { openModal } from '@/store/uiSlice';

export default function NavSecondary({ items, ...props }) {
	const dispatch = useDispatch();

	const handleClick = (e, item) => {
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
