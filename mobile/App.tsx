import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AnalysisScreen } from "./src/components/AnalysisScreen";
import { HomeScreen } from "./src/components/HomeScreen";

const LAST_ADDRESS_KEY = "solartelligence:last-address";

type AppScreen = "home" | "analysis";

export default function App() {
  const [screen, setScreen] = useState<AppScreen>("home");
  const [address, setAddress] = useState("");
  const [lastAddress, setLastAddress] = useState("");

  useEffect(() => {
    let active = true;

    void AsyncStorage.getItem(LAST_ADDRESS_KEY).then((storedAddress) => {
      if (active && storedAddress) {
        setLastAddress(storedAddress);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  function openAnalysis(nextAddress: string) {
    const cleanAddress = nextAddress.trim();

    if (!cleanAddress) return;

    setAddress(cleanAddress);
    setLastAddress(cleanAddress);
    setScreen("analysis");
    void AsyncStorage.setItem(LAST_ADDRESS_KEY, cleanAddress);
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {screen === "analysis" && address ? (
        <AnalysisScreen address={address} onHome={() => setScreen("home")} />
      ) : (
        <HomeScreen lastAddress={lastAddress} onAnalyze={openAnalysis} />
      )}
    </SafeAreaProvider>
  );
}
