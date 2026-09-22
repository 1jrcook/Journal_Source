import { useEffect, useState } from 'react';
import { useStore, type ContextMenuItem } from '../lib/store';
import { api } from '../lib/api';
import Icon from './Icon';
import { inJrPane } from '../lib/jrTheme';
import type { PeriodId } from '../lib/templates';

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'daily', label: "Today's daily note" },
  { id: 'weekly', label: "This week's note" },
  { id: 'monthly', label: "This month's note" },
  { id: 'quarterly', label: "This quarter's note" },
  { id: 'yearly', label: "This year's note" },
];

interface RibbonItem {
  id: string;
  title: string;
  icon: string;
  hideable: boolean;
  active?: boolean;
  disabled?: boolean;
  run: () => void;
  /** Right-click entries. When omitted, the menu is just this action. */
  menu?: ContextMenuItem[];
}

export default function Ribbon() {
  const setLeftPanel = useStore((s) => s.setLeftPanel);
  const leftPanel = useStore((s) => s.leftPanel);
  const setGraph = useStore((s) => s.setGraph);
  const setSettings = useStore((s) => s.setSettings);
  const setPalette = useStore((s) => s.setPalette);
  const openPeriodic = useStore((s) => s.openPeriodic);
  const openContextMenu = useStore((s) => s.openContextMenu);
  const setNotesSettings = useStore((s) => s.setNotesSettings);
  const notify = useStore((s) => s.notify);
  const loadTree = useStore((s) => s.loadTree);
  const ribbonHidden = useStore((s) => s.ribbonHidden);
  const toggleRibbonItem = useStore((s) => s.toggleRibbonItem);

  const [gitEnabled, setGitEnabled] = useState(false);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    const refresh = () => api.gitStatus().then((g) => setGitEnabled(!!g?.enabled)).catch(() => setGitEnabled(false));
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, []);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    notify('Syncing…');
    try {
      const r = await api.gitSync();
      notify(r.ok ? 'Synced ✓' : `Sync: ${r.log.at(-1)}`);
      await loadTree();
    } catch (e: any) {
      notify(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const periodItems = (): ContextMenuItem[] =>
    PERIODS.map((p) => ({
      label: p.label,
      icon: p.id === 'daily' ? 'calendar' : undefined,
      onClick: () => openPeriodic(p.id),
    }));

  const items = (): RibbonItem[] => {
    const list: RibbonItem[] = [
      { id: 'files', title: 'Files', icon: 'file-text', hideable: true, active: leftPanel === 'files', run: () => setLeftPanel('files') },
      { id: 'search', title: 'Search', icon: 'search', hideable: true, active: leftPanel === 'search', run: () => setLeftPanel('search') },
      { id: 'graph', title: 'Graph view', icon: 'graph', hideable: true, run: () => setGraph(true) },
      { id: 'bookmarks', title: 'Bookmarks', icon: 'bookmark', hideable: true, active: leftPanel === 'bookmarks', run: () => setLeftPanel('bookmarks') },
      {
        id: 'periodic',
        title: 'Periodic notes',
        icon: 'calendar',
        hideable: true,
        run: () => openPeriodic('daily'),
        menu: periodItems(),
      },
      { id: 'templates', title: 'Templates and periodic notes', icon: 'library', hideable: true, run: () => setNotesSettings(true) },
      { id: 'tags', title: 'Tags', icon: 'hash', hideable: true, active: leftPanel === 'tags', run: () => setLeftPanel('tags') },
      { id: 'commands', title: 'Command palette', icon: 'command', hideable: true, run: () => setPalette(true, 'commands') },
    ];
    if (gitEnabled) {
      list.push({
        id: 'sync',
        title: syncing ? 'Syncing…' : 'Sync now',
        icon: 'refresh-cw',
        hideable: true,
        disabled: syncing,
        run: () => { void sync(); },
      });
    }
    if (!inJrPane()) {
      list.push({ id: 'settings', title: 'Settings', icon: 'settings', hideable: true, run: () => setSettings(true) });
    }
    return list;
  };

  const hidden = new Set(ribbonHidden);

  const openShowHide = (x: number, y: number) => {
    const hiddenNow = new Set(useStore.getState().ribbonHidden);
    openContextMenu({
      x,
      y,
      items: items().filter((item) => item.hideable).map((item) => ({
        label: item.title,
        icon: hiddenNow.has(item.id) ? undefined : 'check',
        keepOpen: true,
        onClick: () => {
          toggleRibbonItem(item.id);
          openShowHide(x, y);
        },
      })),
    });
  };

  const openMainMenu = (x: number, y: number) => {
    const entries: ContextMenuItem[] = items().map((item) => (
      item.id === 'periodic'
        ? { label: 'Periodic notes', icon: 'calendar', submenu: periodItems() }
        : { label: item.title, icon: item.icon, onClick: item.run }
    ));
    entries.push(
      { label: '', separator: true },
      { label: 'Show or hide icons', icon: 'sliders', keepOpen: true, onClick: () => openShowHide(x, y) },
    );
    openContextMenu({ x, y, items: entries });
  };

  const openItemMenu = (item: RibbonItem, x: number, y: number) => {
    const entries: ContextMenuItem[] = item.menu ?? [{ label: item.title, icon: item.icon, onClick: item.run }];
    if (item.hideable) {
      entries.push(
        { label: '', separator: true },
        { label: 'Hide', icon: 'eye-off', onClick: () => toggleRibbonItem(item.id) },
      );
    }
    openContextMenu({ x, y, items: entries });
  };

  useEffect(() => {
    const onMenu = (e: Event) => {
      const mode = (e as CustomEvent).detail;
      const btn = document.querySelector('.ribbon .ribbon-menu');
      const r = btn?.getBoundingClientRect();
      const x = r ? r.right + 6 : 56;
      const y = r ? r.top : 80;
      if (mode === 'visibility') openShowHide(x, y);
      else openMainMenu(x, y);
    };
    window.addEventListener('wo-ribbon-menu', onMenu);
    return () => window.removeEventListener('wo-ribbon-menu', onMenu);
  });

  const shown = items().filter((item) => !hidden.has(item.id));
  const top = shown.filter((item) => item.id !== 'sync' && item.id !== 'settings');
  const bottom = shown.filter((item) => item.id === 'sync' || item.id === 'settings');

  const button = (item: RibbonItem) => (
    <button
      key={item.id}
      className={item.active ? 'active' : ''}
      title={item.title}
      disabled={item.disabled}
      onClick={() => item.run()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openItemMenu(item, e.clientX, e.clientY);
      }}
    >
      <Icon
        name={item.icon}
        size={18}
        style={item.id === 'sync' && syncing ? { animation: 'spin 1s linear infinite' } : undefined}
      />
    </button>
  );

  return (
    <div
      className="ribbon"
      onContextMenu={(e) => {
        e.preventDefault();
        openShowHide(e.clientX, e.clientY);
      }}
    >
      {top.map(button)}
      <div className="spacer" />
      <button
        className="ribbon-menu"
        title="Menu"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          openMainMenu(r.right + 6, r.top);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          openMainMenu(r.right + 6, r.top);
        }}
      >
        <Icon name="menu" size={18} />
      </button>
      {bottom.map(button)}
    </div>
  );
}
