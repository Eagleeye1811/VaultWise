import { useEffect, useRef, useState } from "react";

import { Icon } from "./ui";

const PRESETS = [10, 50, 100];

/** Slippage tolerance and transaction deadline, shared by Swap and Pools. */
export default function SettingsPopover({ settings, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const custom = !PRESETS.includes(settings.slippageBps);

  return (
    <div className="vw-popover-wrap" ref={ref}>
      <button
        type="button"
        className="vw-icon-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Transaction settings"
        aria-expanded={open}
      >
        <Icon name="gear" />
      </button>
      {open && (
        <div className="vw-popover">
          <h4>Slippage tolerance</h4>
          <div className="vw-chips">
            {PRESETS.map((bps) => (
              <button
                key={bps}
                type="button"
                className={settings.slippageBps === bps ? "active" : ""}
                onClick={() => onChange({ slippageBps: bps })}
              >
                {bps / 100}%
              </button>
            ))}
            <label className={`vw-chip-input ${custom ? "active" : ""}`}>
              <input
                inputMode="decimal"
                placeholder="Custom"
                defaultValue={custom ? settings.slippageBps / 100 : ""}
                onChange={(e) => {
                  const pct = Number(e.target.value);
                  if (Number.isFinite(pct) && pct > 0 && pct <= 50) onChange({ slippageBps: Math.round(pct * 100) });
                }}
              />
              %
            </label>
          </div>
          {settings.slippageBps > 500 && <p className="vw-warn-text">High tolerance — the trade may execute at a much worse price.</p>}
          <h4>Transaction deadline</h4>
          <label className="vw-chip-input wide">
            <input
              inputMode="numeric"
              defaultValue={settings.deadlineMinutes}
              onChange={(e) => {
                const minutes = Number(e.target.value);
                if (Number.isInteger(minutes) && minutes > 0 && minutes <= 180) onChange({ deadlineMinutes: minutes });
              }}
            />
            minutes
          </label>
        </div>
      )}
    </div>
  );
}
