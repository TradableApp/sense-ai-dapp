import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useDispatch } from 'react-redux';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from '@/components/ui/sidebar';
import { fetchConversations } from '@/lib/mockApi';
import { cn } from '@/lib/utils';
import { setActiveConversationId } from '@/store/chatSlice';

export default function NavMain({ items }) {
	const location = useLocation();
	const navigate = useNavigate();
	const dispatch = useDispatch();
	const [isHistoryOpen, setIsHistoryOpen] = useState(false);

	const { data: recentConversations } = useQuery({
		queryKey: ['conversations'],
		queryFn: fetchConversations,
		select: allConversations => allConversations.slice(0, 5),
	});

	const handleSelectConversation = conversationId => {
		dispatch(setActiveConversationId(conversationId));
		navigate('/chat');
	};

	return (
		<SidebarGroup>
			<SidebarGroupLabel>Platform</SidebarGroupLabel>
			<SidebarMenu>
				{items.map(item =>
					item.hasChildren && recentConversations && recentConversations.length > 0 ? (
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
												'ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full group-hover:bg-sidebar-accent group-hover:text-sidebar-accent-foreground',
												(location.pathname.startsWith(item.url) || isHistoryOpen) &&
													'bg-sidebar-accent text-sidebar-accent-foreground',
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
										{recentConversations.map(child => (
											<li key={child.id}>
												<button
													type="button"
													onClick={() => handleSelectConversation(child.id)}
													className="w-full text-left block truncate rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
												>
													{child.title}
												</button>
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
