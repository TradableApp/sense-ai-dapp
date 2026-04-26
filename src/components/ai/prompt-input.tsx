'use client';

import { Children, forwardRef, ReactNode } from 'react';

import { Loader2Icon, SendHorizontalIcon, SendIcon, SquareIcon, XIcon } from 'lucide-react';

import { Button, type ButtonProps } from '@/components/ui/button';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface PromptInputProps {
	errors?: any;
	className?: string;
	children?: ReactNode;
	onSubmit?: (e?: any) => void;
}

interface PromptInputTextareaProps {
	onChange?: (e: any) => void;
	className?: string;
	placeholder?: string;
	[key: string]: any;
}

interface PromptInputToolbarProps {
	className?: string;
	children?: ReactNode;
}

interface PromptInputToolsProps {
	className?: string;
	children?: ReactNode;
}

interface PromptInputButtonProps extends ButtonProps {
	children?: ReactNode;
}

// The 'errors' prop is now accepted to control the styling
export function PromptInput({ errors, className, ...props }: PromptInputProps) {
	// Only show the error state for messages other than the "empty" validation.
	const hasVisibleError = !!errors?.prompt && errors.prompt.message !== 'Message cannot be empty.';

	return (
		<form
			className={cn(
				'w-full divide-y overflow-hidden rounded-xl border bg-card shadow-sm',
				// If there's a visible prompt error, apply the destructive border color
				hasVisibleError && 'border-destructive',
				className,
			)}
			{...props}
		/>
	);
}

export const PromptInputTextarea = forwardRef<HTMLTextAreaElement, PromptInputTextareaProps>(
	({ onChange, className, placeholder = 'What would you like to know?', ...props }, ref) => {
		const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === 'Enter') {
				if (e.shiftKey) {
					return;
				}
				e.preventDefault();
				const { form } = e.currentTarget;
				if (form) {
					form.requestSubmit();
				}
			}
		};
		return (
			<Textarea
				ref={ref}
				className={cn(
					'w-full resize-none rounded-none border-none p-3 shadow-none outline-none ring-0',
					'field-sizing-content max-h-[6lh] bg-transparent dark:bg-transparent',
					'focus-visible:ring-0',
					className,
				)}
				name="message"
				onChange={e => {
					onChange?.(e);
				}}
				onKeyDown={handleKeyDown}
				placeholder={placeholder}
				{...props}
			/>
		);
	},
);
PromptInputTextarea.displayName = 'PromptInputTextarea';

export function PromptInputToolbar({ className, ...props }: PromptInputToolbarProps) {
	return <div className={cn('flex items-center justify-between p-1', className)} {...props} />;
}

export function PromptInputTools({ className, ...props }: PromptInputToolsProps) {
	return (
		<div
			className={cn('flex items-center gap-1', '[&_button:first-child]:rounded-bl-xl', className)}
			{...props}
		/>
	);
}

export function PromptInputButton({ variant = 'ghost', className, size, ...props }: PromptInputButtonProps) {
	const newSize = size ?? Children.count(props.children) > 1 ? 'default' : 'icon';
	return (
		<Button
			className={cn(
				'shrink-0 gap-1.5 rounded-lg',
				variant === 'ghost' && 'text-muted-foreground',
				newSize === 'default' && 'px-3',
				className,
			)}
			size={newSize}
			type="button"
			variant={variant}
			{...props}
		/>
	);
}

interface PromptInputSubmitProps extends ButtonProps {
	status?: string;
	children?: ReactNode;
}

interface PromptInputCancelProps extends ButtonProps {
	isLoading?: boolean;
	children?: ReactNode;
}

export function PromptInputSubmit({
	className,
	variant = 'default',
	size = 'icon',
	status,
	children,
	...props
}: PromptInputSubmitProps) {
	let Icon = <SendIcon className="size-4" />;
	if (status === 'submitted') {
		Icon = <Loader2Icon className="size-4 animate-spin" />;
	} else if (status === 'streaming') {
		Icon = <SquareIcon className="size-4" />;
	} else if (status === 'editting') {
		Icon = <SendHorizontalIcon className="size-4" />;
	} else if (status === 'error') {
		Icon = <XIcon className="size-4" />;
	}
	return (
		<Button
			className={cn('gap-1.5 rounded-lg', className)}
			size={size}
			type="submit"
			variant={variant}
			{...props}
		>
			{children ?? Icon}
		</Button>
	);
}

export function PromptInputCancel({
	className,
	variant = 'default',
	size = 'icon',
	isLoading, // Added to support showing spinner during cancel mutation
	children,
	...props
}: PromptInputCancelProps) {
	return (
		<Button
			className={cn('gap-1.5 rounded-lg', className)}
			size={size}
			type="button" // Explicitly prevents form submission
			variant={variant}
			{...props}
		>
			{children ??
				(isLoading ? (
					<Loader2Icon className="size-4 animate-spin" />
				) : (
					<SquareIcon className="size-4" />
				))}
		</Button>
	);
}

interface SelectComponentProps {
	className?: string;
	children?: ReactNode;
	value?: string;
	[key: string]: any;
}

interface SelectItemProps extends SelectComponentProps {
	value: string;
}

export function PromptInputModelSelect(props: SelectComponentProps) {
	return <Select {...props} />;
}
export function PromptInputModelSelectTrigger({ className, ...props }: SelectComponentProps) {
	return (
		<SelectTrigger
			className={cn(
				'border-none bg-transparent font-medium text-muted-foreground shadow-none transition-colors',
				'hover:bg-accent hover:text-foreground [&[aria-expanded="true"]]:bg-accent [&[aria-expanded="true"]]:text-foreground',
				className,
			)}
			{...props}
		/>
	);
}
export function PromptInputModelSelectContent({ className, ...props }: SelectComponentProps) {
	return <SelectContent className={cn(className)} {...props} />;
}
export function PromptInputModelSelectItem({ className, value, ...props }: SelectItemProps) {
	return <SelectItem className={cn(className)} value={value} {...props} />;
}
export function PromptInputModelSelectValue({ className, ...props }: SelectComponentProps) {
	return <SelectValue className={cn(className)} {...props} />;
}
