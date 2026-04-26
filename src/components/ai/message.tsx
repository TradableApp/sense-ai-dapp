import { AccountAvatar, AccountProvider, Blobbie } from 'thirdweb/react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { client } from '@/config/thirdweb';
import { cn } from '@/lib/utils';

export function Message({ className, from, status, ...props }) {
	return (
		<div
			className={cn(
				'group flex w-full items-end justify-end gap-2',
				from === 'user' ? 'is-user' : 'is-assistant flex-row-reverse justify-end',
				'[&>div]:max-w-[80%]',
				className,
			)}
			{...props}
		>
			{/* The children (MessageContent) will be rendered here */}
			{props.children}
		</div>
	);
}

export function MessageContent({ children, className, ...props }) {
	return (
		<div
			className={cn(
				'overflow-hidden rounded-lg px-4 py-3 text-sm',
				'min-h-[2.5rem] flex items-center',
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

export function MessageAvatar({ src, name, address, className, ...props }) {
	return (
		<Avatar className={cn('size-8 ring ring-1 ring-border mt-1.5', className)} {...props}>
			{/* If an address is provided, use Thirdweb's AccountAvatar (User) */}
			{address ? (
				<AccountProvider address="0x69F96995D115De40c33EA743A13E8A1fb55284dd" client={client}>
					<AccountAvatar
						loadingComponent={<Blobbie address={address} className="h-full w-full" />}
						fallbackComponent={<Blobbie address={address} className="h-full w-full" />}
						style={{
							height: '100%',
							objectFit: 'cover',
							width: '100%',
						}}
					/>
				</AccountProvider>
			) : (
				<>
					<AvatarImage alt="" className="mt-0 mb-0" src={src} />
					<AvatarFallback>{name?.slice(0, 2) || 'ME'}</AvatarFallback>
				</>
			)}
		</Avatar>
	);
}
