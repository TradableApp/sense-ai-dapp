import { ConnectButton } from "thirdweb/react";
import senseaiLogo from "./senseai-logo.svg";
import senseaiTextLogo from "./senseai-text-logo-white-purple.svg"; // <-- Import the new text logo
import { client } from "./client";
import { RainbowButton } from "@/components/magicui/rainbow-button";

export default function App() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4">
      {/* Logo and Title */}
      <div className="flex flex-col items-center text-center mb-10">
        <img
          src={senseaiLogo}
          alt="SenseAI logo"
          className="size-32 md:size-36"
          style={{
            filter: "drop-shadow(0px 0px 24px rgba(167, 38, 169, 0.4))",
          }}
        />

        {/* The H1 text element is now replaced with your SVG text logo */}
        <img
          src={senseaiTextLogo}
          alt="SenseAI"
          className="w-64 md:w-80 mt-6" // Control the width of the text logo here
        />
      </div>

      {/* The Connect Button */}
      <ConnectButton
        client={client}
        appMetadata={{
          name: "SenseAI App",
          url: "https://tradable.app",
        }}
        connectButton={{
          label: <RainbowButton>Connect Wallet</RainbowButton>,
          style: { padding: 0, height: "fit-content", background: "none" },
        }}
      />
    </main>
  );
}
