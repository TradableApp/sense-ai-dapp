import { clsx } from 'clsx';
import rehypeStringify from 'rehype-stringify';
import { remark } from 'remark';
import remarkRehype from 'remark-rehype';
import strip from 'strip-markdown';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
	return twMerge(clsx(inputs));
}

export const wait = ms =>
	new Promise(resolve => {
		setTimeout(resolve, ms);
	});

export const isObject = variable => Object.prototype.toString.call(variable) === '[object Object]';

export function markdownToPlainText(markdown) {
	if (!markdown) return '';
	let result = '';
	remark()
		.use(strip)
		.process(markdown, (err, file) => {
			if (err) {
				console.error('Error processing markdown:', err);
				return;
			}
			result = String(file);
		});
	return result.trim();
}

// Function to copy markdown as both rich text and plain text ---
export async function copyMarkdownToClipboard(markdown) {
	try {
		// Generate Plain Text Version
		const plainText = String(await remark().use(strip).process(markdown)).trim();

		// Generate HTML Version
		const htmlText = String(
			await remark().use(remarkRehype).use(rehypeStringify).process(markdown),
		);

		// Create a ClipboardItem with both formats
		const blobHtml = new Blob([htmlText], { type: 'text/html' });
		const blobText = new Blob([plainText], { type: 'text/plain' });
		const clipboardItem = new ClipboardItem({
			'text/html': blobHtml,
			'text/plain': blobText,
		});

		// Write to the clipboard
		await navigator.clipboard.write([clipboardItem]);
		return true; // Indicate success
	} catch (err) {
		console.error('Failed to copy content: ', err);
		// Fallback for older browsers or environments that don't support blobs
		try {
			const plainText = String(await remark().use(strip).process(markdown)).trim();
			await navigator.clipboard.writeText(plainText);
			return true;
		} catch (fallbackErr) {
			console.error('Fallback copy failed: ', fallbackErr);
			return false; // Indicate failure
		}
	}
}
