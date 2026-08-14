#!/usr/bin/env node
/**
 * Starts Expo against the laptop's *current* LAN address.
 *
 * ## The problem this removes
 *
 * A phone needs two things from the laptop: the Metro bundler (8081) and the
 * API (4000). Both are reached by IP, and that IP is handed out by DHCP — so it
 * changes when you join a different network, and often when a lease renews on
 * the same one. Pinning it in the launch command works exactly until it does
 * not, and the failure looks like "the app opens on my hotspot but not on the
 * room wifi" rather than like a stale address.
 *
 * So nothing is pinned here. The address is resolved on every start.
 *
 * ## How the address is chosen
 *
 * A development laptop usually has several IPv4 addresses and most of them are
 * useless to a phone:
 *
 *   192.168.112.1   vEthernet (WSL)        — a virtual switch, phone cannot reach it
 *   192.168.56.1    VirtualBox host-only   — same
 *   169.254.x.x     link-local             — an interface that failed to get DHCP
 *   172.168.1.75    Wi-Fi                  — the one that actually works
 *
 * Picking by name is fragile. Instead this asks the operating system which
 * source address it *would* use to reach the outside world, by opening a UDP
 * socket to a public address and reading back the local end. No packet is sent
 * — `connect` on UDP only fixes the route — so it works on a network with no
 * internet, as long as a default route exists. If that fails, it falls back to
 * scoring the interface list and excluding the known-virtual ranges.
 *
 * ## What it will not do
 *
 * It will not start if the API is unreachable on the chosen address, because
 * that produces an app that loads and then fails every request — the most
 * confusing possible state. It says which of the two is wrong instead.
 *
 * Usage:
 *   npm run lan:auto              # detect, verify, start
 *   npm run lan:auto -- --tunnel  # same, but route Metro through Expo's tunnel
 *   npm run lan:auto -- --check   # diagnose only, start nothing
 */
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';

const API_PORT = Number(process.env.API_PORT ?? 4000);
const METRO_PORT = Number(process.env.RCT_METRO_PORT ?? 8081);

/** Ranges belonging to virtual adapters a phone can never route to. */
const VIRTUAL = [
  { test: (ip) => ip.startsWith('169.254.'), why: 'link-local (no DHCP lease)' },
  { test: (ip) => ip.startsWith('192.168.56.'), why: 'VirtualBox host-only' },
  { test: (ip) => ip.startsWith('172.17.'), why: 'Docker bridge' },
  { test: (ip) => ip.startsWith('198.18.'), why: 'benchmark/VPN range' },
];

const NAME_HINTS = /vethernet|wsl|hyper-v|virtualbox|vmware|loopback|docker|bluetooth/i;

/**
 * The source address the OS would use to reach a remote host.
 * `connect` on a UDP socket sends nothing; it only binds the route.
 */
function routedAddress(timeoutMs = 800) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve(value);
    };

    const socket = createSocket('udp4');
    socket.once('error', () => done(null));
    const timer = setTimeout(() => done(null), timeoutMs);
    timer.unref?.();

    try {
      socket.connect(53, '8.8.8.8', () => {
        const address = socket.address()?.address ?? null;
        clearTimeout(timer);
        done(address && address !== '0.0.0.0' ? address : null);
      });
    } catch {
      clearTimeout(timer);
      done(null);
    }
  });
}

/** Every usable IPv4, with the virtual ones annotated rather than hidden. */
function candidates() {
  const out = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      const virtual = VIRTUAL.find((v) => v.test(address.address));
      const byName = NAME_HINTS.test(name);
      out.push({
        ip: address.address,
        name,
        usable: !virtual && !byName,
        why: virtual?.why ?? (byName ? 'virtual adapter' : null),
      });
    }
  }
  return out;
}

/**
 * Whether Windows Firewall has any inbound rule that would let a phone in.
 *
 * The trap this catches is specific and easy to miss: Windows creates its
 * "allow node" rules against the **full path** of whichever node.exe was
 * running when you clicked Allow. Switch node versions — nvm-windows, nvm4w, a
 * fresh installer — and the running binary lives somewhere else, so every one
 * of those rules silently stops applying. Nothing changes in the app, the
 * bundler still works if its bundle is cached, and the API just stops being
 * reachable.
 *
 * Checked by port as well as by program, because a port rule is what survives
 * the next version switch.
 *
 * @returns {Promise<{checked: boolean, allowed: boolean}>}
 */
async function firewallAllows(ports) {
  if (process.platform !== 'win32') return { checked: false, allowed: true };

  const { execFile } = await import('node:child_process');
  const script = `
    $exe = '${process.execPath.replace(/\\/g, '\\\\')}'
    $byProgram = Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue |
      Where-Object { $_.Program -ieq $exe } |
      ForEach-Object { $_ | Get-NetFirewallRule -ErrorAction SilentlyContinue } |
      Where-Object { $_.Direction -eq 'Inbound' -and $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' }
    $byPort = Get-NetFirewallPortFilter -ErrorAction SilentlyContinue |
      Where-Object { $_.LocalPort -in @(${ports.map((p) => `'${p}'`).join(',')}) } |
      ForEach-Object { $_ | Get-NetFirewallRule -ErrorAction SilentlyContinue } |
      Where-Object { $_.Direction -eq 'Inbound' -and $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' }
    if ($byProgram -or $byPort) { 'ALLOWED' } else { 'NONE' }
  `;

  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 12_000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve({ checked: false, allowed: true });
        resolve({ checked: true, allowed: String(stdout).includes('ALLOWED') });
      },
    );
  });
}

async function reachable(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const tunnel = argv.includes('--tunnel');
  const passthrough = argv.filter((a) => a !== '--check');

  const all = candidates();
  const routed = await routedAddress();

  // The routed address wins when it is one of ours and not virtual.
  const routedEntry = all.find((c) => c.ip === routed);
  const chosen = routedEntry?.usable ? routedEntry : all.find((c) => c.usable);

  console.log('\nInterfaces seen:');
  for (const c of all) {
    const mark = c.ip === chosen?.ip ? '→' : ' ';
    const note = c.why ? `  (skipped: ${c.why})` : c.ip === routed ? '  (default route)' : '';
    console.log(`  ${mark} ${c.ip.padEnd(16)} ${c.name}${note}`);
  }

  if (!chosen) {
    console.error(
      '\nNo usable LAN address. The Wi-Fi adapter has no DHCP lease — reconnect to the network and retry.\n',
    );
    process.exitCode = 1;
    return;
  }

  const host = chosen.ip;
  const apiUrl = `http://${host}:${API_PORT}/api/v1`;

  console.log(`\nUsing ${host}`);
  console.log(`  API   ${apiUrl}`);
  console.log(`  Metro http://${host}:${METRO_PORT}`);

  /*
   * This proves the server is BOUND to the address, not that a phone can get
   * to it: a connection from this machine to its own LAN IP is handled by the
   * loopback path and never crosses the firewall. Only the phone can prove the
   * rest, which is why the success message below hands over a URL to open
   * there rather than declaring victory.
   */
  const apiUp = await reachable(`http://${host}:${API_PORT}/healthz`);
  console.log(`\n  API bound to this address: ${apiUp ? 'yes' : 'NO'}`);

  if (!apiUp) {
    const loopbackUp = await reachable(`http://127.0.0.1:${API_PORT}/healthz`);
    console.error(
      loopbackUp
        ? [
            '',
            'The API answers on 127.0.0.1 but not on the LAN address, so the server is',
            'running and something is blocking it from outside. On Windows this is almost',
            'always the firewall. Allow it once, from an ADMIN PowerShell:',
            '',
            `  New-NetFirewallRule -DisplayName "Khetri dev API ${API_PORT}" -Direction Inbound -Protocol TCP -LocalPort ${API_PORT} -Action Allow -Profile Any`,
            `  New-NetFirewallRule -DisplayName "Khetri dev Metro ${METRO_PORT}" -Direction Inbound -Protocol TCP -LocalPort ${METRO_PORT} -Action Allow -Profile Any`,
            '',
          ].join('\n')
        : [
            '',
            `Nothing is listening on port ${API_PORT}. Start the backend first:`,
            '',
            '  cd backend && npm run dev',
            '',
          ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  const firewall = await firewallAllows([API_PORT, METRO_PORT]);
  if (firewall.checked && !firewall.allowed) {
    console.error(
      [
        '',
        '  ── Windows Firewall will block the phone ───────────────────────────',
        '',
        `  No inbound rule covers this node binary or ports ${API_PORT}/${METRO_PORT}:`,
        `    ${process.execPath}`,
        '',
        '  Windows writes its "allow node" rules against the FULL PATH of the',
        '  node.exe that was running when you clicked Allow. Switching node',
        '  versions moves that path, and every one of those rules silently stops',
        '  applying — which is why this can break without you changing anything.',
        '',
        '  Fix it once, in an ADMIN PowerShell. These are port rules, so they',
        '  survive the next node version switch:',
        '',
        `    New-NetFirewallRule -DisplayName "Khetri dev API ${API_PORT}" -Direction Inbound -Protocol TCP -LocalPort ${API_PORT} -Action Allow -Profile Any`,
        `    New-NetFirewallRule -DisplayName "Khetri dev Metro ${METRO_PORT}" -Direction Inbound -Protocol TCP -LocalPort ${METRO_PORT} -Action Allow -Profile Any`,
        '',
        '  -Profile Any matters: Windows classifies most shared networks as',
        '  Public, and a rule scoped to Private alone will not apply there.',
        '',
      ].join('\n'),
    );
  }

  /*
   * The one thing this machine cannot determine on its own. Many institutional
   * and hotel networks enable AP/client isolation, which blocks phone→laptop
   * traffic no matter how the laptop is configured — and it is the usual reason
   * a personal hotspot works while a shared network does not.
   */
  console.log(
    [
      '',
      '  Confirm from the PHONE, on this same Wi-Fi, before scanning:',
      `    open  http://${host}:${API_PORT}/healthz  in the phone browser`,
      '',
      '    JSON shown       → the network allows it; Expo will work.',
      '    hangs / refused  → this Wi-Fi blocks device-to-device traffic',
      '                       (AP isolation). No laptop setting fixes that —',
      '                       use `npm run tunnel`, or a personal hotspot.',
    ].join('\n'),
  );

  if (checkOnly) {
    console.log('\n  --check: not starting Expo.\n');
    return;
  }

  /*
   * Both variables matter and they are not interchangeable:
   *   EXPO_PUBLIC_API_URL         compiled into the bundle — where the app sends requests
   *   REACT_NATIVE_PACKAGER_HOSTNAME  where the phone fetches the bundle from
   * Setting only one produces an app that loads but cannot talk, or vice versa.
   */
  const env = {
    ...process.env,
    EXPO_PUBLIC_API_URL: apiUrl,
    REACT_NATIVE_PACKAGER_HOSTNAME: host,
  };

  const args = ['expo', 'start', ...(tunnel ? [] : ['--lan']), ...passthrough];
  console.log(`\n  npx ${args.join(' ')}\n`);

  const child = spawn('npx', args, { env, stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => process.exit(code ?? 0));
}

await main();
