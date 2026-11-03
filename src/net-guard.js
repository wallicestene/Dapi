// Dapi reads public web data, so it never fetches an address on the server's own side
// of the internet: loopback, private networks, link-local (where cloud servers keep
// their metadata), carrier and benchmark ranges, IPv6 unique-local, and names such as
// localhost or *.internal. On a public server anyone's spec reaches these code paths;
// without this, a spec (or a page's own scripts) could make the investigation read the
// server's network and show it back.
import dns from 'node:dns/promises';
import net from 'node:net';

const V4 = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['198.18.0.0', 15]];
const int = (ip) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);

export function privateIp(ip) {
  if (net.isIPv4(ip)) return V4.some(([base, bits]) => Math.floor(int(ip) / 2 ** (32 - bits)) === Math.floor(int(base) / 2 ** (32 - bits)));
  if (net.isIPv6(ip)) {
    const a = ip.toLowerCase();
    const mapped = a.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return privateIp(mapped[1]);
    return a === '::1' || a === '::' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a);
  }
  return false;
}

// Whether a URL points somewhere Dapi must not go (or isn't a web address at all).
export async function privateHost(url) {
  let host;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
    host = u.hostname.replace(/^\[|\]$/g, '');
  } catch {
    return true;
  }
  if (/^(localhost|.+\.localhost|.+\.local|.+\.internal)$/i.test(host)) return true;
  if (net.isIP(host)) return privateIp(host);
  try {
    return (await dns.lookup(host, { all: true })).some((a) => privateIp(a.address));
  } catch {
    return false; // a name that doesn't resolve fails on its own
  }
}
