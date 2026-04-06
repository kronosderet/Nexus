import { spawn } from 'child_process';

/**
 * Terminal backend via WebSocket.
 * No node-pty needed -- uses child_process.spawn with shell: true.
 * Each WebSocket connection gets its own shell process.
 */
export function attachTerminal(wss) {
  wss.on('connection', (ws) => {
    const shell = spawn('powershell.exe', ['-NoLogo', '-NoProfile'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: { ...process.env, TERM: 'xterm-256color' },
      cwd: 'C:/Projects',
    });

    // Stream stdout to WebSocket
    shell.stdout.on('data', (data) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'terminal_output', data: data.toString() }));
      }
    });

    shell.stderr.on('data', (data) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'terminal_output', data: data.toString() }));
      }
    });

    shell.on('exit', (code) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'terminal_exit', code }));
      }
    });

    // Receive input from WebSocket
    ws.on('message', (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());
        if (parsed.type === 'terminal_input' && shell.stdin.writable) {
          shell.stdin.write(parsed.data);
        }
        if (parsed.type === 'terminal_resize') {
          // PowerShell doesn't support resize via stdin, but we track it
        }
      } catch {}
    });

    ws.on('close', () => {
      shell.kill();
    });

    // Send ready signal
    ws.send(JSON.stringify({ type: 'terminal_ready', cwd: 'C:/Projects' }));
  });
}
