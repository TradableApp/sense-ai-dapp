import { useMemo, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	FilePenLine,
	Loader2Icon,
	MessageSquare,
	MoreHorizontal,
	PlusCircle,
	Search,
	Trash2,
} from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import EmptyState from '@/components/ui/empty-state';
import Input from '@/components/ui/input';
import Skeleton from '@/components/ui/skeleton';
import { deleteConversation, fetchConversations } from '@/lib/mockApi';
import { markdownToPlainText } from '@/lib/utils';
import {
	clearActiveConversation,
	openRenameModal,
	setActiveConversationId,
} from '@/store/chatSlice';

import RenameConversationModal from './RenameConversationModal';

export default function History() {
	const navigate = useNavigate();
	const dispatch = useDispatch();
	const queryClient = useQueryClient();

	const [isAlertOpen, setIsAlertOpen] = useState(false);
	const [conversationToDelete, setConversationToDelete] = useState(null);

	const activeConversationId = useSelector(state => state.chat.activeConversationId);
	const skeletonKeys = useMemo(() => Array.from({ length: 3 }, () => `skel-${Math.random()}`), []);

	const {
		data: conversations,
		isLoading,
		isError,
	} = useQuery({
		queryKey: ['conversations'],
		queryFn: fetchConversations,
		refetchInterval: 5000,
	});

	const deleteMutation = useMutation({
		mutationFn: deleteConversation,
		onSuccess: deletedConversationId => {
			queryClient.invalidateQueries({ queryKey: ['conversations'] });
			if (activeConversationId === deletedConversationId) {
				dispatch(clearActiveConversation());
			}
			setIsAlertOpen(false);
			setConversationToDelete(null);
		},
	});

	const handleSelectConversation = conversationId => {
		dispatch(setActiveConversationId(conversationId));
		navigate('/chat');
	};

	const handleDelete = (e, conversationId) => {
		e.stopPropagation();
		setConversationToDelete(conversationId);
		setIsAlertOpen(true);
	};

	const confirmDelete = () => {
		if (conversationToDelete) {
			deleteMutation.mutate(conversationToDelete);
		}
	};

	const handleRename = (e, conversation) => {
		e.stopPropagation();
		dispatch(openRenameModal({ id: conversation.id, title: conversation.title }));
	};

	const hasConversations = !isLoading && conversations && conversations.length > 0;
	const showEmptyState = !isLoading && (!conversations || conversations.length === 0);

	return (
		<>
			<RenameConversationModal />
			<div className="flex flex-col gap-4">
				<div>
					<h2 className="text-2xl font-bold">Conversations</h2>
					<p className="text-muted-foreground">
						Select a conversation to continue where you left off.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<div className="relative flex-1">
						<Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
						<Input
							type="search"
							placeholder="Search history..."
							className="w-full rounded-lg bg-background pl-8"
						/>
					</div>
					<Button
						asChild
						className="items-center gap-1"
						onClick={() => dispatch(setActiveConversationId(null))}
					>
						<Link to="/chat">
							<PlusCircle className="size-3.5" />
						</Link>
					</Button>
				</div>
				<div className="overflow-hidden rounded-xl border">
					{hasConversations && (
						<div className="hidden items-center border-b bg-muted/50 px-4 py-2 text-sm font-medium text-muted-foreground md:flex">
							<div className="flex-1">Name</div>
							<div className="flex-1">Preview</div>
							<div className="w-32 flex-shrink-0 text-right">Updated</div>
							<div className="w-10 flex-shrink-0" />
						</div>
					)}
					<div>
						{isLoading &&
							skeletonKeys.map(key => (
								<div key={key} className="flex items-center gap-3 border-b p-4">
									<Skeleton className="size-5" />
									<div className="flex-1 min-w-0">
										<Skeleton className="h-4 w-3/4" />
									</div>
								</div>
							))}
						{isError && <div className="p-4 text-destructive">Error loading conversations.</div>}
						{showEmptyState && <EmptyState />}
						{hasConversations &&
							conversations.map(item => {
								const displayDate = item.lastMessageCreatedAt || item.createdAt;
								return (
									<button
										type="button"
										key={item.id}
										className="w-full text-left flex items-center gap-3 border-b p-4 text-sm last:border-b-0 cursor-pointer hover:bg-muted/50"
										onClick={() => handleSelectConversation(item.id)}
									>
										<MessageSquare className="size-5 flex-shrink-0 text-muted-foreground" />
										<div className="flex-1 min-w-0">
											<p className="font-medium truncate">{item.title}</p>
											<p className="mt-1 hidden truncate text-muted-foreground md:block">
												{markdownToPlainText(item.lastMessagePreview)}
											</p>
											<div className="md:hidden">
												<p className="mt-1 truncate text-xs text-muted-foreground">
													{markdownToPlainText(item.lastMessagePreview)}
												</p>
												<p className="mt-1 text-xs text-muted-foreground">
													{new Date(displayDate).toLocaleTimeString()}
												</p>
											</div>
										</div>
										<div className="hidden w-32 flex-shrink-0 text-right text-muted-foreground md:block">
											{new Date(displayDate).toLocaleDateString()}
										</div>
										<div className="flex-shrink-0">
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button
														aria-haspopup="true"
														size="icon"
														variant="ghost"
														onClick={e => e.stopPropagation()}
													>
														<MoreHorizontal className="size-4" />
														<span className="sr-only">Toggle menu</span>
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
													<DropdownMenuItem onClick={e => handleRename(e, item)}>
														<FilePenLine className="mr-2 size-4" />
														Rename
													</DropdownMenuItem>
													<DropdownMenuItem
														className="text-destructive"
														onClick={e => handleDelete(e, item.id)}
													>
														<Trash2 className="mr-2 size-4" />
														Delete
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</div>
									</button>
								);
							})}
					</div>
				</div>
			</div>
			<AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
						<AlertDialogDescription>
							This action cannot be undone. This will permanently delete this conversation and
							remove its data from decentralised storage.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							onClick={() => setConversationToDelete(null)}
							disabled={deleteMutation.isPending}
						>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive hover:bg-destructive/90"
							onClick={confirmDelete}
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending && <Loader2Icon className="mr-2 size-4 animate-spin" />}
							Continue
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
