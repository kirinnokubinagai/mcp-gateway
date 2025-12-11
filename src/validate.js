export const validateServer = (raw) => {
  const errors = [];
  const id = raw.id || null;
  const name = (raw.name || '').trim();
  const command = (raw.command || '').trim();
  const args = Array.isArray(raw.args)
    ? raw.args.map(String).filter(Boolean)
    : String(raw.args || '')
        .split(' ')
        .map((a) => a.trim())
        .filter(Boolean);
  const env = typeof raw.env === 'object' && raw.env !== null ? raw.env : {};
  const autoStart = raw.autoStart !== false;

  if (!name) errors.push('name is required');
  if (!command) errors.push('command is required');
  if (Object.keys(env).some((k) => !k.trim())) errors.push('env keys must be non-empty');

  return { ok: errors.length === 0, errors, value: { id, name, command, args, env, autoStart } };
};

export const validateProfile = (raw, knownServers) => {
  const errors = [];
  const name = (raw.name || '').trim();
  const serversInput = Array.isArray(raw.servers) ? raw.servers.map(String) : [];
  const seen = new Set();
  const servers = [];
  for (const s of serversInput) {
    if (seen.has(s)) {
      errors.push(`duplicate server in profile: ${s}`);
    } else {
      seen.add(s);
      servers.push(s);
    }
  }
  if (!name) errors.push('profile name is required');
  if (servers.length === 0) errors.push('profile must have at least one server');
  const missing = servers.filter((s) => !knownServers.has(s));
  if (missing.length) errors.push(`servers not found: ${missing.join(', ')}`);
  return { ok: errors.length === 0, errors, value: { name, servers } };
};
