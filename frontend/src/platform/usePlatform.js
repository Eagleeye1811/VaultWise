import { createContext, useContext } from "react";

/** Wallet, protocol snapshot and transaction manager — see PlatformContext.jsx. */
export const PlatformContext = createContext(null);

export const usePlatform = () => useContext(PlatformContext);
