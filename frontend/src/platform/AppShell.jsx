import { useEffect, useRef, useState } from "react";

import { EXPLORER_ADDRESS_BASE_URL, EXPLORER_TX_BASE_URL, TARGET_NETWORK_NAME } from "../contracts/contractConfig";
import { shortAddress } from "../utils/format";
import { usePlatform } from "./usePlatform";
import { NAV } from "./registry";
import { Icon } from "./ui";

/**
 * The application frame: sidebar navigation, the top bar with live chain
 * status and the wallet, network banners, and the transaction toasts.
 */

function Brand() {
  return (
    <a className="vw-brand" href="#/overview">
      <span className="vw-brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="28" height="28">
          <rect width="32" height="32" rx="6" fill="currentColor" />
          <path d="M9 10l7 12 7-12" fill="none" stroke="var(--vw-surface)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="vw-brand-text">
        <strong>VaultWise</strong>
        <small>Finance</small>
      </span>
    </a>
  );
}

function Sidebar({ route, open, onClose }) {
  return (
    <>
      <aside className={`vw-sidebar ${open ? "open" : ""}`}>
        <Brand />
        <nav className="vw-nav" aria-label="Main">
          {NAV.map((item) => (
            <a
              key={item.route}
              href={`#/${item.route}`}
              className={`vw-nav-item ${route === item.route ? "active" : ""}`}
              aria-current={route === item.route ? "page" : undefined}
              onClick={onClose}
            >
              <Icon name={item.icon} />
              {item.label}
            </a>
          ))}
        </nav>
        <div className="vw-sidebar-foot">
          <span className="vw-testnet-chip">
            <Icon name="shield" size={14} /> Testnet only
          </span>
          <p>Every token here is a mock on {TARGET_NETWORK_NAME}. Never send real funds.</p>
        </div>
      </aside>
      {open && <button type="button" className="vw-scrim" aria-label="Close menu" onClick={onClose} />}
    </>
  );
}

function WalletMenu() {
  const { wallet } = usePlatform();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!wallet.account) {
    return (
      <button type="button" className="vw-btn vw-btn-primary" onClick={wallet.connect} disabled={wallet.isConnecting}>
        {wallet.isConnecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wallet.account);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — the address is still visible in the menu
    }
  };

  return (
    <div className="vw-wallet" ref={ref}>
      <button type="button" className="vw-wallet-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="vw-avatar" />
        {shortAddress(wallet.account, 6, 4)}
      </button>
      {open && (
        <div className="vw-menu" role="menu">
          <div className="vw-menu-head">
            <span className="vw-menu-label">Connected with MetaMask</span>
            <code>{shortAddress(wallet.account, 10, 8)}</code>
          </div>
          <button type="button" role="menuitem" onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={16} /> {copied ? "Copied" : "Copy address"}
          </button>
          <a role="menuitem" href={`${EXPLORER_ADDRESS_BASE_URL}${wallet.account}`} target="_blank" rel="noreferrer">
            <Icon name="external" size={16} /> View on Etherscan
          </a>
          <a role="menuitem" href="#/activity" onClick={() => setOpen(false)}>
            <Icon name="clock" size={16} /> Recent activity
          </a>
          <p className="vw-menu-note">To disconnect, remove this site under MetaMask → Connected sites.</p>
        </div>
      )}
    </div>
  );
}

function Topbar({ onMenu }) {
  const { wallet, protocol } = usePlatform();
  const block = protocol.staleData?.blockNumber;
  const live = !protocol.error && block;

  return (
    <header className="vw-topbar">
      <button type="button" className="vw-icon-btn vw-menu-toggle" onClick={onMenu} aria-label="Open menu">
        <Icon name="menu" />
      </button>
      <div className="vw-topbar-status">
        <span className={`vw-live ${live ? "ok" : "down"}`} title={protocol.error || "Reading live from Sepolia"}>
          <i />
          {live ? `Block ${block.toLocaleString("en-US")}` : protocol.error ? "Reconnecting" : "Connecting"}
        </span>
      </div>
      <div className="vw-topbar-right">
        {wallet.account && (
          <span className={`vw-net ${wallet.isCorrectNetwork ? "ok" : "warn"}`}>
            <i />
            {wallet.isCorrectNetwork ? "Sepolia" : wallet.networkName || "Wrong network"}
          </span>
        )}
        <WalletMenu />
      </div>
    </header>
  );
}

function Banners() {
  const { wallet } = usePlatform();
  return (
    <>
      {!wallet.hasWallet && (
        <div className="vw-banner warn">
          <Icon name="info" size={16} /> No browser wallet detected — you can browse markets, but trading needs{" "}
          <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
            MetaMask
          </a>
          .
        </div>
      )}
      {wallet.account && !wallet.isCorrectNetwork && (
        <div className="vw-banner warn">
          <Icon name="info" size={16} /> Your wallet is on {wallet.networkName || "another network"}. VaultWise runs on{" "}
          {TARGET_NETWORK_NAME}.
          <button type="button" className="vw-btn vw-btn-sm vw-btn-warn" onClick={wallet.switchToTargetNetwork}>
            Switch network
          </button>
        </div>
      )}
      {wallet.walletError && wallet.hasWallet && (
        <div className="vw-banner error">
          <Icon name="info" size={16} /> {wallet.walletError}
          <button type="button" className="vw-icon-btn" onClick={() => wallet.setWalletError("")} aria-label="Dismiss">
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
    </>
  );
}

function Toasts() {
  const { toasts, dismissToast } = usePlatform();
  return (
    <div className="vw-toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`vw-toast ${toast.status}`}>
          <div className="vw-toast-head">
            <span className="vw-toast-icon">
              {toast.status === "pending" ? (
                <span className="vw-spinner" />
              ) : (
                <Icon name={toast.status === "confirmed" ? "check" : "x"} size={16} />
              )}
            </span>
            <strong>{toast.title}</strong>
            <button type="button" className="vw-icon-btn" onClick={() => dismissToast(toast.id)} aria-label="Dismiss">
              <Icon name="x" size={14} />
            </button>
          </div>
          {toast.steps.length > 1 && (
            <ol className="vw-toast-steps">
              {toast.steps.map((label, i) => (
                <li
                  key={label}
                  className={i < toast.stepIndex || toast.status === "confirmed" ? "done" : i === toast.stepIndex ? toast.status : ""}
                >
                  {label}
                </li>
              ))}
            </ol>
          )}
          <p>{toast.message}</p>
          {toast.hash && (
            <a href={`${EXPLORER_TX_BASE_URL}${toast.hash}`} target="_blank" rel="noreferrer">
              View transaction <Icon name="external" size={12} />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

export default function AppShell({ route, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="vw-app">
      <Sidebar route={route} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="vw-main">
        <Topbar onMenu={() => setMenuOpen(true)} />
        <Banners />
        <main className="vw-content">{children}</main>
        <footer className="vw-footer">
          <span>VaultWise · open-source DeFi lab on {TARGET_NETWORK_NAME}</span>
          <span>Reads are live on-chain. No backend, no custody — your wallet signs everything.</span>
        </footer>
      </div>
      <Toasts />
    </div>
  );
}
