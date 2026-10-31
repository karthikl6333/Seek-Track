import { Popover } from '../components/Popover';
import { SHORTCUT_HELP } from '../lib/shortcuts';

export function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Keyboard shortcuts"
      title="Keyboard shortcuts (?)"
      trigger={<span aria-hidden="true">?</span>}
    >
      <div className="popover-title">Keyboard shortcuts</div>
      <dl className="shortcut-list">
        {SHORTCUT_HELP.map((s) => (
          <div key={s.keys} className="shortcut-row">
            <dt>
              <kbd>{s.keys}</kbd>
            </dt>
            <dd>{s.what}</dd>
          </div>
        ))}
      </dl>
    </Popover>
  );
}
