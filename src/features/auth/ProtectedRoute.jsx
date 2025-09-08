import { Navigate } from 'react-router-dom';
import { useActiveAccount } from 'thirdweb/react';

import MainLayout from '@/layouts/MainLayout';

export default function ProtectedRoute() {
	const account = useActiveAccount();

	// If the user is not authenticated, redirect them to the /auth page.
	if (!account) {
		return <Navigate to="/auth" replace />;
	}

	// If the user is authenticated, render the MainLayout, which contains
	// the header, bottom nav, and an <Outlet /> for the nested child routes.
	return <MainLayout />;
}
