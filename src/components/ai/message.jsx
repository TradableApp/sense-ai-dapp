import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export function Message({ className, from, ...props }) {
	return (
		<div
			className={cn(
				'group flex w-full items-end justify-end gap-2',
				from === 'user' ? 'is-user' : 'is-assistant flex-row-reverse justify-end',
				'[&>div]:max-w-[80%]',
				className,
			)}
			{...props}
		/>
	);
}

export function MessageContent({ children, className, ...props }) {
	return (
		<div
			className={cn(
				'overflow-hidden rounded-lg px-4 py-3 text-sm',
				'group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground',
				'group-[.is-assistant]:bg-secondary group-[.is-assistant]:text-secondary-foreground',
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}

export function MessageAvatar({ src, name, className, ...props }) {
	return (
		<Avatar className={cn('size-8 ring ring-1 ring-border mt-1.5', className)} {...props}>
			<AvatarImage alt="" className="mt-0 mb-0" src={src} />
			<AvatarFallback>{name?.slice(0, 2) || 'ME'}</AvatarFallback>
		</Avatar>
	);
}
