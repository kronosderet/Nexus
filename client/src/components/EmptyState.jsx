/**
 * Shared empty-state row.
 *
 * v4.9.1 #752 — extracted from `Command.jsx:503` where it lived as a private
 * helper. Same shape and visual was being open-coded with `text-center py-12`
 * (or `py-4`) blocks in Log.jsx, Overseer.jsx, Fuel.jsx, Handover.jsx, and
 * Graph.jsx. Promoting the helper keeps the empty rows visually consistent.
 *
 * Props:
 *   icon       — lucide-react component (rendered at size 14, dim opacity)
 *   message    — short prompt shown under the icon
 *   action     — optional secondary node (button, link, hint) under the message
 *   className  — extra classes on the outer wrapper (e.g. `py-12` for tall blocks)
 */
export default function EmptyState({ icon: Icon, message, action, className = 'py-4' }) {
  return (
    <div className={`text-center ${className} text-nexus-text-faint`}>
      {Icon && <Icon size={14} className="mx-auto mb-1.5 opacity-40" />}
      <p className="text-[10px] font-mono">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
