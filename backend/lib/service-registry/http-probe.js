'use strict';

const net = require('node:net');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { iconMime } = require('./http-store');
const { detectDockerGateway } = require('./http-gateway');

const trusted = new net.BlockList();
trusted.addSubnet('127.0.0.0', 8, 'ipv4');
trusted.addSubnet('10.0.0.0', 8, 'ipv4');
trusted.addSubnet('172.16.0.0', 12, 'ipv4');
trusted.addSubnet('192.168.0.0', 16, 'ipv4');
trusted.addAddress('::1', 'ipv6');
trusted.addSubnet('fc00::', 7, 'ipv6');

const MAX_HTML_BYTES = 256 * 1024;
const MAX_ICON_BYTES = 128 * 1024;

function allowedHost(host) {
  const type = net.isIP(host);
  return Boolean(type && trusted.check(host, type === 4 ? 'ipv4' : 'ipv6'));
}

function readHttpMetadataConfig(env = process.env, dockerized = fs.existsSync('/.dockerenv'),
  discoverGateway = detectDockerGateway) {
  const value = env.SERVICE_REGISTRY_HTTP_ENABLED;
  if (value !== undefined && value !== 'true' && value !== 'false') {
    throw new TypeError('SERVICE_REGISTRY_HTTP_ENABLED must be true or false');
  }
  const requested = value !== 'false';
  const supplied = (env.SERVICE_REGISTRY_HTTP_HOST || '').trim();
  if (requested && supplied && (!allowedHost(supplied) || supplied.includes('%'))) {
    throw new TypeError('SERVICE_REGISTRY_HTTP_HOST must be a private/loopback IP literal');
  }
  const detected = requested && dockerized && !supplied ? discoverGateway() : null;
  // Never fall back to the container's loopback for host-side services.
  const host = supplied || (dockerized ? detected : '127.0.0.1');
  const validHost = Boolean(host && allowedHost(host));
  const enabled = requested && validHost;
  const mode = !requested ? 'disabled' : supplied ? 'explicit' :
    dockerized ? 'docker_gateway' : 'native_loopback';
  return {
    requested, enabled, host: enabled ? host : null, mode,
    missingHost: requested && !validHost,
    reason: !requested ? 'disabled_by_user' : !validHost ? 'gateway_unavailable' : null,
  };
}

function cleanText(value) {
  const noTags = String(value).replace(/<[^>]*>/g, ' ');
  const decoded = noTags.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,8}|amp|lt|gt|quot|apos|nbsp);/gi,
    (_whole, entity) => {
      const text = entity.toLowerCase();
      const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (named[text]) return named[text];
      const code = text.startsWith('#x') ? parseInt(text.slice(2), 16) : Number(text.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code) : '';
    });
  return Array.from(decoded, ch => ch.codePointAt(0) < 32 ? ' ' : ch)
    .join('').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function attribute(tag, key) {
  const re = new RegExp('(?:^|\\s)' + key + '\\s*=\\s*(?:"([^"]{0,2048})"|\\x27([^\\x27]{0,2048})\\x27|([^\\s>]{1,2048}))', 'i');
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function extractRootMetadata(html) {
  const titleMatch = /<title\b[^>]{0,100}>([\s\S]{0,4096}?)<\/title\s*>/i.exec(html);
  const title = titleMatch ? cleanText(titleMatch[1]) : '';
  let href = null;
  for (const m of html.matchAll(/<link\b[^>]{0,2048}>/gi)) {
    const rel = attribute(m[0], 'rel');
    if (!rel || !rel.toLowerCase().split(/\s+/).includes('icon')) continue;
    href = attribute(m[0], 'href');
    if (href) break;
  }
  return { title, iconHref: href ? cleanText(href) : null };
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/**
 * All requests use a literal IP in the URL. No DNS lookups, credentials,
 * cookies, proxy settings, cross-origin redirects, or JavaScript execution.
 */
async function requestBounded(initial, { maxBytes, timeoutMs = 2500, accept = '*/*' }) {
  const origin = initial.origin;
  let target = initial;
  for (let redirectCount = 0; redirectCount <= 2; redirectCount++) {
    if (target.origin !== origin || target.username || target.password ||
        !['http:', 'https:'].includes(target.protocol) ||
        target.href.length > 2400) throw fail('external_redirect');
    const response = await new Promise((resolve, reject) => {
      const transport = target.protocol === 'https:' ? https : http;
      const request = transport.request(target, {
        agent: false, method: 'GET', timeout: timeoutMs,
        signal: AbortSignal.timeout(timeoutMs),
        rejectUnauthorized: true,
        headers: {
          Accept: accept, 'User-Agent': 'Portracker-Metadata/1.0',
          'Accept-Encoding': 'identity', Connection: 'close',
        },
      }, incoming => {
        const code = incoming.statusCode || 0;
        const ct = String(incoming.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if ([301, 302, 303, 307, 308].includes(code)) {
          incoming.resume();
          resolve({ code, location: incoming.headers.location, contentType: ct });
          return;
        }
        if (Number(incoming.headers['content-length']) > maxBytes) {
          reject(fail('too_large'));
          incoming.destroy();
          return;
        }
        const chunks = [];
        let size = 0;
        incoming.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) {
            reject(fail('too_large'));
            incoming.destroy();
          } else chunks.push(chunk);
        });
        incoming.once('error', () => reject(fail('network_error')));
        incoming.once('aborted', () => reject(fail('network_error')));
        incoming.once('end', () => resolve({ code, contentType: ct, bytes: Buffer.concat(chunks) }));
      });
      request.on('error', error => reject(error.code === 'ABORT_ERR'
        ? fail('timeout')
        : error.code === 'CERT_HAS_EXPIRED' || error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
          error.code === 'SELF_SIGNED_CERT_IN_CHAIN' || error.code === 'ERR_TLS_CERT_ALTNAME_INVALID'
          ? fail('tls_untrusted') : fail('network_error')));
      request.on('timeout', () => request.destroy(fail('timeout')));
      request.end();
    });
    if (!response.location) return { ...response, finalUrl: target };
    if (redirectCount === 2 || typeof response.location !== 'string' ||
        response.location.length > 2048) throw fail('external_redirect');
    const next = new URL(response.location, target);
    if (next.origin !== origin || next.username || next.password) throw fail('external_redirect');
    target = next;
  }
  throw fail('external_redirect');
}

async function probeWebMetadata({ host, port, timeoutMs = 2500 }) {
  if (!allowedHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw fail('blocked_target');
  }
  const bracketed = net.isIP(host) === 6 ? '[' + host + ']' : host;
  const scheme = [443, 8443, 9443, 10443].includes(port) ? 'https' : 'http';
  const rootUrl = new URL(scheme + '://' + bracketed + ':' + port + '/');
  const page = await requestBounded(rootUrl, {
    maxBytes: MAX_HTML_BYTES, timeoutMs, accept: 'text/html,application/xhtml+xml',
  });
  if (page.code !== 200 || !['text/html', 'application/xhtml+xml'].includes(page.contentType)) {
    throw fail('not_html');
  }
  const { title, iconHref } = extractRootMetadata(page.bytes.toString('utf8'));
  let iconBytes = null;
  let iconType = null;
  let icon = null;
  try {
    icon = iconHref ? new URL(iconHref, page.finalUrl) : new URL('/favicon.ico', rootUrl);
    if (icon.origin !== rootUrl.origin || icon.username || icon.password ||
        icon.href.length > 2400 || !/\.(ico|png|jpg|jpeg|gif|webp)$/i.test(icon.pathname)) {
      icon = null;
    }
  } catch { icon = null; }
  if (icon) {
    try {
      const result = await requestBounded(icon, {
        maxBytes: MAX_ICON_BYTES, timeoutMs,
        accept: 'image/png,image/jpeg,image/gif,image/webp,image/x-icon,image/vnd.microsoft.icon',
      });
      const detected = iconMime(result.bytes);
      if (result.code === 200 && detected && (
        result.contentType === detected ||
        (detected === 'image/x-icon' && result.contentType === 'image/vnd.microsoft.icon')
      )) {
        iconBytes = result.bytes;
        iconType = result.contentType;
      }
    } catch { /* favicon failure is not service-status failure */ }
  }
  if (!title && !iconBytes) throw fail('no_metadata');
  return { title, rootUrl: rootUrl.href, iconBytes, iconType };
}

module.exports = {
  allowedHost, readHttpMetadataConfig, extractRootMetadata,
  probeWebMetadata, requestBounded,
};
