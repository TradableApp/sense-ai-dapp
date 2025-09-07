import { createThirdwebClient } from "thirdweb";

// You can get a client id from https://thirdweb.com/dashboard/settings/api-keys
const clientId = import.meta.env.VITE_THIRDWEB_CLIENT_ID;

if (!clientId) {
  throw new Error("No client ID provided");
}

export const client = createThirdwebClient({
  clientId: clientId,
});
