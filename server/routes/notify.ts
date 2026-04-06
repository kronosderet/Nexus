import { Router, Request, Response } from 'express';
import { execSync } from 'child_process';
import type { NexusStore } from '../db/store.ts';

type BroadcastFn = (data: any) => void;

export function createNotifyRoutes(store: NexusStore, broadcast: BroadcastFn): Router {
  const router = Router();

  router.post('/', (req: Request, res: Response) => {
    const { title = 'Nexus', message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required.' });

    sendToast(title, message);
    const entry = store.addActivity('notification', `Toast -- ${message}`);
    broadcast({ type: 'activity', payload: entry });
    broadcast({ type: 'notification', payload: { title, message } });
    res.json({ success: true, title, message });
  });

  return router;
}

export function sendToast(title: string, message: string): void {
  // PowerShell toast notification on Windows
  const escaped = message.replace(/'/g, "''").replace(/"/g, '`"');
  const titleEsc = title.replace(/'/g, "''").replace(/"/g, '`"');
  const ps = `
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null;
    $xml = [Windows.Data.Xml.Dom.XmlDocument]::new();
    $xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${titleEsc}</text><text>${escaped}</text></binding></visual></toast>');
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml);
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Nexus').Show($toast);
  `.replace(/\n\s*/g, ' ');

  try {
    execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 5000, stdio: 'ignore' });
  } catch {
    // Fallback: simpler notification via PowerShell
    try {
      execSync(
        `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${escaped}','${titleEsc}','OK','Information')"`,
        { timeout: 5000, stdio: 'ignore' }
      );
    } catch {}
  }
}
