import { Outlet } from 'react-router-dom';

import BottomNav from '@/layouts/components/BottomNav';
import Header from '@/layouts/components/Header';

export default function MainLayout() {
	return (
		<div className="flex flex-col min-h-screen">
			<Header />
			<main className="flex-grow container mx-auto p-4 pb-24">
				<Outlet />
			</main>
			<BottomNav />
		</div>
	);
}
