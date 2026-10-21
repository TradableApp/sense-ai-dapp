import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Sidebar, SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';

// The sidebar is absolutely positioned (no spacer element), so the inset MUST offset
// itself by the sidebar's width or page content lays out underneath the sidebar at
// narrow desktop widths (seen with the MetaMask side panel open, viewport ~1515px).
// happy-dom does not apply Tailwind, so these tests pin the class contract between
// the two siblings: every width the sidebar can take has a matching inset margin.

// Plain literals on purpose: Tailwind scans *.tsx (tests included) for class names, and a
// template literal here would leak a half-interpolated rule into the production CSS.
const EXPANDED_WIDTH = 'w-[--sidebar-width]';
const EXPANDED_OFFSET = 'md:peer-data-[state=expanded]:ml-[--sidebar-width]';
const ICON_OFFSET = 'md:peer-data-[collapsible=icon]:ml-[calc(var(--sidebar-width)/2)]';
const OFFCANVAS_WIDTH = 'data-[collapsible=offcanvas]:w-0';
const ICON_WIDTH = 'data-[collapsible=icon]:w-[calc(var(--sidebar-width)/2)]';

function Shell({ collapsible }: { collapsible?: 'offcanvas' | 'icon' }) {
	return (
		<SidebarProvider>
			<Sidebar variant="inset" collapsible={collapsible} data-testid="sidebar" />
			<SidebarInset data-testid="inset">
				<SidebarTrigger data-testid="trigger" />
			</SidebarInset>
		</SidebarProvider>
	);
}

describe('Sidebar / SidebarInset layout contract', () => {
	// vitest runs without `globals`, so Testing Library cannot register its own afterEach.
	afterEach(cleanup);

	it('offsets the inset by the sidebar width while expanded', () => {
		render(<Shell />);

		const sidebar = screen.getByTestId('sidebar');
		const inset = screen.getByTestId('inset');

		expect(sidebar.dataset.state).toBe('expanded');
		expect(sidebar.className).toContain(EXPANDED_WIDTH);
		expect(inset.className).toContain(EXPANDED_OFFSET);
	});

	it('collapses an offcanvas sidebar to zero width and drops the inset offset', () => {
		render(<Shell />);

		act(() => {
			fireEvent.click(screen.getByTestId('trigger'));
		});

		const sidebar = screen.getByTestId('sidebar');
		const inset = screen.getByTestId('inset');

		expect(sidebar.dataset.state).toBe('collapsed');
		expect(sidebar.dataset.collapsible).toBe('offcanvas');
		expect(sidebar.className).toContain(OFFCANVAS_WIDTH);
		// The expanded offset is keyed on data-state=expanded, so it no longer matches;
		// no other margin rule may target the offcanvas collapsed state.
		expect(inset.className).not.toMatch(/peer-data-\[collapsible=offcanvas\]:ml-/);
	});

	it('halves both the sidebar width and the inset offset in icon mode', () => {
		render(<Shell collapsible="icon" />);

		act(() => {
			fireEvent.click(screen.getByTestId('trigger'));
		});

		const sidebar = screen.getByTestId('sidebar');
		const inset = screen.getByTestId('inset');

		expect(sidebar.dataset.collapsible).toBe('icon');
		expect(sidebar.className).toContain(ICON_WIDTH);
		expect(inset.className).toContain(ICON_OFFSET);
	});

	it('never references an undefined CSS variable for the collapsed width', () => {
		render(<Shell />);

		// `--collapsed-var` was never defined anywhere, which made the collapsed width
		// invalid at computed-value time and let the sidebar shrink-wrap its content.
		expect(screen.getByTestId('sidebar').className).not.toContain('--collapsed-var');
	});
});
