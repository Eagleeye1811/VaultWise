/**
 * Top navigation bar: brand on the left, wallet button + network on the right.
 * Purely presentational — all wallet logic lives in App.jsx.
 */
export default function Navbar({
  account,
  networkName,
  isCorrectNetwork,
  isConnecting,
  onConnect,
}) {
  /** 0x71A0...92A4 */
  const shortAddress = (addr) => `${addr.slice(0, 5)}...${addr.slice(-4)}`;

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            V
          </span>
          <span className="brand-name">VaultWise</span>
        </div>

        <div className="navbar-right">
          {account && networkName && (
            <span
              className={`network-pill ${isCorrectNetwork ? "ok" : "warn"}`}
              title={`Connected network: ${networkName}`}
            >
              <span className="dot" aria-hidden="true" />
              {networkName}
            </span>
          )}

          {account ? (
            <span className="wallet-pill" title={account}>
              {shortAddress(account)}
            </span>
          ) : (
            <button
              className="btn btn-primary"
              onClick={onConnect}
              disabled={isConnecting}
            >
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
