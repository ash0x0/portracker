'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { describe, test, expect } = require('@jest/globals');

const root = path.resolve(__dirname, '../../..');
const compose = yaml.safeLoad(fs.readFileSync(
  path.join(root, 'docker-compose.registry-fork.yml'), 'utf8'
));

describe('fork-only localhost registry deployment contract', () => {
  test('builds this checkout instead of pulling the upstream published image', () => {
    const app = compose.services.portracker;
    expect(app.build).toEqual({ context: '.', dockerfile: 'Dockerfile' });
    expect(app.image).toBe('portracker:fork-local');
    expect(app.image).not.toContain('mostafawahied');
    expect(Object.keys(compose.services)).toEqual(['portracker', 'docker-api-proxy']);
  });

  test('requires authentication, a caller-managed persistent secret and localhost binding', () => {
    const app = compose.services.portracker;
    expect(app.ports).toEqual(['127.0.0.1:4999:4999']);
    expect(app.environment.ENABLE_AUTH).toBe('true');
    expect(app.environment.SESSION_SECRET).toContain('SESSION_SECRET:?');
    expect(app.environment.SERVICE_REGISTRY_ENABLED).toBe('true');
    expect(app.environment.SERVICE_REGISTRY_HTTP_ENABLED).toBe('${SERVICE_REGISTRY_HTTP_ENABLED:-true}');
    expect(app.environment.DOCKER_HOST).toBe('tcp://docker-api-proxy:2375');
    expect(app.environment.SERVICE_REGISTRY_RECOVERY_ENABLED).toBe('true');
    expect(app.environment.HOST_PROC).toBe('/host/proc');
  });

  test('does not require SYS_ADMIN, privilege escalation or unconditional Docker socket mounts', () => {
    const app = compose.services.portracker;
    expect(app.privileged).toBeUndefined();
    expect(app.cap_add || []).not.toContain('SYS_ADMIN');
    expect(app.security_opt || []).not.toContain('apparmor:unconfined');
    expect(app.volumes).toContain('/proc:/host/proc:ro');
    expect(app.volumes).toContain('./portracker-data:/data');
    expect(app.volumes).not.toContain('/var/run/docker.sock:/var/run/docker.sock:ro');
  });

  test('read-only Docker proxy is isolated and not a prerequisite for the dashboard', () => {
    const app = compose.services.portracker;
    const proxy = compose.services['docker-api-proxy'];
    expect(app.networks).toEqual(['default', 'docker-monitor']);
    expect(app.depends_on).toBeUndefined();
    expect(app.volumes).not.toContain('/var/run/docker.sock:/var/run/docker.sock:ro');
    expect(proxy.ports).toBeUndefined();
    expect(proxy.networks).toEqual(['docker-monitor']);
    expect(compose.networks['docker-monitor'].internal).toBe(true);
    expect(proxy.environment.POST).toBe('0');
    expect(proxy.environment.CONTAINERS).toBe('1');
    expect(proxy.environment.INFO).toBe('1');
    expect(proxy.environment.DISABLE_IPV6).toBe('1');
    expect(proxy.privileged).toBeUndefined();
    expect(proxy.volumes).toEqual([
      { type: 'bind', source: '${PORTRACKER_DOCKER_SOCK:-/var/run/docker.sock}',
        target: '/var/run/docker.sock', read_only: true },
    ]);
  });

  test('all opt-in controls correspond to real application configuration', () => {
    const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
    for (const key of [
      'SERVICE_REGISTRY_ENABLED', 'SERVICE_REGISTRY_SCAN_INTERVAL_MS',
      'SERVICE_REGISTRY_PROVENANCE_ENABLED', 'SERVICE_REGISTRY_HTTP_ENABLED',
      'SERVICE_REGISTRY_DOCKER_PROVENANCE_ENABLED', 'SERVICE_REGISTRY_RECOVERY_ENABLED',
    ]) {
      expect(env).toContain(key + '=');
    }
  });
});
