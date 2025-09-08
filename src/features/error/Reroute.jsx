import { useEffect } from 'react';

import { useNavigate } from 'react-router-dom';

function Reroute() {
	const navigate = useNavigate();

	useEffect(() => {
		// Your main project uses '/error' for the 404, so we'll do the same.
		navigate('/error');
	}, [navigate]);

	return null; // Renders nothing, just navigates.
}

export default Reroute;
