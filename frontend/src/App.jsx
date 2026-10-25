import { Suspense, lazy } from "react";

import AppShell from "./platform/AppShell";
import { PlatformProvider } from "./platform/PlatformContext";
import { DEFAULT_ROUTE, NAV } from "./platform/registry";
import ActivityPage from "./platform/pages/ActivityPage";
import EarnPage from "./platform/pages/EarnPage";
import FaucetPage from "./platform/pages/FaucetPage";
import OverviewPage from "./platform/pages/OverviewPage";
import PoolsPage from "./platform/pages/PoolsPage";
import PortfolioPage from "./platform/pages/PortfolioPage";
import PricesPage from "./platform/pages/PricesPage";
import SwapPage from "./platform/pages/SwapPage";

import { useHashRoute } from "./hooks/useHashRoute";
import { useProtocolData } from "./hooks/useProtocolData";
import { useWallet } from "./hooks/useWallet";

/**
 * VaultWise — application shell.
 *
 * Owns three things: the wallet connection, the protocol snapshot every page
 * reads from, and which page is on screen. Contract writes live in the pages;
 * the original experiment views are mounted unchanged under Labs.
 */

// The experiment consoles are heavy and rarely opened — load them on demand.
const LabsPage = lazy(() => import("./platform/pages/LabsPage"));

const ROUTES = new Set(NAV.map((item) => item.route));

const PAGES = {
  overview: OverviewPage,
  swap: SwapPage,
  pools: PoolsPage,
  earn: EarnPage,
  portfolio: PortfolioPage,
  prices: PricesPage,
  faucet: FaucetPage,
  activity: ActivityPage,
  labs: LabsPage,
};

export default function App() {
  const wallet = useWallet();
  const protocol = useProtocolData(wallet);
  const { route, sub } = useHashRoute(ROUTES, DEFAULT_ROUTE);
  const Page = PAGES[route];

  return (
    <PlatformProvider wallet={wallet} protocol={protocol}>
      <AppShell route={route}>
        <Suspense fallback={<div className="vw-skeleton" style={{ height: 320 }} />}>
          <Page sub={sub} />
        </Suspense>
      </AppShell>
    </PlatformProvider>
  );
}
