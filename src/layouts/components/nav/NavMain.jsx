import { useState } from 'react';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from '@/components/ui/sidebar';
import cn from '@/lib/utils';

export default function NavMain({ items }) {
	const location = useLocation();
	const [isHistoryOpen, setIsHistoryOpen] = useState(false);

	return (
		<SidebarGroup>
			<SidebarGroupLabel>Platform</SidebarGroupLabel>
			<SidebarMenu>
				{items.map(item =>
					item.children ? (
						<Collapsible
							asChild
							key={item.title}
							open={isHistoryOpen}
							onOpenChange={setIsHistoryOpen}
						>
							<>
								<SidebarMenuItem className="!p-0">
									<div className="group flex w-full items-center pr-2">
										<SidebarMenuButton
											asChild
											tooltip={item.title}
											isActive={location.pathname.startsWith(item.url)}
											className="flex-1"
										>
											<Link to={item.url}>
												<item.icon />
												<span>{item.title}</span>
											</Link>
										</SidebarMenuButton>
										<CollapsibleTrigger
											className={cn(
												'ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
											)}
										>
											{isHistoryOpen ? (
												<ChevronUp className="h-4 w-4" />
											) : (
												<ChevronDown className="h-4 w-4" />
											)}
											<span className="sr-only">Toggle history</span>
										</CollapsibleTrigger>
									</div>
								</SidebarMenuItem>
								<CollapsibleContent asChild>
									<ul className="space-y-1 px-4 pb-2">
										{item.children.map(child => (
											<li key={child.id}>
												<Link
													to={child.url}
													className="block truncate rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
												>
													{child.title}
												</Link>
											</li>
										))}
									</ul>
								</CollapsibleContent>
							</>
						</Collapsible>
					) : (
						<SidebarMenuItem key={item.title}>
							<SidebarMenuButton
								asChild
								tooltip={item.title}
								isActive={location.pathname === item.url}
							>
								<Link to={item.url}>
									<item.icon />
									<span>{item.title}</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
					),
				)}
			</SidebarMenu>
		</SidebarGroup>
	);
}
