/**
 * Scoped styles for the Navoro shadow root. Nothing here leaks into the host page.
 * Palette follows web/src/styles/tokens.css: ink surfaces, warm-white panel,
 * lime reserved for focus and progress.
 */

/** Inline Navoro N-mark: path ends in a lime dot — the point of arrival. */
export function markSvg(size: number, withTile = false): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">` +
    (withTile ? '<rect width="32" height="32" rx="8" fill="#111210"/>' : '') +
    '<path d="M9 23V9.5L22.5 22.5V12" stroke="#FAF8F3" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="22.5" cy="8.6" r="2.4" fill="#D2F53C"/></svg>'
  );
}

export const STYLES = `
:host{all:initial}
*,*::before,*::after{box-sizing:border-box}
.root{--ink:#111210;--ink2:#2b2c28;--paper:#FAF8F3;--line:#E3E2DB;--line2:#C7C8C1;--muted:#55574F;--subtle:#6F716A;--lime:#D2F53C;--sunk:#EFEDE6;--amber:#9A5B00;--amber-bg:#FBF1DE;--sh:0 1px 2px rgba(17,18,16,.08),0 14px 36px rgba(17,18,16,.16);
font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
button,input{font:inherit;color:inherit;margin:0}
button{cursor:pointer;border:0;background:none;padding:0}
button:disabled{cursor:default;opacity:.45}
:focus{outline:none}
:focus-visible{box-shadow:0 0 0 2px var(--paper),0 0 0 4px var(--ink),0 0 0 7px var(--lime)}
[hidden]{display:none!important}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.launcher,.panel,.card.docked{position:fixed;right:20px;pointer-events:auto}
.left .launcher,.left .panel,.left .card.docked{right:auto;left:20px}
.launcher{bottom:20px;width:52px;height:52px;border-radius:50%;background:var(--ink);display:grid;place-items:center;box-shadow:var(--sh);transition:transform .16s}
.launcher:hover{transform:translateY(-1px)}
.panel{bottom:84px;width:360px;max-height:min(70vh,640px);display:flex;flex-direction:column;background:var(--paper);border:1px solid var(--line);border-radius:14px;box-shadow:var(--sh);overflow:hidden}
.panel,.card{animation:rise .18s ease-out}
@keyframes rise{from{opacity:0;transform:translateY(6px)}}
.head{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 14px;border-bottom:1px solid var(--line)}
.name{flex:1;min-width:0}
h2{margin:0;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.by{font-size:12px;color:var(--subtle)}
.icon-btn{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--muted)}
.icon-btn:hover,.ghost:hover:not(:disabled){background:var(--sunk);color:var(--ink)}
.body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px;overscroll-behavior:contain}
.greet,.answer,.card p{margin:0;color:var(--ink2);white-space:pre-wrap;overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip,.secondary,.form input{border:1px solid var(--line2);background:#fff}
.chip{border-radius:999px;padding:5px 11px;font-size:13px;text-align:left}
.chip:hover,.secondary:hover:not(:disabled),.form input:focus-visible{border-color:var(--ink)}
.form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line);background:#fff}
.form input{flex:1;min-width:0;border-radius:10px;padding:8px 11px}
.form input::placeholder{color:var(--subtle)}
.btn{display:inline-flex;align-items:center;gap:6px;border-radius:10px;padding:7px 13px;font-weight:550;font-size:13.5px;white-space:nowrap}
.primary{background:var(--ink);color:var(--paper)}
.primary:hover:not(:disabled){background:var(--ink2)}
.ghost{color:var(--muted);padding:6px 8px}
.q{align-self:flex-end;max-width:85%;background:var(--sunk);border-radius:12px 12px 4px 12px;padding:7px 11px;overflow-wrap:anywhere}
.loading,.fb,.top,.done{display:flex;align-items:center;gap:10px;color:var(--muted)}
.grow,.count{flex:1}
.dots{display:inline-flex;gap:3px}
.dots i{width:5px;height:5px;border-radius:50%;background:var(--ink);opacity:.25;animation:blink 1.1s infinite}
.dots i+i{animation-delay:.15s}.dots i+i+i{animation-delay:.3s}
@keyframes blink{40%{opacity:.85}}
.badge{align-self:flex-start;font-size:11.5px;font-weight:550;padding:3px 8px;border-radius:6px;background:#E9EFFC;color:#2453C7}
.note,.miss,.err{font-size:13px;padding:8px 10px;border-radius:8px;background:var(--amber-bg);color:var(--amber)}
.err{background:#FBEAEA;color:#B42318;display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.done{padding:10px;border-radius:10px;background:#fff;border:1px solid var(--line);font-size:13px}
.done strong{display:block;font-size:14px;font-weight:600;color:var(--ink)}
.tick{width:24px;height:24px;border-radius:50%;background:var(--lime);display:grid;place-items:center;flex:none}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.cites{border-top:1px solid var(--line);padding-top:10px}
summary{cursor:pointer;font-size:12.5px;color:var(--muted);border-radius:6px}
.cite{margin:8px 0 0;padding-left:10px;border-left:2px solid var(--line2);font-size:12.5px}
.cite b{display:block}
.cite p{margin:2px 0 0;color:var(--muted)}
.link{font-weight:550;text-decoration:underline;text-underline-offset:2px;border-radius:4px;align-self:flex-start;color:inherit}
.fb{gap:4px;font-size:12.5px}
.inspect pre{margin:6px 0 0;max-height:220px;overflow:auto;font:11.5px/1.4 ui-monospace,Menlo,monospace;background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere}
.layer{position:fixed;inset:0;pointer-events:none}
.ring{position:fixed;pointer-events:none}
.ring{border-radius:8px;box-shadow:0 0 0 2px var(--ink),0 0 0 5px var(--lime),0 0 0 9999px rgba(17,18,16,.14);transition:all .12s}
.pulse::after{content:"";position:absolute;inset:-5px;border-radius:11px;border:2px solid var(--lime);animation:pulse 1.1s ease-out 2}
@keyframes pulse{to{opacity:0;transform:scale(1.18)}}
.found{position:absolute;bottom:calc(100% + 8px);left:0;background:var(--ink);color:var(--paper);font-size:12px;font-weight:600;padding:3px 8px;border-radius:6px;animation:fade 1.6s forwards}
@keyframes fade{70%{opacity:1}to{opacity:0}}
.card{position:fixed;width:300px;max-width:calc(100vw - 16px);background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:var(--sh);padding:12px 14px;pointer-events:auto;display:flex;flex-direction:column;gap:6px}
.card.docked{bottom:84px}
.count{font-size:12px;font-weight:550;font-variant-numeric:tabular-nums}
.bar{height:3px;border-radius:2px;background:var(--line);overflow:hidden}
.bar i{display:block;height:100%;background:var(--lime)}
h3{margin:2px 0 0;font-size:14.5px;font-weight:600}
.nav{display:flex;justify-content:space-between;margin-top:6px}
@media (max-width:480px){.panel,.left .panel{left:0;right:0;bottom:0;width:100%;max-height:80vh;border-radius:16px 16px 0 0}.card.docked,.left .card.docked{left:8px;right:8px;width:auto}}
@media (prefers-reduced-motion:reduce){*,::before,::after{animation:none!important;transition:none!important}}
`;
